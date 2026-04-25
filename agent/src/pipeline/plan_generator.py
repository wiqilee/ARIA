"""Plan generate step: produce a prioritized deprescribing plan via MCP tool."""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def plan_generate(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP generate_deprescribing_plan with the full analysis."""

    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {})
    interactions = state.get("interactions", {})
    interaction_graph = state.get("interaction_graph", {})
    risk_scores = state.get("risk_scores", [])
    temporal = state.get("temporal", {})
    evidence = state.get("evidence", [])
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    # Build the full analysis object expected by the MCP tool
    analysis = {
        "medications": [d["name"] for d in drugs],
        "patient_context": patient,
        "interactions": interactions,
        "graph": interaction_graph if interaction_graph else None,
        "risk_scores": risk_scores,
        "burden_scores": interactions.get("burden_scores"),
        "temporal_model": temporal if temporal else None,
        "evidence": evidence,
    }

    deprescribing_plan = {}
    try:
        deprescribing_plan = await mcp.generate_deprescribing_plan(analysis)
        step_count = len(deprescribing_plan.get("steps", []))
        total_reduction = deprescribing_plan.get("total_expected_risk_reduction", 0)
        logger.info(
            "Deprescribing plan: %d steps, %.1f%% expected risk reduction",
            step_count,
            total_reduction,
        )
    except Exception as e:
        logger.error("generate_deprescribing_plan failed: %s", e)
        errors.append(f"Deprescribing plan generation failed: {e}")

    return {
        "deprescribing_plan": deprescribing_plan,
        "errors": errors,
    }
