"""Phenotype score step: apply patient-specific risk multipliers to each interaction."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def phenotype_score(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP score_risk for each detected interaction + compute burden scores."""

    interactions_data = state.get("interactions", {})
    patient = state.get("patient", {})
    drugs = state.get("normalized_drugs", [])
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    interactions = interactions_data.get("interactions", [])
    phenotype = {
        "age": patient.get("age", 50),
        "sex": patient.get("sex", "unknown"),
        "weight_kg": patient.get("weight_kg"),
        "ckd_stage": patient.get("ckd_stage", 0),
        "hepatic_impairment": patient.get("hepatic_impairment", False),
        "smoking": patient.get("smoking", False),
    }

    # Score each interaction in parallel
    risk_scores = []

    async def score_one(interaction: dict) -> dict | None:
        try:
            return await mcp.score_risk(interaction, phenotype)
        except Exception as e:
            logger.error("score_risk failed for %s: %s", interaction.get("id"), e)
            errors.append(f"Risk scoring failed for interaction {interaction.get('id')}: {e}")
            return None

    if interactions:
        tasks = [score_one(i) for i in interactions]
        results = await asyncio.gather(*tasks)
        risk_scores = [r for r in results if r is not None]

    logger.info("Phenotype scoring: %d/%d interactions scored", len(risk_scores), len(interactions))

    # Also compute burden scores
    drug_dicts = [{"name": d["name"]} for d in drugs]
    burden = None
    try:
        burden = await mcp.compute_burden_scores(drug_dicts)
        logger.info("Burden scores computed successfully")
    except Exception as e:
        logger.error("compute_burden_scores failed: %s", e)
        errors.append(f"Burden score computation failed: {e}")

    # Attach burden to interactions data for downstream use
    updated_interactions = {**interactions_data}
    if burden:
        updated_interactions["burden_scores"] = burden

    return {
        "risk_scores": risk_scores,
        "interactions": updated_interactions,
        "errors": errors,
    }
