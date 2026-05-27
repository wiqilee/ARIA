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


def _clamp_score(score: Any) -> float:
    """Clamp any incoming value to the canonical 0.0–10.0 risk range.

    Why this exists: the Rust MCP server `score_risk` tool has been observed
    to occasionally pass through a raw LLM-emitted score outside the 0–10
    band (e.g. an LLM that interpreted the score as a percentage and
    returned 95.0, or a buggy aggregation that summed instead of averaging
    and produced 15.3). Every downstream renderer — the Vercel report
    banner, the Prompt Opinion artifact text, the PDF export — assumes the
    value is bounded, so we clamp here as the last line of defence before
    it leaves the agent. The unclamped value is preserved separately as
    `raw_score` for diagnostics.
    """
    if score is None or not isinstance(score, (int, float)) or math.isnan(score):
        return 0.0
    return max(0.0, min(10.0, float(score)))


def _normalize_severity(risk_score: dict) -> dict:
    """Ensure every risk score has a deterministic severity_label and a
    clamped 0–10 numeric value."""
    if not isinstance(risk_score, dict):
        return risk_score

    raw_adjusted = risk_score.get("adjusted_score", risk_score.get("base_score", 5.0))
    raw_base = risk_score.get("base_score", raw_adjusted)
    clamped_adjusted = _clamp_score(raw_adjusted)
    clamped_base = _clamp_score(raw_base)

    # If we had to clamp, keep the original around so we can audit what the
    # LLM (or Rust pass-through) produced. Don't silently lose it.
    if isinstance(raw_adjusted, (int, float)) and not math.isnan(raw_adjusted):
        if float(raw_adjusted) != clamped_adjusted:
            logger.warning(
                "Clamped out-of-range adjusted_score for %s: %s → %.2f",
                risk_score.get("interaction_id"),
                raw_adjusted,
                clamped_adjusted,
            )
            risk_score["raw_adjusted_score"] = float(raw_adjusted)

    risk_score["adjusted_score"] = clamped_adjusted
    risk_score["base_score"] = clamped_base

    expected = _severity_label_for_score(clamped_adjusted)
    current = risk_score.get("severity_label")
    if current and str(current).upper() != expected:
        logger.warning(
            "Overriding inconsistent severity_label for interaction %s: "
            "score=%.2f, received=%r, expected=%r",
            risk_score.get("interaction_id"),
            clamped_adjusted,
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
    #
    # `adjusted_score` is already clamped to [0, 10] by `_normalize_severity`,
    # so `max(...)` is guaranteed to also be in range. We never want to emit
    # a "15.3 / 10" anywhere — that bug was produced by a downstream
    # consumer reading an un-clamped raw field.
    overall_risk = None
    if risk_scores:
        max_score = _clamp_score(
            max(
                (rs.get("adjusted_score", 0.0) for rs in risk_scores if isinstance(rs, dict)),
                default=0.0,
            )
        )
        # Capture the raw (un-clamped) maximum too, so a future debugger can
        # tell the difference between "the LLM was reasonable" and "we had
        # to rein it in".
        raw_max = max(
            (
                rs.get("raw_adjusted_score", rs.get("adjusted_score", 0.0))
                for rs in risk_scores
                if isinstance(rs, dict)
            ),
            default=0.0,
        )
        overall_risk = {
            "score": max_score,
            "raw_score": float(raw_max) if raw_max is not None else max_score,
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
