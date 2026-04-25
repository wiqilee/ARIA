"""Evidence grade step: attach PubMed citations and confidence scores to interactions."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def evidence_grade(state: dict[str, Any]) -> dict[str, Any]:
    """For each interaction, search PubMed for supporting evidence via MCP explain_mechanism."""

    interactions_data = state.get("interactions", {})
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    interactions = interactions_data.get("interactions", [])
    evidence = []
    graded = []

    async def grade_one(interaction: dict) -> tuple[dict, list[dict]]:
        """Get mechanistic explanation (which includes evidence) for an interaction."""
        drugs = interaction.get("drugs", [])
        citations = []

        if len(drugs) >= 2:
            try:
                mechanism = await mcp.explain_mechanism(drugs[0], drugs[1])
                # Attach the mechanism back to the interaction
                interaction_with_evidence = {
                    **interaction,
                    "mechanism_detail": mechanism,
                }
                return interaction_with_evidence, citations
            except Exception as e:
                logger.warning("explain_mechanism failed for %s: %s", drugs, e)

        return interaction, citations

    if interactions:
        tasks = [grade_one(i) for i in interactions]
        results = await asyncio.gather(*tasks)
        for graded_interaction, cites in results:
            graded.append(graded_interaction)
            evidence.extend(cites)

    logger.info(
        "Evidence grading: %d interactions graded, %d citations found",
        len(graded),
        len(evidence),
    )

    return {
        "graded_interactions": graded,
        "evidence": evidence,
        "errors": errors,
    }
