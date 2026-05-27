"""Report build step: assemble the final structured clinical report via MCP tool."""

from __future__ import annotations

import logging
import math
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


# Mirrors `severity_label_for_score` in `mcp-server/src/agent_tools/score_risk.rs`
# and `frontend/lib/severity.ts`. See `phenotype_scorer.py` for the matching
# implementation. Duplicated here (as a private helper) so this module can do
# the final override of MCP-emitted labels without importing from a sibling
# step file — keeps the LangGraph nodes loosely coupled.
def _severity_label_for_score(score: Any) -> str:
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
    if score is None or not isinstance(score, (int, float)) or math.isnan(score):
        return 0.0
    return max(0.0, min(10.0, float(score)))


def _enforce_overall_risk(report: dict, overall_risk: dict | None) -> dict:
    """Force the report's overall_risk_score and overall_risk_level to match
    the deterministic Python-side computation.

    Why this exists: the MCP server's `generate_report` tool builds its own
    overall-risk summary by asking Gemini, which has been observed to:
      (a) emit numeric scores outside the [0, 10] band (e.g. "15.3 / 10"
          shown in Prompt Opinion when the LLM summed pair severities), and
      (b) attach a label that disagrees with whatever number it picked
          ("15.3 / 10" tagged "MODERATE" even though anything ≥ 8.5 is
          CRITICAL by the README threshold).

    The agent layer already computes a clean overall risk in
    `phenotype_scorer.py` using the deterministic threshold. We propagate
    that value here as the *final* authority. The original MCP-emitted
    fields are preserved with `_mcp_*` prefixes so a future debugger can
    diff them. The artifact text rendered to Prompt Opinion / Vercel / PDF
    all read from these canonical fields.
    """
    if not isinstance(report, dict):
        return report

    if overall_risk:
        score = _clamp_score(overall_risk.get("score"))
        label = (overall_risk.get("severity_label") or _severity_label_for_score(score)).upper()
    else:
        # No agent-side computation available — fall back to whatever the
        # MCP report said, but still clamp and re-derive the label from
        # the (clamped) numeric score so the two fields agree.
        score = _clamp_score(report.get("overall_risk_score"))
        label = _severity_label_for_score(score)

    # Stash any prior MCP-emitted values so they're not silently lost.
    if "overall_risk_score" in report and report["overall_risk_score"] != score:
        report["_mcp_overall_risk_score"] = report["overall_risk_score"]
        logger.warning(
            "Overriding MCP overall_risk_score %r → %.2f (clamped/recomputed)",
            report.get("overall_risk_score"),
            score,
        )
    if "overall_risk_level" in report:
        mcp_lvl = str(report["overall_risk_level"]).upper()
        if mcp_lvl != label:
            report["_mcp_overall_risk_level"] = report["overall_risk_level"]
            logger.warning(
                "Overriding MCP overall_risk_level %r → %r (matches numeric score %.2f)",
                report.get("overall_risk_level"),
                label,
                score,
            )

    report["overall_risk_score"] = score
    report["overall_risk_level"] = label.lower()  # downstream UI expects lowercase

    return report


async def report_build(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP generate_report with the full analysis to produce the final report."""

    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {})
    interactions = state.get("interactions", {})
    interaction_graph = state.get("interaction_graph", {})
    risk_scores = state.get("risk_scores", [])
    overall_risk = state.get("overall_risk")  # computed by phenotype_scorer.py
    temporal = state.get("temporal", {})
    evidence = state.get("evidence", [])
    deprescribing_plan = state.get("deprescribing_plan", {})
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    # Build the full analysis object
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

    report: dict = {}
    try:
        report = await mcp.generate_report(analysis)

        # Attach the deprescribing plan to the report
        if deprescribing_plan:
            report["deprescribing_plan"] = deprescribing_plan

        # ── CRITICAL: enforce single source of truth ────────────────────
        # Override MCP's overall_risk_score / overall_risk_level with the
        # Python-side deterministic values. Without this, the Prompt
        # Opinion artifact has been seen rendering "🔴 Risk score: 15.3 /
        # 10 • Level: MODERATE" — both fields wrong, both produced by
        # the LLM-side aggregation in the MCP report tool.
        report = _enforce_overall_risk(report, overall_risk)

        logger.info(
            "Report generated: overall risk = %.2f / 10 (%s)",
            report.get("overall_risk_score", 0.0),
            report.get("overall_risk_level", "unknown"),
        )
    except Exception as e:
        logger.error("generate_report failed: %s", e)
        errors.append(f"Report generation failed: {e}")

        # Build a fallback report from available data
        report = _build_fallback_report(
            drugs, patient, interactions, risk_scores, overall_risk, errors
        )

    return {
        "report": report,
        "errors": errors,
    }


def _build_fallback_report(
    drugs: list[dict],
    patient: dict,
    interactions: dict,
    risk_scores: list[dict],
    overall_risk: dict | None,
    errors: list[str],
) -> dict:
    """Build a minimal report when the LLM-based report generation fails."""

    interaction_list = interactions.get("interactions", [])
    critical = [i for i in interaction_list if i.get("severity") == "critical"]
    high = [i for i in interaction_list if i.get("severity") == "high"]

    # Prefer the agent-computed overall risk (deterministic, clamped) over a
    # heuristic derived from string severity counts. The string severities on
    # interactions come from the LLM and have been observed to disagree with
    # the numeric scores.
    if overall_risk and "score" in overall_risk:
        overall_score = _clamp_score(overall_risk.get("score"))
        overall_level = _severity_label_for_score(overall_score).lower()
    else:
        # No agent-side score — derive from the highest numeric risk_score we
        # have, otherwise fall back to counting string severities.
        max_from_scores = max(
            (_clamp_score(rs.get("adjusted_score")) for rs in risk_scores if isinstance(rs, dict)),
            default=0.0,
        )
        if max_from_scores > 0:
            overall_score = max_from_scores
            overall_level = _severity_label_for_score(overall_score).lower()
        else:
            overall_score = 9.0 if critical else 7.0 if high else 5.0 if interaction_list else 2.5
            overall_level = "critical" if critical else "high" if high else "moderate" if interaction_list else "low"

    critical_findings = []
    for i in critical:
        drug_str = " + ".join(i.get("drugs", []))
        critical_findings.append(f"CRITICAL: {drug_str} — {i.get('description', 'Unknown')}")

    med_names = [d["name"] for d in drugs]

    return {
        "patient_summary": f"Patient age {patient.get('age', 'unknown')}, sex {patient.get('sex', 'unknown')}, CKD stage {patient.get('ckd_stage', 0)}",
        "medication_count": len(drugs),
        "interaction_summary": f"{len(interaction_list)} interactions detected ({len(critical)} critical, {len(high)} high)",
        "critical_findings": critical_findings,
        "risk_scores": risk_scores,
        "burden_scores": None,
        "temporal_summary": None,
        "deprescribing_plan": None,
        "evidence_citations": [],
        "overall_risk_score": overall_score,
        "overall_risk_level": overall_level,
        "report_text": (
            f"ARIA Analysis Report (Fallback)\n\n"
            f"Medications analyzed: {', '.join(med_names)}\n"
            f"Total interactions: {len(interaction_list)}\n"
            f"Critical: {len(critical)}, High: {len(high)}\n"
            f"Overall risk: {overall_score:.1f} / 10 ({overall_level.upper()})\n\n"
            f"Note: Full LLM-powered report generation encountered errors. "
            f"Errors: {'; '.join(errors)}"
        ),
    }
