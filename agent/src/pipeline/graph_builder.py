"""Graph build step: construct N-drug interaction graph via MCP tools."""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def graph_build(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP check_interactions and build_interaction_graph tools."""

    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {})
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    drug_dicts = [{"name": d["name"], "rxcui": d.get("rxcui")} for d in drugs]

    # Step 1: Detect all interactions
    interactions = {}
    try:
        interactions = await mcp.check_interactions(drug_dicts, patient)
        logger.info(
            "Interactions found: %d (critical: %s, high: %s)",
            interactions.get("total_interactions", 0),
            interactions.get("critical_count", 0),
            interactions.get("high_count", 0),
        )
    except Exception as e:
        logger.error("check_interactions failed: %s", e)
        errors.append(f"Interaction check failed: {e}")

    # Step 2: Build the full interaction graph
    interaction_graph = {}
    try:
        interaction_graph = await mcp.build_interaction_graph(drug_dicts)
        hub_count = len(interaction_graph.get("hub_drugs", []))
        emergent_count = len(interaction_graph.get("emergent_interactions", []))
        logger.info(
            "Graph built: %d edges, %d hub drugs, %d emergent interactions",
            interaction_graph.get("total_edges", 0),
            hub_count,
            emergent_count,
        )
    except Exception as e:
        logger.error("build_interaction_graph failed: %s", e)
        errors.append(f"Graph build failed: {e}")

    return {
        "interactions": interactions,
        "interaction_graph": interaction_graph,
        "errors": errors,
    }
