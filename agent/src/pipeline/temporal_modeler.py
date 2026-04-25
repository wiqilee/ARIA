"""Temporal model step: project risk cascade timelines via MCP tool."""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)

DEFAULT_TIMELINE_DAYS = 14


async def temporal_model(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP model_temporal_cascade to project risk evolution over time."""

    drugs = state.get("normalized_drugs", [])
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    drug_dicts = [{"name": d["name"]} for d in drugs]
    temporal = {}

    try:
        temporal = await mcp.model_temporal_cascade(drug_dicts, DEFAULT_TIMELINE_DAYS)
        logger.info(
            "Temporal model: peak risk day %d (score %.1f), %d intervention windows",
            temporal.get("peak_risk_day", 0),
            temporal.get("peak_risk_score", 0.0),
            len(temporal.get("intervention_windows", [])),
        )
    except Exception as e:
        logger.error("model_temporal_cascade failed: %s", e)
        errors.append(f"Temporal modeling failed: {e}")

    return {
        "temporal": temporal,
        "errors": errors,
    }
