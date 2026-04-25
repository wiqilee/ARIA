"""Normalize step: map drug names to RxNorm CUIs via the MCP server."""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def normalize(state: dict[str, Any]) -> dict[str, Any]:
    """Resolve each drug to its RxNorm CUI using the MCP check_interactions tool.

    The MCP server handles RxNorm resolution internally. We pass drugs through
    and let the server normalize them. For the agent, we track which drugs
    have been resolved.
    """

    drugs = state.get("drugs", [])
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    normalized = []
    for drug in drugs:
        # If already has rxcui, keep it
        if drug.get("rxcui"):
            normalized.append({
                **drug,
                "normalized_name": drug["name"],
            })
            continue

        # Otherwise, the MCP server will resolve it during tool calls.
        # For now, mark it as pending resolution.
        normalized.append({
            **drug,
            "normalized_name": drug["name"],
        })

    logger.info("Normalize: %d drugs ready for analysis", len(normalized))

    return {
        "normalized_drugs": normalized,
        "errors": errors,
    }
