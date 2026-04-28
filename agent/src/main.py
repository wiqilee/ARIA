"""ARIA A2A Agent — FastAPI entrypoint with A2A protocol support."""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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
        logger.warning("MCP server at %s is not reachable — agent will retry on requests", MCP_SERVER_URL)
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


# ── A2A Protocol Models ─────────────────────────────────────


class A2ATaskRequest(BaseModel):
    """Simplified A2A task send request."""
    id: str
    message: dict[str, Any]


# ── A2A Agent Card Builder ──────────────────────────────────


def _build_agent_card() -> dict[str, Any]:
    """Construct the A2A agent card describing this agent's capabilities.

    Uses PUBLIC_AGENT_URL env var so external clients (e.g. Prompt Opinion)
    can call back the agent at its public URL, not the internal container address.
    """
    return {
        "name": "ARIA",
        "description": (
            "Adaptive Risk Intelligence for Polypharmacy Assessment. "
            "Detects N-drug interactions, predicts risk timelines, "
            "and generates evidence-based deprescribing plans."
        ),
        "url": PUBLIC_AGENT_URL,
        "version": "0.1.0",
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
            }
        ],
    }


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

    # Convert medications to the pipeline format
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


@app.post("/a2a/tasks/send")
async def a2a_task_send(task: A2ATaskRequest):
    """Handle an A2A task send request (from Prompt Opinion or other A2A agents)."""

    message = task.message
    content = message.get("parts", [{}])[0].get("text", "")

    # Parse the message content as medication analysis request
    # Expected: JSON with medications and optional patient context
    import json

    try:
        data = json.loads(content) if isinstance(content, str) else content
    except json.JSONDecodeError:
        # Treat as a plain text medication list
        medications = [m.strip() for m in content.split(",") if m.strip()]
        data = {"medications": medications}

    medications = data.get("medications", [])
    patient = data.get("patient")

    if not medications:
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [{
                "parts": [{"text": "No medications provided. Please send a list of medications to analyze."}]
            }],
        }

    try:
        result = await run_pipeline(medications, patient, mcp_client)

        return {
            "id": task.id,
            "status": {"state": "completed"},
            "artifacts": [{
                "parts": [{
                    "text": json.dumps(result, default=str),
                }]
            }],
        }
    except Exception as e:
        return {
            "id": task.id,
            "status": {"state": "failed"},
            "artifacts": [{
                "parts": [{"text": f"Analysis failed: {e}"}]
            }],
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
