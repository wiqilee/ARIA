"""ARIA A2A Agent — FastAPI entrypoint with A2A v1.0 (JSON-RPC 2.0) protocol support."""

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
            "MCP server at %s is not reachable — agent will retry on requests",
            MCP_SERVER_URL,
        )
    logger.info("Public agent URL: %s", PUBLIC_AGENT_URL)
    yield
    logger.info("ARIA Agent shutting down")


# ── FastAPI App ─────────────────────────────────────────────

app = FastAPI(
    title="ARIA A2A Agent",
    description="Adaptive Risk Intelligence for Polypharmacy Assessment — Agent Layer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


# ── A2A Agent Card Builder (v1 spec) ────────────────────────


def _build_agent_card() -> dict[str, Any]:
    """Construct the A2A v1 agent card.

    Conforms to the v1 spec changes:
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
        },
        "defaultInputModes": ["text/plain", "application/json"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "supportedInterfaces": [
            {
                # NEW: A2A v1.0 JSON-RPC 2.0 endpoint (preferred)
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


def _parse_message_content(parts: list[dict[str, Any]]) -> tuple[list, Any]:
    """Extract medications + patient context from A2A message parts."""
    content = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p)

    try:
        data = json.loads(content) if content else {}
    except json.JSONDecodeError:
        # Fall back: treat as comma-separated drug list
        data = {"medications": [m.strip() for m in content.split(",") if m.strip()]}

    medications = data.get("medications", []) if isinstance(data, dict) else []
    patient = data.get("patient") if isinstance(data, dict) else None
    return medications, patient


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
async def analyze(request: AnalyzeRequest):
    """Main analysis endpoint. Runs the full ARIA pipeline."""
    meds: list[str | dict] = []
    for med in request.medications:
        if isinstance(med, str):
            meds.append(med)
        elif isinstance(med, DrugInput):
            meds.append(med.model_dump(exclude_none=True))
        elif isinstance(med, dict):
            meds.append(med)

    patient_ctx = request.patient.model_dump() if request.patient else None

    try:
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
    Supported method aliases (see A2A_SEND_METHODS):
      - message/send   (A2A spec)
      - tasks/send     (A2A spec, legacy alias)
      - SendMessage    (Prompt Opinion convention)
      - sendMessage    (camelCase variant)
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
        return await _handle_message_send(rpc)

    return _jsonrpc_error(rpc.id, -32601, f"Method not found: {rpc.method}")


async def _handle_message_send(rpc: JSONRPCRequest) -> dict[str, Any]:
    """Process an A2A v1.0 message/send (or alias) request and return a completed Task."""
    message = rpc.params.get("message", {}) or {}
    parts = message.get("parts", []) or []

    medications, patient = _parse_message_content(parts)

    task_id = str(uuid.uuid4())
    context_id = message.get("contextId") or str(uuid.uuid4())

    if not medications:
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "failed",
                "No medications provided. Send JSON with a 'medications' array, "
                "or a comma-separated drug list.",
            ),
        )

    try:
        result = await run_pipeline(medications, patient, mcp_client)
        return _jsonrpc_result(
            rpc.id,
            _build_task(
                task_id,
                context_id,
                "completed",
                json.dumps(result, default=str),
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
async def a2a_task_send_legacy(task: A2ATaskRequest):
    """Legacy A2A task send endpoint (pre-JSON-RPC). Kept for backward compatibility."""
    message = task.message
    parts = message.get("parts", []) if isinstance(message, dict) else []
    medications, patient = _parse_message_content(parts)

    if not medications:
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "text": "No medications provided. Please send a list of medications to analyze."
                        }
                    ]
                }
            ],
        }

    try:
        result = await run_pipeline(medications, patient, mcp_client)
        return {
            "id": task.id,
            "status": {"state": "completed"},
            "artifacts": [
                {"parts": [{"text": json.dumps(result, default=str)}]}
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