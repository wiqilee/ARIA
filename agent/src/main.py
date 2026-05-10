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

A2A v1.0 lifecycle (blocking-first):

    POST /a2a/v1 message/send
      → server runs the pipeline and waits up to PO_BLOCKING_BUDGET_SECONDS
        for it to finish.
        - Finished: returns Task state="completed" with markdown artifact.
        - Not finished: returns Task state="working" with task_id; client
          can poll tasks/get to retrieve the eventual completed/failed
          state. Background coroutine is shielded from cancellation.

    POST /a2a/v1 tasks/get
      → returns the latest stored Task snapshot for the given task_id.

This blocking-first design keeps simple A2A clients (like Po, which seem
to expect a fully-resolved task in the same response) happy in the common
case where pipelines finish in <60s.
"""

from __future__ import annotations

import asyncio
import json
import json as _json_dbg
import logging
import os
import re
import sys
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import Response as StarletteResponse

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

PUBLIC_AGENT_URL = os.getenv("PUBLIC_AGENT_URL", f"http://{HOST}:{PORT}")

A2A_PROTOCOL_VERSION = "1.0"

# Hard ceiling for pipeline execution. After this, the background coroutine
# is cancelled and the task transitions to "failed".
PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))

# Blocking budget: how long message/send will wait synchronously before
# returning "working". Set near the upper end so simple clients (like Po)
# always see a fully-completed task. The background coroutine is shielded,
# so even if this expires the pipeline still finishes — polling clients
# can retrieve it via tasks/get.
PO_BLOCKING_BUDGET_SECONDS = int(os.getenv("PO_BLOCKING_BUDGET_SECONDS", "170"))

# Toggle to dump every /a2a/v1 request and response body to logs. Useful
# while debugging client-specific quirks. Set DEBUG_A2A=0 to disable.
DEBUG_A2A = os.getenv("DEBUG_A2A", "1") == "1"

A2A_SEND_METHODS = frozenset({
    "message/send",
    "tasks/send",
    "SendMessage",
    "sendMessage",
})

A2A_GET_METHODS = frozenset({
    "tasks/get",
    "GetTask",
    "getTask",
})

PO_FHIR_CONTEXT_EXTENSION_URI = (
    "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context"
)

SHARP_HEADER_FHIR_SERVER_URL = "X-FHIR-Server-URL"
SHARP_HEADER_ACCESS_TOKEN = "X-FHIR-Access-Token"
SHARP_HEADER_PATIENT_ID = "X-Patient-ID"

# ── MCP Client ──────────────────────────────────────────────

mcp_client = MCPClient(MCP_SERVER_URL)

# ── In-memory Task Store ────────────────────────────────────


class TaskStore:
    """Bounded in-memory task store with FIFO eviction."""

    def __init__(self, max_tasks: int = 1000):
        self._store: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._max = max_tasks
        self._lock = asyncio.Lock()

    async def set(self, task_id: str, task: dict[str, Any]) -> None:
        async with self._lock:
            self._store[task_id] = task
            self._store.move_to_end(task_id)
            while len(self._store) > self._max:
                self._store.popitem(last=False)

    async def get(self, task_id: str) -> dict[str, Any] | None:
        async with self._lock:
            return self._store.get(task_id)


TASK_STORE = TaskStore()

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
    logger.info(
        "Pipeline timeout: %ds, blocking budget: %ds, debug: %s",
        PIPELINE_TIMEOUT_SECONDS,
        PO_BLOCKING_BUDGET_SECONDS,
        DEBUG_A2A,
    )
    yield
    logger.info("ARIA Agent shutting down")


# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(
    title="ARIA A2A Agent",
    description="Adaptive Risk Intelligence for Polypharmacy Assessment, Agent Layer",
    version="0.1.0",
    lifespan=lifespan,
)


# ── Debug Middleware (capture A2A I/O) ──────────────────────


@app.middleware("http")
async def _debug_a2a_io(request: Request, call_next):
    """Log full A2A request/response bodies for client interop debugging.

    Only active when DEBUG_A2A=1. Read the request body, log it, then
    reconstruct the request so downstream handlers still see the body.
    Capture the response by draining body_iterator and rebuilding.
    """
    if not DEBUG_A2A or request.url.path != "/a2a/v1" or request.method != "POST":
        return await call_next(request)

    body = await request.body()
    try:
        parsed = _json_dbg.loads(body)
        logger.info("A2A_DEBUG_REQ: %s", _json_dbg.dumps(parsed, default=str)[:3000])
    except Exception:
        logger.info("A2A_DEBUG_REQ_RAW: %s", body[:2000])

    async def _receive():
        return {"type": "http.request", "body": body, "more_body": False}

    rebuilt_request = Request(request.scope, _receive)
    response = await call_next(rebuilt_request)

    chunks: list[bytes] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
    full = b"".join(chunks)
    try:
        parsed = _json_dbg.loads(full)
        logger.info("A2A_DEBUG_RESP: %s", _json_dbg.dumps(parsed, default=str)[:4000])
    except Exception:
        logger.info("A2A_DEBUG_RESP_RAW: %s", full[:2000])

    return StarletteResponse(
        content=full,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.media_type,
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


# ── FHIR Context Extraction ─────────────────────────────────


def _extract_fhir_context_from_extension(
    message: dict[str, Any],
) -> dict[str, str]:
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
    header_ctx = _extract_fhir_context_from_headers(request)
    extension_ctx = (
        _extract_fhir_context_from_extension(message) if message else {}
    )

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
    text: str | None = None,
    artifact_name: str = "aria-analysis",
) -> dict[str, Any]:
    """Build an A2A v1.0 Task object.

    Always includes `artifacts` array (empty when no text). Each part
    declares both `kind` and `type` fields with value "text" — A2A v1.0
    spec uses `kind`, but some clients read `type`. Cheap insurance.
    """
    task: dict[str, Any] = {
        "id": task_id,
        "contextId": context_id,
        "kind": "task",
        "status": {"state": state, "timestamp": _now_iso()},
        "artifacts": [],
        "history": [],
    }
    if text:
        task["artifacts"] = [
            {
                "artifactId": str(uuid.uuid4()),
                "name": artifact_name,
                "parts": [
                    {
                        "kind": "text",
                        "type": "text",
                        "text": text,
                    }
                ],
            }
        ]
    return task


# ── Natural Language Payload Extraction ─────────────────────


def _extract_from_natural_language(text: str) -> dict[str, Any]:
    """Best-effort extractor for chat-style prompts.

    Po sends raw user text rather than JSON. We try to pull medications
    and patient context out of it.

    Example: 'Generate deprescribing plan for patient with these
              medications: warfarin, aspirin. Patient context:
              78 year old male, CKD stage 3.'
    """
    result: dict[str, Any] = {"medications": [], "patient": {}}

    med_match = re.search(
        r"(?:medications?|drugs?|meds?)\s*[:=]\s*([^.]+?)(?:\.|$|patient|context|with\s+|having\s+)",
        text,
        re.IGNORECASE,
    )
    if med_match:
        raw = med_match.group(1)
        meds = [m.strip().rstrip(".,") for m in re.split(r"[,;]|\sand\s", raw) if m.strip()]
        meds = [
            m for m in meds
            if 2 < len(m) < 60 and not m.lower().startswith(("a ", "an ", "the "))
        ]
        result["medications"] = meds

    age_match = re.search(r"(\d{1,3})\s*(?:year|yo|y/o|years?\s*old)", text, re.IGNORECASE)
    if age_match:
        result["patient"]["age"] = int(age_match.group(1))

    if re.search(r"\bfemale\b", text, re.IGNORECASE):
        result["patient"]["sex"] = "female"
    elif re.search(r"\bmale\b", text, re.IGNORECASE):
        result["patient"]["sex"] = "male"

    ckd_match = re.search(r"CKD\s*(?:stage\s*)?(\d)", text, re.IGNORECASE)
    if ckd_match:
        result["patient"]["ckd_stage"] = int(ckd_match.group(1))

    if re.search(r"hepatic\s*impairment|liver\s*(?:failure|disease|impairment)", text, re.IGNORECASE):
        result["patient"]["hepatic_impairment"] = True

    if re.search(r"\bsmoker?\b|\bsmoking\b", text, re.IGNORECASE):
        result["patient"]["smoking"] = True

    return result


def _parse_message_content(parts: list[dict[str, Any]]) -> dict[str, Any]:
    content_pieces: list[str] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if "text" in p:
            content_pieces.append(p.get("text") or "")
    content = "".join(content_pieces).strip()

    if not content:
        return {}

    # Strict JSON first
    try:
        data = json.loads(content)
        if isinstance(data, dict) and ("medications" in data or "patient" in data or "fhir" in data):
            return data
    except json.JSONDecodeError:
        pass

    # Natural-language fallback
    extracted = _extract_from_natural_language(content)
    if extracted.get("medications") or extracted.get("patient"):
        logger.info(
            "NL extracted: meds=%s patient=%s",
            extracted.get("medications"),
            extracted.get("patient"),
        )
        return extracted

    # Last resort: comma split
    return {"medications": [m.strip() for m in content.split(",") if m.strip() and len(m.strip()) < 60]}


def _payload_to_pipeline_args(payload: dict[str, Any]) -> tuple[list, Any, dict[str, Any]]:
    medications = payload.get("medications") or []
    patient = payload.get("patient")
    fhir = payload.get("fhir") or {}
    return medications, patient, fhir


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
    """Convert the ARIA pipeline result into a clinical Markdown report."""
    report = result.get("report") or {}
    graph = result.get("interaction_graph") or {}
    temporal = result.get("temporal_model") or {}
    plan = result.get("deprescribing_plan") or {}
    raw_ix = result.get("raw_interactions") or {}
    errors = result.get("errors") or []

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

    lines: list[str] = []
    lines.append("# 🧬 ARIA Polypharmacy Analysis")
    lines.append("")
    lines.append(f"**Patient:** {_fmt_patient(patient)}")
    lines.append(f"**Medications ({len(medications)}):** {_fmt_meds(medications)}")
    lines.append("")

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

    warnings = plan.get("warnings") or []
    if warnings:
        lines.append("## ⚠️ Warnings")
        lines.append("")
        for w in warnings[:6]:
            lines.append(f"- {w}")
        lines.append("")

    if errors:
        lines.append("## ⚙️ Pipeline Notes")
        lines.append("")
        for e in errors[:5]:
            lines.append(f"- _{e}_")
        lines.append("")

    rendered = "\n".join(lines).strip()

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
            # Blocking-first: most clients (including Po) get state=completed
            # in the same response. asyncTasks is technically supported (we
            # do return state=working when the budget expires, and tasks/get
            # works) but we don't advertise it because some clients then
            # expect immediate state=working and never block — which would
            # break the simple-client case. Polling clients still work; we
            # just don't promise it on the card.
            "asyncTasks": False,
            "experimental": {
                "fhirContextExtension": {
                    "supported": True,
                    "uri": PO_FHIR_CONTEXT_EXTENSION_URI,
                    "required": False,
                },
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


# ── Pipeline Helpers ────────────────────────────────────────


async def _run_pipeline_with_timeout(
    medications: list,
    patient: Any,
    fhir_ctx: dict[str, Any],
) -> dict[str, Any]:
    """Run the pipeline with a hard timeout."""
    async def _inner() -> dict[str, Any]:
        try:
            return await run_pipeline(
                medications, patient, mcp_client, fhir_context=fhir_ctx or None
            )
        except TypeError:
            return await run_pipeline(medications, patient, mcp_client)

    return await asyncio.wait_for(_inner(), timeout=PIPELINE_TIMEOUT_SECONDS)


async def _run_pipeline_and_store(
    task_id: str,
    context_id: str,
    medications: list,
    patient: Any,
    fhir_ctx: dict[str, Any],
) -> None:
    """Run the pipeline and store the resulting Task state.

    Always writes a final state (completed or failed) to TASK_STORE so a
    polling client always gets a valid response from tasks/get.
    """
    try:
        result = await _run_pipeline_with_timeout(medications, patient, fhir_ctx)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        await TASK_STORE.set(
            task_id, _build_task(task_id, context_id, "completed", markdown)
        )
        logger.info("A2A async: task %s completed", task_id)
    except asyncio.TimeoutError:
        msg = (
            f"⏱️ ARIA analysis timed out after {PIPELINE_TIMEOUT_SECONDS} seconds. "
            f"This usually happens when the Gemini reasoning or upstream APIs "
            f"are slow. Please try again with fewer medications, or hit the "
            f"REST endpoint directly:\n\n`POST {PUBLIC_AGENT_URL}/analyze`"
        )
        await TASK_STORE.set(
            task_id, _build_task(task_id, context_id, "failed", msg)
        )
        logger.error("A2A async: task %s timed out", task_id)
    except Exception as e:
        msg = f"❌ Analysis failed: {type(e).__name__}: {e}"
        await TASK_STORE.set(
            task_id, _build_task(task_id, context_id, "failed", msg)
        )
        logger.error("A2A async: task %s failed: %s", task_id, e, exc_info=True)


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
    """A2A v1.0 JSON-RPC 2.0 endpoint."""
    try:
        raw = await request.json()
    except Exception as e:
        logger.error("A2A: invalid JSON body: %s", e)
        return _jsonrpc_error(None, -32700, "Parse error")

    logger.info("A2A: method=%s id=%s", raw.get("method"), raw.get("id"))

    try:
        rpc = JSONRPCRequest(**raw)
    except Exception as e:
        logger.error("A2A: invalid JSON-RPC envelope: %s | body=%s", e, raw)
        return _jsonrpc_error(raw.get("id"), -32600, f"Invalid Request: {e}")

    if rpc.method in A2A_SEND_METHODS:
        return await _handle_message_send(rpc, request)

    if rpc.method in A2A_GET_METHODS:
        return await _handle_tasks_get(rpc)

    return _jsonrpc_error(rpc.id, -32601, f"Method not found: {rpc.method}")


async def _handle_message_send(
    rpc: JSONRPCRequest,
    request: Request,
) -> dict[str, Any]:
    """Handle A2A v1.0 message/send with blocking-first behavior."""
    message = rpc.params.get("message", {}) or {}
    parts = message.get("parts", []) or []

    fhir_ctx = _extract_fhir_context(request, message)

    payload = _parse_message_content(parts)
    payload = _merge_fhir_into_payload(payload, fhir_ctx)
    medications, patient, pipeline_fhir = _payload_to_pipeline_args(payload)

    logger.info(
        "A2A send: meds=%s patient=%s fhir_keys=%s",
        medications,
        patient,
        list(pipeline_fhir.keys()),
    )

    task_id = str(uuid.uuid4())
    context_id = message.get("contextId") or str(uuid.uuid4())

    if not medications and not pipeline_fhir.get("patient_id"):
        validation_msg = (
            "I couldn't extract any medications from your message. "
            "Please send a list of drugs, e.g. 'warfarin, aspirin, ibuprofen' "
            "with patient context like '78 year old male with CKD stage 3'."
        )
        return _jsonrpc_result(
            rpc.id, _build_task(task_id, context_id, "failed", validation_msg)
        )

    await TASK_STORE.set(task_id, _build_task(task_id, context_id, "working"))

    pipeline_task = asyncio.create_task(
        _run_pipeline_and_store(
            task_id, context_id, medications, patient, pipeline_fhir
        )
    )

    try:
        await asyncio.wait_for(
            asyncio.shield(pipeline_task),
            timeout=PO_BLOCKING_BUDGET_SECONDS,
        )
        logger.info(
            "A2A: task %s finished within %ds blocking budget",
            task_id, PO_BLOCKING_BUDGET_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.info(
            "A2A: task %s exceeded %ds blocking budget — returning 'working'",
            task_id, PO_BLOCKING_BUDGET_SECONDS,
        )

    final_task = await TASK_STORE.get(task_id)
    if final_task is None:
        final_task = _build_task(task_id, context_id, "working")

    # Defensive: never return a completed task with empty artifacts.
    state = (final_task.get("status") or {}).get("state")
    if state == "completed" and not final_task.get("artifacts"):
        logger.error(
            "A2A: task %s state=completed but artifacts empty — coercing to failed",
            task_id,
        )
        final_task = _build_task(
            task_id, context_id, "failed",
            "Analysis completed but produced no artifacts. This is an internal error.",
        )

    return _jsonrpc_result(rpc.id, final_task)


async def _handle_tasks_get(rpc: JSONRPCRequest) -> dict[str, Any]:
    """Handle A2A v1.0 tasks/get."""
    task_id = (
        rpc.params.get("id")
        or rpc.params.get("taskId")
        or rpc.params.get("task_id")
    )
    if not task_id or not isinstance(task_id, str):
        return _jsonrpc_error(rpc.id, -32602, "Missing or invalid task id in tasks/get params")

    task = await TASK_STORE.get(task_id)
    if task is None:
        return _jsonrpc_error(
            rpc.id, -32602, f"Task not found: {task_id} (may have been evicted)"
        )

    logger.info(
        "A2A: tasks/get id=%s state=%s",
        task_id, (task.get("status") or {}).get("state"),
    )
    return _jsonrpc_result(rpc.id, task)


@app.post("/a2a/tasks/send")
async def a2a_task_send_legacy(task: A2ATaskRequest, http_request: Request):
    """Legacy A2A task send endpoint. Sync blocking, no async lifecycle."""
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
                            "kind": "text",
                            "type": "text",
                            "text": "No medications and no FHIR patient context provided.",
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
            "artifacts": [
                {
                    "parts": [
                        {"kind": "text", "type": "text", "text": markdown}
                    ]
                }
            ],
        }
    except asyncio.TimeoutError:
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "kind": "text",
                            "type": "text",
                            "text": f"Analysis timed out after {PIPELINE_TIMEOUT_SECONDS}s",
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
            "artifacts": [
                {
                    "parts": [
                        {"kind": "text", "type": "text", "text": f"Analysis failed: {e}"}
                    ]
                }
            ],
        }


# ── Run ─────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("Starting ARIA Agent on %s:%d", HOST, PORT)
    logger.info("MCP Server URL: %s", MCP_SERVER_URL)
    logger.info("Public Agent URL: %s", PUBLIC_AGENT_URL)
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level="info")