"""ARIA A2A Agent: FastAPI entrypoint with A2A v1.0 (JSON-RPC 2.0) protocol support.

Implements SHARP Extension Specs header propagation for FHIR access context:
X-FHIR-Server-URL, X-FHIR-Access-Token, and X-Patient-ID are read off every
inbound A2A request and forwarded to the MCP layer as tool arguments. See
docs/sharp-integration.md for the full propagation flow and fallback ladder.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure src/ is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp_client.client import MCPClient
from pipeline.graph import run_pipeline

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("aria-agent")

# ── Configuration ───────────────────────────────────────────

MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8080")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# Public-facing URL for A2A agent card (used by external clients like Prompt Opinion).
# Falls back to local dev URL if not set.
PUBLIC_AGENT_URL = os.getenv("PUBLIC_AGENT_URL", f"http://{HOST}:{PORT}")

# A2A protocol version this agent implements (v1 spec).
# https://a2a-protocol.org/latest/announcing-1.0/
A2A_PROTOCOL_VERSION = "1.0"

# Method aliases accepted on the JSON-RPC endpoint.
# The A2A v1.0 spec uses "message/send" and "tasks/send", but several real-world
# clients (notably Prompt Opinion) emit PascalCase names like "SendMessage".
# We accept all common variants so the agent works across the ecosystem.
A2A_SEND_METHODS = frozenset({
    "message/send",
    "tasks/send",
    "SendMessage",
    "sendMessage",
})

# SHARP Extension Specs header names. The A2A endpoint reads these from every
# inbound request and propagates them to the MCP layer. See docs/sharp-integration.md.
SHARP_HEADER_FHIR_SERVER_URL = "X-FHIR-Server-URL"
SHARP_HEADER_ACCESS_TOKEN = "X-FHIR-Access-Token"
SHARP_HEADER_PATIENT_ID = "X-Patient-ID"

# ── MCP Client ──────────────────────────────────────────────

mcp_client = MCPClient(MCP_SERVER_URL)

# ── Lifespan ────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: check MCP server health. Shutdown: cleanup."""
    healthy = await mcp_client.health_check()
    if healthy:
        logger.info("MCP server at %s is healthy", MCP_SERVER_URL)
        try:
            init = await mcp_client.initialize()
            logger.info("MCP session initialized: %s", init.get("serverInfo", {}))
        except Exception as e:
            logger.warning("MCP initialize failed (non-fatal): %s", e)
    else:
        logger.warning(
            "MCP server at %s is not reachable, agent will retry on requests",
            MCP_SERVER_URL,
        )
    logger.info("Public agent URL: %s", PUBLIC_AGENT_URL)
    yield
    logger.info("ARIA Agent shutting down")


# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(
    title="ARIA A2A Agent",
    description="Adaptive Risk Intelligence for Polypharmacy Assessment, Agent Layer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    # Expose SHARP request headers so browser-based A2A clients can send them.
    allow_headers=[
        "*",
        SHARP_HEADER_FHIR_SERVER_URL,
        SHARP_HEADER_ACCESS_TOKEN,
        SHARP_HEADER_PATIENT_ID,
    ],
)

# ── Request / Response Models ───────────────────────────────


class DrugInput(BaseModel):
    name: str
    rxcui: str | None = None
    dose: str | None = None
    frequency: str | None = None
    indication: str | None = None


class PatientInput(BaseModel):
    age: int = 50
    sex: str = "unknown"
    weight_kg: float | None = None
    height_cm: float | None = None
    ckd_stage: int = 0
    hepatic_impairment: bool = False
    smoking: bool = False
    alcohol_use: str = "none"
    comorbidities: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    medications: list[str] | list[DrugInput]
    patient: PatientInput | None = None


class AnalyzeResponse(BaseModel):
    report: dict[str, Any] | None = None
    interaction_graph: dict[str, Any] | None = None
    temporal_model: dict[str, Any] | None = None
    deprescribing_plan: dict[str, Any] | None = None
    raw_interactions: dict[str, Any] | None = None
    errors: list[str] = Field(default_factory=list)


# ── A2A v1.0 JSON-RPC Models ────────────────────────────────


class JSONRPCRequest(BaseModel):
    """JSON-RPC 2.0 envelope used by A2A v1.0."""

    jsonrpc: str = "2.0"
    id: str | int | None = None
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class A2ATaskRequest(BaseModel):
    """Legacy (pre-JSON-RPC) A2A task send request. Kept for backward compatibility."""

    id: str
    message: dict[str, Any]


# ── SHARP Context Helpers ───────────────────────────────────


def _extract_sharp_context(request: Request) -> dict[str, str]:
    """Extract SHARP Extension Specs headers from an inbound A2A request.

    Returns a dict containing only the SHARP fields that were actually
    present on the request, so callers can detect missing headers and
    fall back to environment variables or message payload values.

    The headers are case-insensitive per RFC 7230, which Starlette/FastAPI
    already handles in request.headers.

    Reference: docs/sharp-integration.md
    """
    headers = request.headers
    ctx: dict[str, str] = {}

    fhir_server = headers.get(SHARP_HEADER_FHIR_SERVER_URL, "").strip()
    access_token = headers.get(SHARP_HEADER_ACCESS_TOKEN, "").strip()
    patient_id = headers.get(SHARP_HEADER_PATIENT_ID, "").strip()

    if fhir_server:
        ctx["fhir_server_url"] = fhir_server
    if access_token:
        # Strip a single leading "Bearer " if present so we never end up with
        # "Authorization: Bearer Bearer <token>" downstream.
        if access_token.lower().startswith("bearer "):
            access_token = access_token[7:].strip()
        ctx["fhir_bearer_token"] = access_token
    if patient_id:
        ctx["patient_id"] = patient_id

    # Log presence only, never values, so bearer tokens never end up in logs.
    if ctx:
        logger.info(
            "SHARP context received: fhir_server=%s patient_id=%s token_present=%s",
            "yes" if "fhir_server_url" in ctx else "no",
            "yes" if "patient_id" in ctx else "no",
            "yes" if "fhir_bearer_token" in ctx else "no",
        )

    return ctx


def _merge_sharp_into_payload(
    payload: dict[str, Any],
    sharp_ctx: dict[str, str],
) -> dict[str, Any]:
    """Merge SHARP context into the parsed message payload.

    SHARP headers take precedence over message-payload values. The merged
    shape is what the LangGraph pipeline and the FHIR MCP tool consume.
    """
    if not sharp_ctx:
        return payload

    fhir = dict(payload.get("fhir") or {})
    if "patient_id" in sharp_ctx:
        fhir["patient_id"] = sharp_ctx["patient_id"]
    if "fhir_bearer_token" in sharp_ctx:
        fhir["bearer_token"] = sharp_ctx["fhir_bearer_token"]
    if "fhir_server_url" in sharp_ctx:
        fhir["server_url"] = sharp_ctx["fhir_server_url"]
    payload["fhir"] = fhir

    # Also lift patient_id into patient.id so existing pipeline code that reads
    # patient.id continues to work without modification.
    if "patient_id" in sharp_ctx:
        patient = dict(payload.get("patient") or {})
        patient.setdefault("id", sharp_ctx["patient_id"])
        payload["patient"] = patient

    return payload


# ── A2A Helpers ─────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _jsonrpc_result(req_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }


def _build_task(
    task_id: str,
    context_id: str,
    state: str,
    text: str,
    artifact_name: str = "aria-analysis",
) -> dict[str, Any]:
    """Build an A2A v1.0 Task object."""
    return {
        "id": task_id,
        "contextId": context_id,
        "kind": "task",
        "status": {"state": state, "timestamp": _now_iso()},
        "artifacts": [
            {
                "artifactId": str(uuid.uuid4()),
                "name": artifact_name,
                "parts": [{"kind": "text", "text": text}],
            }
        ],
    }


# ── Markdown Clinical Report Formatter ──────────────────────
#
# Po (Prompt Opinion's orchestrator) renders A2A artifact text as chat content.
# When we return raw JSON, Po treats it as opaque structured data and summarizes
# it down to "I have sent the analysis...". By converting the pipeline result
# into Markdown here, Po pastes it directly as a rich chat message: headings,
# tables, bullets, warnings all render natively in the Prompt Opinion UI.


def _risk_emoji(score: float | int | None) -> str:
    """Map risk score (0 to 10) to an emoji indicator."""
    if score is None:
        return "⚪"
    try:
        s = float(score)
    except (TypeError, ValueError):
        return "⚪"
    if s >= 8:
        return "🔴"
    if s >= 5:
        return "🟠"
    if s >= 3:
        return "🟡"
    return "🟢"


def _fmt_patient(patient: Any) -> str:
    """Format patient context as a one-line summary."""
    if not isinstance(patient, dict) or not patient:
        return "_No patient context provided._"
    bits: list[str] = []
    if patient.get("age"):
        bits.append(f"{patient['age']}yo")
    if patient.get("sex") and patient["sex"] != "unknown":
        bits.append(str(patient["sex"]))
    ckd = patient.get("ckd_stage")
    if ckd:
        bits.append(f"CKD stage {ckd}")
    if patient.get("hepatic_impairment"):
        bits.append("hepatic impairment")
    comorbid = patient.get("comorbidities") or []
    if comorbid:
        bits.append("comorbidities: " + ", ".join(comorbid))
    allergies = patient.get("allergies") or []
    if allergies:
        bits.append("allergies: " + ", ".join(allergies))
    return ", ".join(bits) if bits else "_No patient context provided._"


def _fmt_meds(medications: list[Any]) -> str:
    """Format medication list as a comma-separated string."""
    names: list[str] = []
    for m in medications:
        if isinstance(m, str):
            names.append(m)
        elif isinstance(m, dict):
            names.append(str(m.get("name", "?")))
    return ", ".join(names) if names else "_(none)_"


def _format_pipeline_result_markdown(
    medications: list[Any],
    patient: Any,
    result: dict[str, Any],
) -> str:
    """Convert the ARIA pipeline result into a clinical Markdown report.

    The output is designed to render well inside Prompt Opinion's chat UI
    (Po pastes artifact text verbatim when it's plain text/markdown).
    """
    report = result.get("report") or {}
    graph = result.get("interaction_graph") or {}
    temporal = result.get("temporal_model") or {}
    plan = result.get("deprescribing_plan") or {}
    errors = result.get("errors") or []

    # Risk summary
    overall_risk = (
        report.get("overall_risk_score")
        or report.get("risk_score")
        or graph.get("aggregate_risk")
    )
    risk_label = report.get("risk_level") or report.get("severity") or "n/a"

    lines: list[str] = []

    # Header
    lines.append("# 🧬 ARIA Polypharmacy Analysis")
    lines.append("")
    lines.append(f"**Patient:** {_fmt_patient(patient)}")
    lines.append(f"**Medications ({len(medications)}):** {_fmt_meds(medications)}")
    lines.append("")

    # Overall risk
    lines.append("## 📊 Overall Risk")
    lines.append("")
    if overall_risk is not None:
        lines.append(
            f"{_risk_emoji(overall_risk)} **Risk score:** {overall_risk} / 10"
            f"{'  •  **Level:** ' + str(risk_label) if risk_label != 'n/a' else ''}"
        )
    else:
        lines.append(f"**Risk level:** {risk_label}")
    lines.append("")

    # Critical findings / interactions
    interactions = (
        graph.get("interactions")
        or graph.get("edges")
        or report.get("interactions")
        or []
    )
    if interactions:
        lines.append("## ⚠️ Drug Interactions")
        lines.append("")
        lines.append("| Pair | Severity | Mechanism |")
        lines.append("|------|----------|-----------|")
        for ix in interactions[:10]:  # cap at 10 for readability
            if not isinstance(ix, dict):
                continue
            pair = ix.get("pair") or ix.get("drugs") or [
                ix.get("source", "?"),
                ix.get("target", "?"),
            ]
            if isinstance(pair, list):
                pair_str = " ↔ ".join(str(p) for p in pair)
            else:
                pair_str = str(pair)
            sev = ix.get("severity") or ix.get("level") or "n/a"
            mech = (
                ix.get("mechanism")
                or ix.get("description")
                or ix.get("note")
                or "n/a"
            )
            mech_str = str(mech).replace("\n", " ").strip()
            if len(mech_str) > 140:
                mech_str = mech_str[:137] + "..."
            lines.append(f"| {pair_str} | {sev} | {mech_str} |")
        if len(interactions) > 10:
            lines.append("")
            lines.append(f"_...and {len(interactions) - 10} additional interaction(s)._")
        lines.append("")

    # Critical findings (text-form)
    findings = report.get("critical_findings") or report.get("findings") or []
    if findings:
        lines.append("## 🩺 Critical Findings")
        lines.append("")
        for f in findings[:8]:
            if isinstance(f, dict):
                msg = f.get("message") or f.get("text") or json.dumps(f, default=str)
                sev = f.get("severity")
                prefix = f"**[{sev}]** " if sev else ""
                lines.append(f"- {prefix}{msg}")
            else:
                lines.append(f"- {f}")
        lines.append("")

    # Temporal projection
    timeline = temporal.get("timeline") or temporal.get("events") or []
    if timeline:
        lines.append("## ⏱️ Risk Timeline")
        lines.append("")
        for ev in timeline[:6]:
            if not isinstance(ev, dict):
                continue
            t = ev.get("time") or ev.get("when") or ev.get("horizon") or "n/a"
            desc = ev.get("event") or ev.get("description") or ev.get("risk") or "n/a"
            lines.append(f"- **{t}**: {desc}")
        lines.append("")

    # Deprescribing plan
    actions = (
        plan.get("actions")
        or plan.get("recommendations")
        or plan.get("steps")
        or []
    )
    if actions:
        lines.append("## 💊 Deprescribing Plan")
        lines.append("")
        for i, a in enumerate(actions[:10], start=1):
            if isinstance(a, dict):
                drug = a.get("drug") or a.get("medication") or "n/a"
                action = a.get("action") or a.get("recommendation") or "n/a"
                rationale = a.get("rationale") or a.get("reason") or ""
                line = f"{i}. **{drug}**: {action}"
                if rationale:
                    line += f"  \n   _Rationale:_ {rationale}"
                lines.append(line)
            else:
                lines.append(f"{i}. {a}")
        lines.append("")

    # Plan summary / monitoring
    monitoring = plan.get("monitoring") or report.get("monitoring") or []
    if monitoring:
        lines.append("## 🔬 Monitoring Recommendations")
        lines.append("")
        for m in monitoring[:8]:
            lines.append(f"- {m}")
        lines.append("")

    # Errors (non-fatal pipeline warnings)
    if errors:
        lines.append("## ⚙️ Pipeline Notes")
        lines.append("")
        for e in errors[:5]:
            lines.append(f"- _{e}_")
        lines.append("")

    rendered = "\n".join(lines).strip()
    if rendered.count("##") == 0:
        rendered += (
            "\n\n_No structured findings returned by the pipeline. "
            "Raw payload below for debugging:_\n\n"
            "```json\n"
            + json.dumps(result, indent=2, default=str)[:3500]
            + "\n```"
        )

    rendered += (
        "\n\n---\n"
        "_Generated by **ARIA** (Adaptive Risk Intelligence for Polypharmacy "
        "Assessment) via A2A v1.0._"
    )
    return rendered


# ── A2A Agent Card Builder (v1 spec) ────────────────────────


def _build_agent_card() -> dict[str, Any]:
    """Construct the A2A v1 agent card.

    Conforms to the v1 spec:
      - top-level `url` removed (now lives in supportedInterfaces[].url)
      - `preferredTransport` removed (order in supportedInterfaces = preference)
      - `capabilities.stateTransitionHistory` removed
      - `protocolVersion` = "1.0"
      - `securitySchemes` follows OpenAPI 3.0 format directly
    Reference: https://docs.promptopinion.ai/a2a-v1-migration
    """
    return {
        "name": "ARIA",
        "description": (
            "Adaptive Risk Intelligence for Polypharmacy Assessment. "
            "Detects N-drug interactions, predicts risk timelines, "
            "and generates evidence-based deprescribing plans."
        ),
        "version": "0.1.0",
        "protocolVersion": A2A_PROTOCOL_VERSION,
        "provider": {
            "organization": "Wiqi Labs",
            "url": "https://github.com/wiqilee/ARIA",
        },
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            # SHARP Extension Specs support advertised so SHARP-aware clients
            # know to forward FHIR context headers automatically.
            "experimental": {
                "sharpExtensions": {
                    "supported": True,
                    "headers": [
                        SHARP_HEADER_FHIR_SERVER_URL,
                        SHARP_HEADER_ACCESS_TOKEN,
                        SHARP_HEADER_PATIENT_ID,
                    ],
                    "specReference": "https://github.com/TerminallyLazy/sharp-on-fhir-mcp",
                },
            },
        },
        "defaultInputModes": ["text/plain", "application/json"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "supportedInterfaces": [
            {
                "url": f"{PUBLIC_AGENT_URL}/a2a/v1",
                "protocolBinding": "JSONRPC",
                "protocolVersion": A2A_PROTOCOL_VERSION,
            }
        ],
        "skills": [
            {
                "id": "polypharmacy-analysis",
                "name": "Polypharmacy Risk Analysis",
                "description": (
                    "Analyzes drug interactions, computes personalized risk scores, "
                    "and generates deprescribing plans."
                ),
                "tags": [
                    "clinical",
                    "pharmacy",
                    "drug-interactions",
                    "fhir",
                    "polypharmacy",
                    "sharp",
                ],
                "examples": [
                    "Analyze interactions for 78yo male with CKD3 on warfarin, aspirin, ibuprofen, atorvastatin",
                    "Generate deprescribing plan for patient with 8 medications",
                ],
                "inputModes": ["text/plain", "application/json"],
                "outputModes": ["text/plain", "application/json"],
            }
        ],
        "securitySchemes": {},
        "security": [],
    }


# ── Pipeline Helper ─────────────────────────────────────────


def _parse_message_content(parts: list[dict[str, Any]]) -> dict[str, Any]:
    """Extract the full message payload from A2A message parts.

    Returns the parsed payload as a dict so callers can merge SHARP context
    into it before extracting medications and patient context.
    """
    content = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p)

    try:
        data = json.loads(content) if content else {}
    except json.JSONDecodeError:
        # Fall back: treat as comma-separated drug list
        data = {"medications": [m.strip() for m in content.split(",") if m.strip()]}

    return data if isinstance(data, dict) else {}


def _payload_to_pipeline_args(payload: dict[str, Any]) -> tuple[list, Any, dict[str, Any]]:
    """Split a (post-SHARP-merge) payload into pipeline arguments.

    Returns (medications, patient_context, fhir_context). The fhir_context
    is a dict that the pipeline forwards to the fhir_patient_medications
    MCP tool (containing patient_id, bearer_token, server_url where set).
    """
    medications = payload.get("medications") or []
    patient = payload.get("patient")
    fhir = payload.get("fhir") or {}
    return medications, patient, fhir


# ── Routes ──────────────────────────────────────────────────


@app.get("/health")
async def health():
    mcp_healthy = await mcp_client.health_check()
    return {
        "status": "healthy",
        "service": "aria-agent",
        "mcp_server": "connected" if mcp_healthy else "disconnected",
        "mcp_url": MCP_SERVER_URL,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest, http_request: Request):
    """Main analysis endpoint. Runs the full ARIA pipeline.

    Also accepts SHARP Extension Specs headers, so a SMART-aware caller can
    hit /analyze directly (without going through A2A) and still have the
    FHIR tool see the patient context.
    """
    meds: list[str | dict] = []
    for med in request.medications:
        if isinstance(med, str):
            meds.append(med)
        elif isinstance(med, DrugInput):
            meds.append(med.model_dump(exclude_none=True))
        elif isinstance(med, dict):
            meds.append(med)

    patient_ctx = request.patient.model_dump() if request.patient else None
    sharp_ctx = _extract_sharp_context(http_request)
    fhir_ctx = {
        k.replace("fhir_bearer_token", "bearer_token").replace("fhir_server_url", "server_url"): v
        for k, v in sharp_ctx.items()
    }

    try:
        result = await run_pipeline(meds, patient_ctx, mcp_client, fhir_context=fhir_ctx or None)
        return AnalyzeResponse(**result)
    except TypeError:
        # Backward compatibility for older run_pipeline signatures that don't
        # accept fhir_context yet. The pipeline can still read FHIR context
        # from environment variables in that case.
        result = await run_pipeline(meds, patient_ctx, mcp_client)
        return AnalyzeResponse(**result)
    except Exception as e:
        logger.error("Pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


# ── A2A Protocol Endpoints ──────────────────────────────────


@app.get("/.well-known/agent.json")
async def agent_card_legacy():
    """Legacy A2A path. Kept for backward compatibility."""
    return _build_agent_card()


@app.get("/.well-known/agent-card.json")
async def agent_card_standard():
    """A2A protocol standard path (used by Prompt Opinion and modern A2A clients)."""
    return _build_agent_card()


@app.post("/a2a/v1")
async def a2a_jsonrpc(request: Request):
    """A2A v1.0 JSON-RPC 2.0 endpoint (preferred).

    Handles JSON-RPC envelopes from Prompt Opinion and other A2A v1.0 clients.
    Reads SHARP Extension Specs headers off the inbound request and propagates
    them into the message payload before running the pipeline.

    Supported method aliases (see A2A_SEND_METHODS):
      - message/send   (A2A spec)
      - tasks/send     (A2A spec, legacy alias)
      - SendMessage    (Prompt Opinion convention)
      - sendMessage    (camelCase variant)
    """
    sharp_ctx = _extract_sharp_context(request)

    try:
        raw = await request.json()
    except Exception as e:
        logger.error("A2A: invalid JSON body: %s", e)
        return _jsonrpc_error(None, -32700, "Parse error")

    logger.info(
        "A2A: method=%s id=%s",
        raw.get("method"),
        raw.get("id"),
    )

    try:
        rpc = JSONRPCRequest(**raw)
    except Exception as e:
        logger.error("A2A: invalid JSON-RPC envelope: %s | body=%s", e, raw)
        return _jsonrpc_error(raw.get("id"), -32600, f"Invalid Request: {e}")

    if rpc.method in A2A_SEND_METHODS:
        return await _handle_message_send(rpc, sharp_ctx)

    return _jsonrpc_error(rpc.id, -32601, f"Method not found: {rpc.method}")


async def _handle_message_send(
    rpc: JSONRPCRequest,
    sharp_ctx: dict[str, str],
) -> dict[str, Any]:
    """Process an A2A v1.0 message/send (or alias) request and return a completed Task.

    The artifact text is a Markdown clinical report (not raw JSON) so that
    chat-style A2A clients like Prompt Opinion render it directly as a rich
    response instead of summarizing it down to a one-liner.
    """
    message = rpc.params.get("message", {}) or {}
    parts = message.get("parts", []) or []

    payload = _parse_message_content(parts)
    payload = _merge_sharp_into_payload(payload, sharp_ctx)
    medications, patient, fhir_ctx = _payload_to_pipeline_args(payload)

    task_id = str(uuid.uuid4())
    context_id = message.get("contextId") or str(uuid.uuid4())

    if not medications and not fhir_ctx.get("patient_id"):
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "failed",
                "No medications and no FHIR patient context provided. "
                "Send JSON with a 'medications' array, or supply SHARP "
                "headers (X-Patient-ID, X-FHIR-Access-Token).",
            ),
        )

    try:
        try:
            result = await run_pipeline(
                medications, patient, mcp_client, fhir_context=fhir_ctx or None
            )
        except TypeError:
            result = await run_pipeline(medications, patient, mcp_client)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "completed",
                markdown,
            ),
        )
    except Exception as e:
        logger.error("A2A pipeline failed: %s", e, exc_info=True)
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "failed",
                f"Analysis failed: {e}",
            ),
        )


@app.post("/a2a/tasks/send")
async def a2a_task_send_legacy(task: A2ATaskRequest, http_request: Request):
    """Legacy A2A task send endpoint (pre-JSON-RPC). Kept for backward compatibility.

    Also reads SHARP headers off the inbound request.
    """
    sharp_ctx = _extract_sharp_context(http_request)
    message = task.message
    parts = message.get("parts", []) if isinstance(message, dict) else []
    payload = _parse_message_content(parts)
    payload = _merge_sharp_into_payload(payload, sharp_ctx)
    medications, patient, fhir_ctx = _payload_to_pipeline_args(payload)

    if not medications and not fhir_ctx.get("patient_id"):
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "text": "No medications and no FHIR patient context provided."
                        }
                    ]
                }
            ],
        }

    try:
        try:
            result = await run_pipeline(
                medications, patient, mcp_client, fhir_context=fhir_ctx or None
            )
        except TypeError:
            result = await run_pipeline(medications, patient, mcp_client)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        return {
            "id": task.id,
            "status": {"state": "completed"},
            "artifacts": [
                {"parts": [{"text": markdown}]}
            ],
        }
    except Exception as e:
        logger.error("Legacy A2A pipeline failed: %s", e, exc_info=True)
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [{"parts": [{"text": f"Analysis failed: {e}"}]}],
        }


# ── Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("Starting ARIA Agent on %s:%d", HOST, PORT)
    logger.info("MCP Server URL: %s", MCP_SERVER_URL)
    logger.info("Public Agent URL: %s", PUBLIC_AGENT_URL)
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )