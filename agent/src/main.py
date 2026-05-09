"""ARIA A2A Agent: FastAPI entrypoint with A2A v1.0 (JSON-RPC 2.0) protocol support.

Implements FHIR access context propagation through TWO channels:

1. A2A Extension payload (Prompt Opinion native, camelCase JSON):
   https://app.promptopinion.ai/schemas/a2a/v1/fhir-context
   Fields: fhirUrl, fhirToken, fhirRefreshToken, fhirRefreshTokenUrl, patientId

2. SHARP HTTP headers (sharp-on-fhir-mcp compatible):
   X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID

Both channels resolve to the same internal context, with Channel 1 taking
precedence when both are present. See docs/sharp-integration.md for the
full propagation flow and fallback ladder.
"""

from __future__ import annotations

import asyncio
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
PUBLIC_AGENT_URL = os.getenv("PUBLIC_AGENT_URL", f"http://{HOST}:{PORT}")

# A2A protocol version this agent implements.
A2A_PROTOCOL_VERSION = "1.0"

# Hard ceiling for the pipeline. If the pipeline does not return within this
# many seconds, we abort and return a "failed" task with a clear error message
# so Po surfaces it instead of hanging on "Server Agent Responding...".
#
# Default raised from 55s -> 180s so that if the GitHub Actions deploy
# workflow re-deploys without re-applying our env var, we no longer fall
# back into a too-tight 55s ceiling that fails healthy ~60s pipelines.
# The Cloud Run request timeout is set to 300s, and Po itself appears to
# time out around 60s — so 180s gives a wide internal buffer while still
# bounding hung Gemini calls.
PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))

# Method aliases accepted on the JSON-RPC endpoint.
A2A_SEND_METHODS = frozenset({
    "message/send",
    "tasks/send",
    "SendMessage",
    "sendMessage",
})

# Prompt Opinion's official A2A FHIR Context extension URI.
# Schema: https://app.promptopinion.ai/schemas/a2a/v1/fhir-context
PO_FHIR_CONTEXT_EXTENSION_URI = (
    "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context"
)

# SHARP Extension Specs header names (sharp-on-fhir-mcp compatibility channel).
SHARP_HEADER_FHIR_SERVER_URL = "X-FHIR-Server-URL"
SHARP_HEADER_ACCESS_TOKEN = "X-FHIR-Access-Token"
SHARP_HEADER_PATIENT_ID = "X-Patient-ID"

# ── MCP Client ──────────────────────────────────────────────

mcp_client = MCPClient(MCP_SERVER_URL)

# ── Lifespan ────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    logger.info("Pipeline timeout: %ds", PIPELINE_TIMEOUT_SECONDS)
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


class JSONRPCRequest(BaseModel):
    jsonrpc: str = "2.0"
    id: str | int | None = None
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class A2ATaskRequest(BaseModel):
    id: str
    message: dict[str, Any]


# ── FHIR Context Extraction (Two Channels) ──────────────────


def _extract_fhir_context_from_extension(
    message: dict[str, Any],
) -> dict[str, str]:
    """Extract FHIR context from the Prompt Opinion A2A Extension payload.

    Schema: https://app.promptopinion.ai/schemas/a2a/v1/fhir-context

    Looks for the extension under message["extensions"] keyed by the
    PO_FHIR_CONTEXT_EXTENSION_URI. Returns an internal context dict mapped
    to the same keys used by the SHARP header path, so the rest of the
    pipeline does not care which channel was used.
    """
    extensions = message.get("extensions") or {}
    if not isinstance(extensions, dict):
        return {}

    payload = extensions.get(PO_FHIR_CONTEXT_EXTENSION_URI)
    if not isinstance(payload, dict):
        return {}

    ctx: dict[str, str] = {}

    if (url := payload.get("fhirUrl")) and isinstance(url, str) and url.strip():
        ctx["fhir_server_url"] = url.strip()

    if (token := payload.get("fhirToken")) and isinstance(token, str) and token.strip():
        t = token.strip()
        if t.lower().startswith("bearer "):
            t = t[7:].strip()
        ctx["fhir_bearer_token"] = t

    if (rt := payload.get("fhirRefreshToken")) and isinstance(rt, str) and rt.strip():
        ctx["fhir_refresh_token"] = rt.strip()

    if (rtu := payload.get("fhirRefreshTokenUrl")) and isinstance(rtu, str) and rtu.strip():
        ctx["fhir_refresh_token_url"] = rtu.strip()

    if (pid := payload.get("patientId")) and isinstance(pid, str) and pid.strip():
        ctx["patient_id"] = pid.strip()

    return ctx


def _extract_fhir_context_from_headers(request: Request) -> dict[str, str]:
    """Extract FHIR context from SHARP HTTP headers.

    sharp-on-fhir-mcp compatibility channel. Header names are case-insensitive
    per RFC 7230, which Starlette/FastAPI already handles.
    """
    headers = request.headers
    ctx: dict[str, str] = {}

    fhir_server = headers.get(SHARP_HEADER_FHIR_SERVER_URL, "").strip()
    access_token = headers.get(SHARP_HEADER_ACCESS_TOKEN, "").strip()
    patient_id = headers.get(SHARP_HEADER_PATIENT_ID, "").strip()

    if fhir_server:
        ctx["fhir_server_url"] = fhir_server
    if access_token:
        if access_token.lower().startswith("bearer "):
            access_token = access_token[7:].strip()
        ctx["fhir_bearer_token"] = access_token
    if patient_id:
        ctx["patient_id"] = patient_id

    return ctx


def _extract_fhir_context(
    request: Request,
    message: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Extract FHIR context from both channels with deterministic precedence.

    Precedence: A2A Extension payload (Channel 1) > SHARP headers (Channel 2).
    Returns the merged context dict. Logs presence only, never values.
    """
    header_ctx = _extract_fhir_context_from_headers(request)
    extension_ctx = (
        _extract_fhir_context_from_extension(message) if message else {}
    )

    # Channel 1 (extension) wins, Channel 2 (headers) fills gaps.
    merged = {**header_ctx, **extension_ctx}

    if merged:
        logger.info(
            "FHIR context resolved: source=%s fhir_url=%s patient_id=%s token=%s refresh=%s",
            "extension" if extension_ctx else "headers",
            "yes" if "fhir_server_url" in merged else "no",
            "yes" if "patient_id" in merged else "no",
            "yes" if "fhir_bearer_token" in merged else "no",
            "yes" if "fhir_refresh_token" in merged else "no",
        )

    return merged


def _merge_fhir_into_payload(
    payload: dict[str, Any],
    fhir_ctx: dict[str, str],
) -> dict[str, Any]:
    """Merge FHIR context into the parsed message payload.

    FHIR context (from either channel) takes precedence over message-payload
    values for the same keys. The merged shape is what the LangGraph pipeline
    and the FHIR MCP tool consume.
    """
    if not fhir_ctx:
        return payload

    fhir = dict(payload.get("fhir") or {})
    if "patient_id" in fhir_ctx:
        fhir["patient_id"] = fhir_ctx["patient_id"]
    if "fhir_bearer_token" in fhir_ctx:
        fhir["bearer_token"] = fhir_ctx["fhir_bearer_token"]
    if "fhir_server_url" in fhir_ctx:
        fhir["server_url"] = fhir_ctx["fhir_server_url"]
    if "fhir_refresh_token" in fhir_ctx:
        fhir["refresh_token"] = fhir_ctx["fhir_refresh_token"]
    if "fhir_refresh_token_url" in fhir_ctx:
        fhir["refresh_token_url"] = fhir_ctx["fhir_refresh_token_url"]
    payload["fhir"] = fhir

    # Also lift patient_id into patient.id so existing pipeline code that reads
    # patient.id continues to work without modification.
    if "patient_id" in fhir_ctx:
        patient = dict(payload.get("patient") or {})
        patient.setdefault("id", fhir_ctx["patient_id"])
        payload["patient"] = patient

    return payload


# ── A2A Helpers ─────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


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


def _risk_emoji(score: float | int | None) -> str:
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

    Reads the actual schema produced by the Rust MCP tools:
      - report.overall_risk_level             (string: low/moderate/high/critical)
      - report.risk_scores[*].adjusted_score  (float, per-interaction)
      - report.critical_findings              (list[str])
      - raw_interactions.interactions[*]      (list[dict] with mechanism)
      - temporal_model.daily_risk             (list[dict])
      - temporal_model.intervention_windows   (list[dict])
      - temporal_model.peak_risk_day          (int)
      - deprescribing_plan.steps              (list[dict])
      - deprescribing_plan.steps[*].monitoring (list[str])
      - deprescribing_plan.warnings           (list[str])

    Legacy field names from earlier pipeline shapes are kept as fallbacks
    so this formatter remains compatible with older snapshots.
    """
    report = result.get("report") or {}
    graph = result.get("interaction_graph") or {}
    temporal = result.get("temporal_model") or {}
    plan = result.get("deprescribing_plan") or {}
    raw_ix = result.get("raw_interactions") or {}
    errors = result.get("errors") or []

    # --- Overall risk: derive numeric score from the highest adjusted_score ---
    risk_scores_list = report.get("risk_scores") or []
    overall_risk = None
    if risk_scores_list:
        scores = [
            r.get("adjusted_score")
            for r in risk_scores_list
            if isinstance(r, dict) and r.get("adjusted_score") is not None
        ]
        if scores:
            overall_risk = max(scores)
    # Fall back to legacy field names if older pipeline output ever appears.
    if overall_risk is None:
        overall_risk = (
            report.get("overall_risk_score")
            or report.get("risk_score")
            or graph.get("aggregate_risk")
        )

    risk_label = (
        report.get("overall_risk_level")
        or report.get("risk_level")
        or report.get("severity")
        or "n/a"
    )

    # --- Header ---
    lines: list[str] = []
    lines.append("# 🧬 ARIA Polypharmacy Analysis")
    lines.append("")
    lines.append(f"**Patient:** {_fmt_patient(patient)}")
    lines.append(f"**Medications ({len(medications)}):** {_fmt_meds(medications)}")
    lines.append("")

    # --- Overall risk ---
    lines.append("## 📊 Overall Risk")
    lines.append("")
    if overall_risk is not None:
        lines.append(
            f"{_risk_emoji(overall_risk)} **Risk score:** {overall_risk} / 10"
            f"{'  •  **Level:** ' + str(risk_label).upper() if risk_label != 'n/a' else ''}"
        )
    else:
        lines.append(f"**Risk level:** {str(risk_label).upper()}")
    lines.append("")

    # --- Critical findings ---
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

    # --- Drug interactions: prefer raw_interactions (rich mechanism) over graph.edges ---
    interactions = (
        raw_ix.get("interactions")
        or graph.get("interactions")
        or graph.get("edges")
        or report.get("interactions")
        or []
    )
    if interactions:
        lines.append("## ⚠️ Drug Interactions")
        lines.append("")
        lines.append("| Pair | Severity | Mechanism |")
        lines.append("|------|----------|-----------|")
        for ix in interactions[:10]:
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
                or ix.get("clinical_significance")
                or ix.get("interaction_type")
                or ix.get("note")
                or "n/a"
            )
            mech_str = str(mech).replace("\n", " ").replace("|", "/").strip()
            if len(mech_str) > 160:
                mech_str = mech_str[:157] + "..."
            lines.append(f"| {pair_str} | {sev} | {mech_str} |")
        if len(interactions) > 10:
            lines.append("")
            lines.append(f"_...and {len(interactions) - 10} additional interaction(s)._")
        lines.append("")

    # --- Risk timeline: pipeline returns daily_risk + intervention_windows ---
    daily_risk = temporal.get("daily_risk") or []
    windows = temporal.get("intervention_windows") or []
    peak_day = temporal.get("peak_risk_day")
    peak_score = temporal.get("peak_risk_score")
    timeline_summary = temporal.get("summary")
    legacy_timeline = temporal.get("timeline") or temporal.get("events") or []

    if daily_risk or windows or peak_day is not None or timeline_summary or legacy_timeline:
        lines.append("## ⏱️ Risk Timeline")
        lines.append("")
        if peak_day is not None:
            peak_line = f"**Peak risk:** Day {peak_day}"
            if peak_score is not None:
                peak_line += f" (score {peak_score})"
            lines.append(peak_line)
            lines.append("")
        if windows:
            lines.append("**Intervention windows:**")
            for w in windows[:6]:
                if not isinstance(w, dict):
                    continue
                day_start = w.get("day_start")
                day_end = w.get("day_end")
                action = w.get("action") or "n/a"
                urgency = w.get("urgency") or ""
                urgency_str = f" _({urgency})_" if urgency else ""
                if day_start is not None and day_end is not None:
                    lines.append(f"- **Day {day_start}–{day_end}**{urgency_str}: {action}")
                else:
                    lines.append(f"- {action}{urgency_str}")
            lines.append("")
        elif legacy_timeline:
            for ev in legacy_timeline[:6]:
                if not isinstance(ev, dict):
                    continue
                t = ev.get("time") or ev.get("when") or ev.get("horizon") or "n/a"
                desc = ev.get("event") or ev.get("description") or ev.get("risk") or "n/a"
                lines.append(f"- **{t}**: {desc}")
            lines.append("")
        if timeline_summary:
            lines.append(f"_{timeline_summary}_")
            lines.append("")

    # --- Deprescribing plan ---
    actions = (
        plan.get("steps")
        or plan.get("actions")
        or plan.get("recommendations")
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
                substitute = a.get("substitute")
                timeline_when = a.get("timeline")
                line = f"{i}. **{drug}** — {action}"
                if substitute:
                    line += f" → _{substitute}_"
                if timeline_when:
                    line += f"  •  _{timeline_when}_"
                lines.append(line)
                if rationale:
                    lines.append(f"   _Rationale:_ {rationale}")
            else:
                lines.append(f"{i}. {a}")
        # Plan summary + total expected risk reduction
        total_red = plan.get("total_expected_risk_reduction")
        plan_summary = plan.get("summary")
        if total_red is not None:
            lines.append("")
            try:
                lines.append(
                    f"**Expected total risk reduction:** {round(float(total_red) * 100)}%"
                )
            except (TypeError, ValueError):
                pass
        if plan_summary:
            lines.append("")
            lines.append(f"_{plan_summary}_")
        lines.append("")

    # --- Monitoring: flatten from each plan step, then fall back to top-level lists ---
    monitoring: list[str] = []
    for step in actions:
        if isinstance(step, dict):
            for m in step.get("monitoring") or []:
                if isinstance(m, str) and m not in monitoring:
                    monitoring.append(m)
    if not monitoring:
        monitoring = plan.get("monitoring") or report.get("monitoring") or []
    if monitoring:
        lines.append("## 🔬 Monitoring Recommendations")
        lines.append("")
        for m in monitoring[:8]:
            lines.append(f"- {m}")
        lines.append("")

    # --- Warnings ---
    warnings = plan.get("warnings") or []
    if warnings:
        lines.append("## ⚠️ Warnings")
        lines.append("")
        for w in warnings[:6]:
            lines.append(f"- {w}")
        lines.append("")

    # --- Pipeline notes (only if errors were collected) ---
    if errors:
        lines.append("## ⚙️ Pipeline Notes")
        lines.append("")
        for e in errors[:5]:
            lines.append(f"- _{e}_")
        lines.append("")

    rendered = "\n".join(lines).strip()

    # If somehow we still produced nothing useful, fall back to a debug dump
    # so judges / clinicians at least see the raw pipeline payload instead of
    # an empty card. The "## " threshold of <=1 means: only the header was
    # emitted, no real findings sections.
    if rendered.count("##") <= 1:
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


# ── A2A Agent Card Builder ──────────────────────────────────


def _build_agent_card() -> dict[str, Any]:
    """Construct the A2A v1.0 agent card.

    Declares support for both the Prompt Opinion FHIR Context A2A Extension
    (camelCase JSON) and the SHARP HTTP headers (sharp-on-fhir-mcp).
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
            "experimental": {
                # Channel 1: Prompt Opinion native A2A Extension.
                "fhirContextExtension": {
                    "supported": True,
                    "uri": PO_FHIR_CONTEXT_EXTENSION_URI,
                    "required": False,
                },
                # Channel 2: SHARP HTTP headers.
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
        # Declare the extension so Prompt Opinion knows to populate it.
        "extensions": [
            {
                "uri": PO_FHIR_CONTEXT_EXTENSION_URI,
                "description": "FHIR context allowing the agent to query a FHIR server securely",
                "required": False,
            }
        ],
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
    content = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p)
    try:
        data = json.loads(content) if content else {}
    except json.JSONDecodeError:
        data = {"medications": [m.strip() for m in content.split(",") if m.strip()]}
    return data if isinstance(data, dict) else {}


def _payload_to_pipeline_args(payload: dict[str, Any]) -> tuple[list, Any, dict[str, Any]]:
    medications = payload.get("medications") or []
    patient = payload.get("patient")
    fhir = payload.get("fhir") or {}
    return medications, patient, fhir


async def _run_pipeline_with_timeout(
    medications: list,
    patient: Any,
    fhir_ctx: dict[str, Any],
) -> dict[str, Any]:
    """Run the pipeline with a hard timeout to prevent hanging clients.

    If the pipeline does not finish in PIPELINE_TIMEOUT_SECONDS, raise
    asyncio.TimeoutError so the caller can return a clear "failed" task
    instead of letting Po hang on "Server Agent Responding..." indefinitely.
    """
    async def _inner() -> dict[str, Any]:
        try:
            return await run_pipeline(
                medications, patient, mcp_client, fhir_context=fhir_ctx or None
            )
        except TypeError:
            # Backward compat for older run_pipeline signatures
            return await run_pipeline(medications, patient, mcp_client)

    return await asyncio.wait_for(_inner(), timeout=PIPELINE_TIMEOUT_SECONDS)


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
    meds: list[str | dict] = []
    for med in request.medications:
        if isinstance(med, str):
            meds.append(med)
        elif isinstance(med, DrugInput):
            meds.append(med.model_dump(exclude_none=True))
        elif isinstance(med, dict):
            meds.append(med)

    patient_ctx = request.patient.model_dump() if request.patient else None
    fhir_ctx = _extract_fhir_context(http_request)
    pipeline_fhir_ctx = {
        k.replace("fhir_bearer_token", "bearer_token").replace("fhir_server_url", "server_url"): v
        for k, v in fhir_ctx.items()
    }

    try:
        result = await _run_pipeline_with_timeout(meds, patient_ctx, pipeline_fhir_ctx)
        return AnalyzeResponse(**result)
    except asyncio.TimeoutError:
        logger.error("Pipeline timed out after %ds", PIPELINE_TIMEOUT_SECONDS)
        raise HTTPException(
            status_code=504,
            detail=f"Analysis timed out after {PIPELINE_TIMEOUT_SECONDS}s",
        )
    except Exception as e:
        logger.error("Pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@app.get("/.well-known/agent.json")
async def agent_card_legacy():
    return _build_agent_card()


@app.get("/.well-known/agent-card.json")
async def agent_card_standard():
    return _build_agent_card()


@app.post("/a2a/v1")
async def a2a_jsonrpc(request: Request):
    """A2A v1.0 JSON-RPC 2.0 endpoint.

    Reads FHIR context from BOTH channels (extension + headers) and
    propagates it into the message payload before running the pipeline.
    """
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
        return await _handle_message_send(rpc, request)

    return _jsonrpc_error(rpc.id, -32601, f"Method not found: {rpc.method}")


async def _handle_message_send(
    rpc: JSONRPCRequest,
    request: Request,
) -> dict[str, Any]:
    """Process an A2A v1.0 message/send request and return a completed Task.

    Critical fix: wraps run_pipeline in asyncio.wait_for so a hanging Gemini
    or MCP call cannot leave Po waiting forever on "Server Agent Responding...".
    On timeout, returns a Task with state=failed and a clear diagnostic message.
    """
    message = rpc.params.get("message", {}) or {}
    parts = message.get("parts", []) or []

    # Extract FHIR context from BOTH channels (extension wins, headers fill gaps)
    fhir_ctx = _extract_fhir_context(request, message)

    payload = _parse_message_content(parts)
    payload = _merge_fhir_into_payload(payload, fhir_ctx)
    medications, patient, pipeline_fhir = _payload_to_pipeline_args(payload)

    task_id = str(uuid.uuid4())
    context_id = message.get("contextId") or str(uuid.uuid4())

    if not medications and not pipeline_fhir.get("patient_id"):
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "failed",
                "No medications and no FHIR patient context provided. "
                "Send JSON with a 'medications' array, or supply the "
                "FHIR Context A2A Extension, or SHARP headers "
                "(X-Patient-ID, X-FHIR-Access-Token).",
            ),
        )

    try:
        result = await _run_pipeline_with_timeout(medications, patient, pipeline_fhir)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        return _jsonrpc_result(
            rpc.id,
            _build_task(task_id, context_id, "completed", markdown),
        )
    except asyncio.TimeoutError:
        logger.error(
            "A2A pipeline timed out after %ds (medications=%d)",
            PIPELINE_TIMEOUT_SECONDS,
            len(medications),
        )
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "failed",
                f"⏱️ ARIA analysis timed out after {PIPELINE_TIMEOUT_SECONDS} seconds. "
                f"This usually happens when the Gemini reasoning or upstream APIs are slow. "
                f"Please try again with fewer medications, or hit the REST endpoint directly:\n\n"
                f"`POST {PUBLIC_AGENT_URL}/analyze`",
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
                f"❌ Analysis failed: {type(e).__name__}: {e}",
            ),
        )


@app.post("/a2a/tasks/send")
async def a2a_task_send_legacy(task: A2ATaskRequest, http_request: Request):
    """Legacy A2A task send endpoint. Kept for backward compatibility."""
    message = task.message if isinstance(task.message, dict) else {}
    parts = message.get("parts", []) if isinstance(message, dict) else []
    fhir_ctx = _extract_fhir_context(http_request, message)

    payload = _parse_message_content(parts)
    payload = _merge_fhir_into_payload(payload, fhir_ctx)
    medications, patient, pipeline_fhir = _payload_to_pipeline_args(payload)

    if not medications and not pipeline_fhir.get("patient_id"):
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
        result = await _run_pipeline_with_timeout(medications, patient, pipeline_fhir)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        return {
            "id": task.id,
            "status": {"state": "completed"},
            "artifacts": [{"parts": [{"text": markdown}]}],
        }
    except asyncio.TimeoutError:
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "text": f"Analysis timed out after {PIPELINE_TIMEOUT_SECONDS}s"
                        }
                    ]
                }
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
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level="info")