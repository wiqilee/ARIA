"""Phenotype score step: apply patient-specific risk multipliers to each interaction."""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


# Single source of truth on the Python side. Mirrors `severity_label_for_score`
# in `mcp-server/src/agent_tools/score_risk.rs` and `frontend/lib/severity.ts`.
# If the MCP response already includes `severity_label`, we trust it (Rust is
# authoritative). If not, we backfill it here so the A2A response always has
# a label that matches the numeric score.
def _severity_label_for_score(score: float) -> str:
    if score is None or not isinstance(score, (int, float)) or math.isnan(score):
        return "LOW"
    s = max(0.0, min(10.0, float(score)))
    if s >= 8.5:
        return "CRITICAL"
    if s >= 5.0:
        return "HIGH"
    if s >= 2.0:
        return "MODERATE"
    return "LOW"


def _normalize_severity(risk_score: dict) -> dict:
    """Ensure every risk score has a deterministic severity_label."""
    if not isinstance(risk_score, dict):
        return risk_score
    adjusted = risk_score.get("adjusted_score", risk_score.get("base_score", 5.0))
    expected = _severity_label_for_score(adjusted)
    current = risk_score.get("severity_label")
    if current and str(current).upper() != expected:
        logger.warning(
            "Overriding inconsistent severity_label for interaction %s: "
            "score=%.2f, received=%r, expected=%r",
            risk_score.get("interaction_id"),
            float(adjusted) if isinstance(adjusted, (int, float)) else -1.0,
            current,
            expected,
        )
    risk_score["severity_label"] = expected
    return risk_score


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
            result = await mcp.score_risk(interaction, phenotype)
            return _normalize_severity(result) if result is not None else None
        except Exception as e:
            logger.error("score_risk failed for %s: %s", interaction.get("id"), e)
            errors.append(f"Risk scoring failed for interaction {interaction.get('id')}: {e}")
            return None

    if interactions:
        tasks = [score_one(i) for i in interactions]
        results = await asyncio.gather(*tasks)
        risk_scores = [r for r in results if r is not None]

    logger.info("Phenotype scoring: %d/%d interactions scored", len(risk_scores), len(interactions))

    # Compute overall risk = max adjusted_score across all interactions, and
    # tag it with a deterministic severity_label so downstream renderers
    # (Vercel report, Prompt Opinion artifact, PDF export) never disagree
    # with the numeric score again.
    overall_risk = None
    if risk_scores:
        max_score = max(
            (rs.get("adjusted_score", 0.0) for rs in risk_scores if isinstance(rs, dict)),
            default=0.0,
        )
        overall_risk = {
            "score": max_score,
            "severity_label": _severity_label_for_score(max_score),
        }

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
        "overall_risk": overall_risk,
        "interactions": updated_interactions,
        "errors": errors,
    }
