"""ARIA A2A Agent: FastAPI entrypoint with A2A v1.0 (JSON-RPC) protocol support.

CRITICAL v1.0 wire format per official A2A spec:
https://github.com/a2aproject/a2a-dotnet/blob/main/docs/migration-guide-v1.md

1. Response is wrapped: result.task = {...} (NOT result = {kind:"task",...})
2. State enums use SCREAMING_SNAKE_CASE: "TASK_STATE_COMPLETED"
3. Parts are FLAT, no kind discriminator: {"text": "..."}
4. Role: "ROLE_USER" / "ROLE_AGENT"

FHIR access context propagation through TWO channels:
1. A2A Extension payload: https://app.promptopinion.ai/schemas/a2a/v1/fhir-context
2. SHARP HTTP headers: X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID
"""

from __future__ import annotations

import asyncio
import json
import json as _json_dbg
import logging
import math
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

A2A_PROTOCOL_VERSION = "1.0.0"

PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))
PO_BLOCKING_BUDGET_SECONDS = int(os.getenv("PO_BLOCKING_BUDGET_SECONDS", "170"))
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

A2A_RPC_PATHS = frozenset({"/", "/a2a/v1"})

PO_FHIR_CONTEXT_EXTENSION_URI = (
    "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context"
)

SHARP_HEADER_FHIR_SERVER_URL = "X-FHIR-Server-URL"
SHARP_HEADER_ACCESS_TOKEN = "X-FHIR-Access-Token"
SHARP_HEADER_PATIENT_ID = "X-Patient-ID"

# A2A v1.0 ProtoJSON state enum mapping
TASK_STATE_WORKING = "TASK_STATE_WORKING"
TASK_STATE_COMPLETED = "TASK_STATE_COMPLETED"
TASK_STATE_FAILED = "TASK_STATE_FAILED"
TASK_STATE_SUBMITTED = "TASK_STATE_SUBMITTED"

# ── MCP Client ──────────────────────────────────────────────

mcp_client = MCPClient(MCP_SERVER_URL)

# ── In-memory Task Store ────────────────────────────────────


class TaskStore:
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
    logger.info("A2A protocol version: %s", A2A_PROTOCOL_VERSION)
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


# ── Debug Middleware ────────────────────────────────────────


@app.middleware("http")
async def _debug_a2a_io(request: Request, call_next):
    is_a2a = (
        DEBUG_A2A
        and request.method == "POST"
        and request.url.path in A2A_RPC_PATHS
    )
    if not is_a2a:
        return await call_next(request)

    body = await request.body()
    try:
        parsed = _json_dbg.loads(body)
        logger.info(
            "A2A_DEBUG_REQ path=%s body=%s",
            request.url.path,
            _json_dbg.dumps(parsed, default=str)[:3000],
        )
    except Exception:
        logger.info("A2A_DEBUG_REQ_RAW path=%s body=%s", request.url.path, body[:2000])

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
        logger.info(
            "A2A_DEBUG_RESP path=%s body=%s",
            request.url.path,
            _json_dbg.dumps(parsed, default=str)[:4000],
        )
    except Exception:
        logger.info("A2A_DEBUG_RESP_RAW path=%s body=%s", request.url.path, full[:2000])

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

# ── Models ──────────────────────────────────────────────────


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


def _extract_fhir_context_from_extension(message: dict[str, Any]) -> dict[str, str]:
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


# ── A2A v1.0 Helpers ────────────────────────────────────────


def _now_iso() -> str:
    """ISO 8601 with Z suffix per A2A v1.0 spec section 5.6.1."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _jsonrpc_result(req_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }


def _build_task_inner(
    task_id: str,
    context_id: str,
    state: str,
    text: str | None = None,
    artifact_name: str = "aria-analysis",
) -> dict[str, Any]:
    """Build the INNER Task object (without the {"task": ...} wrapper).

    A2A v1.0 ProtoJSON wire format per official spec:
    - State enum is SCREAMING_SNAKE_CASE: TASK_STATE_COMPLETED, etc.
    - Parts are FLAT — no kind discriminator: just {"text": "..."}
    - This object will be wrapped as {"task": {...}} when returned via JSON-RPC.
    """
    task: dict[str, Any] = {
        "id": task_id,
        "contextId": context_id,
        "status": {
            "state": state,
            "timestamp": _now_iso(),
        },
        "history": [],
        "artifacts": [],
    }
    if text:
        task["artifacts"] = [
            {
                "artifactId": str(uuid.uuid4()),
                "name": artifact_name,
                "parts": [
                    {"text": text},  # v1.0 flat format — no kind field
                ],
            }
        ]
    return task


def _wrap_task_response(task_inner: dict[str, Any]) -> dict[str, Any]:
    """Wrap inner Task into the v1.0 result envelope: {"task": {...}}.

    Per A2A v1.0 spec, JSON-RPC responses use named wrappers instead of
    kind discriminators:
        v0.3: result = {"kind": "task", "id": "...", ...}
        v1.0: result = {"task": {"id": "...", ...}}
    """
    return {"task": task_inner}


# ── Natural Language Payload Extraction ─────────────────────


def _extract_from_natural_language(text: str) -> dict[str, Any]:
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
    """Extract text from message parts.

    Supports both v0.3 ({"kind":"text","text":...}) and v1.0 ({"text":...})
    formats — v1.0 is flat with no kind field, just the text field.
    """
    content_pieces: list[str] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if "text" in p:
            content_pieces.append(p.get("text") or "")
    content = "".join(content_pieces).strip()

    if not content:
        return {}

    try:
        data = json.loads(content)
        if isinstance(data, dict) and ("medications" in data or "patient" in data or "fhir" in data):
            return data
    except json.JSONDecodeError:
        pass

    extracted = _extract_from_natural_language(content)
    if extracted.get("medications") or extracted.get("patient"):
        logger.info(
            "NL extracted: meds=%s patient=%s",
            extracted.get("medications"),
            extracted.get("patient"),
        )
        return extracted

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


def _format_risk_reduction(raw: Any) -> str | None:
    """Normalize a risk-reduction value into a clinically valid percentage string.

    Risk reduction is bounded between 0% and 100%. This guardrail prevents
    nonsensical outputs like "1200%" that would undermine clinical credibility.

    Detection heuristic:
    - If 0 <= raw <= 1.0, treat as a fraction (e.g. 0.73 → 73%).
    - If 1 < raw <= 100, treat as already-in-percent (e.g. 73 → 73%).
    - If raw > 100, clamp to 100% and log a warning (likely a pipeline bug
      such as naive summation of per-interaction reductions, which should
      instead be combined probabilistically via 1 - Π(1 - r_i)).
    - Negative, NaN, or non-numeric inputs return None (omit the line).

    Returns the formatted percentage string (e.g. "73%") or None if the
    input cannot be sensibly rendered.
    """
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    if value < 0:
        return None

    if value <= 1.0:
        pct = value * 100.0
    else:
        pct = value

    if pct > 100.0:
        logger.warning(
            "Risk reduction value %s exceeds 100%% — clamping. This usually "
            "indicates the pipeline is summing per-interaction reductions "
            "linearly instead of combining them probabilistically.",
            raw,
        )
        pct = 100.0

    return f"{round(pct)}%"


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
        formatted_reduction = _format_risk_reduction(total_red)
        if formatted_reduction is not None:
            lines.append("")
            lines.append(
                f"**Expected total risk reduction:** {formatted_reduction}"
            )
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


# ── A2A v1.0 Agent Card Builder ─────────────────────────────


def _build_agent_card() -> dict[str, Any]:
    """Build the A2A v1.0 agent card per Po migration guide."""
    endpoint = f"{PUBLIC_AGENT_URL}/a2a/v1"
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
            "extensions": [
                {
                    "uri": PO_FHIR_CONTEXT_EXTENSION_URI,
                    "description": "FHIR context allowing the agent to query a FHIR server securely",
                    "required": False,
                }
            ],
        },
        "defaultInputModes": ["text/plain", "application/json"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "supportedInterfaces": [
            {
                "url": endpoint,
                "protocolBinding": "JSONRPC",
                "protocolVersion": A2A_PROTOCOL_VERSION,
                "transport": "JSONRPC",
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
    try:
        result = await _run_pipeline_with_timeout(medications, patient, fhir_ctx)
        markdown = _format_pipeline_result_markdown(medications, patient, result)
        await TASK_STORE.set(
            task_id, _build_task_inner(task_id, context_id, TASK_STATE_COMPLETED, markdown)
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
            task_id, _build_task_inner(task_id, context_id, TASK_STATE_FAILED, msg)
        )
        logger.error("A2A async: task %s timed out", task_id)
    except Exception as e:
        msg = f"❌ Analysis failed: {type(e).__name__}: {e}"
        await TASK_STORE.set(
            task_id, _build_task_inner(task_id, context_id, TASK_STATE_FAILED, msg)
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


@app.get("/")
async def root_get():
    return _build_agent_card()


@app.get("/.well-known/agent.json")
async def agent_card_legacy():
    return _build_agent_card()


@app.get("/.well-known/agent-card.json")
async def agent_card_standard():
    return _build_agent_card()


@app.post("/")
@app.post("/a2a/v1")
async def a2a_jsonrpc(request: Request):
    """A2A v1.0 JSON-RPC endpoint."""
    try:
        raw = await request.json()
    except Exception as e:
        logger.error("A2A: invalid JSON body: %s", e)
        return _jsonrpc_error(None, -32700, "Parse error")

    logger.info(
        "A2A: path=%s method=%s id=%s",
        request.url.path,
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

    if rpc.method in A2A_GET_METHODS:
        return await _handle_tasks_get(rpc)

    return _jsonrpc_error(rpc.id, -32601, f"Method not found: {rpc.method}")


async def _handle_message_send(
    rpc: JSONRPCRequest,
    request: Request,
) -> dict[str, Any]:
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
        task_inner = _build_task_inner(task_id, context_id, TASK_STATE_FAILED, validation_msg)
        return _jsonrpc_result(rpc.id, _wrap_task_response(task_inner))

    await TASK_STORE.set(
        task_id, _build_task_inner(task_id, context_id, TASK_STATE_WORKING)
    )

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

    final_task_inner = await TASK_STORE.get(task_id)
    if final_task_inner is None:
        final_task_inner = _build_task_inner(task_id, context_id, TASK_STATE_WORKING)

    state = (final_task_inner.get("status") or {}).get("state")
    if state == TASK_STATE_COMPLETED and not final_task_inner.get("artifacts"):
        logger.error(
            "A2A: task %s state=completed but artifacts empty — coercing to failed",
            task_id,
        )
        final_task_inner = _build_task_inner(
            task_id, context_id, TASK_STATE_FAILED,
            "Analysis completed but produced no artifacts. This is an internal error.",
        )

    # CRITICAL: A2A v1.0 wraps Task in {"task": {...}} per spec.
    return _jsonrpc_result(rpc.id, _wrap_task_response(final_task_inner))


async def _handle_tasks_get(rpc: JSONRPCRequest) -> dict[str, Any]:
    task_id = (
        rpc.params.get("id")
        or rpc.params.get("taskId")
        or rpc.params.get("task_id")
    )
    if not task_id or not isinstance(task_id, str):
        return _jsonrpc_error(rpc.id, -32602, "Missing or invalid task id in tasks/get params")

    task_inner = await TASK_STORE.get(task_id)
    if task_inner is None:
        return _jsonrpc_error(
            rpc.id, -32602, f"Task not found: {task_id} (may have been evicted)"
        )

    logger.info(
        "A2A: tasks/get id=%s state=%s",
        task_id, (task_inner.get("status") or {}).get("state"),
    )
    return _jsonrpc_result(rpc.id, _wrap_task_response(task_inner))


@app.post("/a2a/tasks/send")
async def a2a_task_send_legacy(task: A2ATaskRequest, http_request: Request):
    """Legacy v0.3-style endpoint kept for backwards compat. Uses old format."""
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
                {"parts": [{"text": "No medications and no FHIR patient context provided."}]}
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
                {"parts": [{"text": f"Analysis timed out after {PIPELINE_TIMEOUT_SECONDS}s"}]}
            ],
        }
    except Exception as e:
        logger.error("Legacy A2A pipeline failed: %s", e, exc_info=True)
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [{"parts": [{"text": f"Analysis failed: {e}"}]}],
        }


if __name__ == "__main__":
    logger.info("Starting ARIA Agent on %s:%d", HOST, PORT)
    logger.info("MCP Server URL: %s", MCP_SERVER_URL)
    logger.info("Public Agent URL: %s", PUBLIC_AGENT_URL)
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level="info")