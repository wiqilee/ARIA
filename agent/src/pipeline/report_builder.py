"""Report build step: assemble the final structured clinical report via MCP tool."""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


async def report_build(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP generate_report with the full analysis to produce the final report."""

    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {})
    interactions = state.get("interactions", {})
    interaction_graph = state.get("interaction_graph", {})
    risk_scores = state.get("risk_scores", [])
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

    report = {}
    try:
        report = await mcp.generate_report(analysis)

        # Attach the deprescribing plan to the report
        if deprescribing_plan:
            report["deprescribing_plan"] = deprescribing_plan

        logger.info(
            "Report generated: overall risk level = %s",
            report.get("overall_risk_level", "unknown"),
        )
    except Exception as e:
        logger.error("generate_report failed: %s", e)
        errors.append(f"Report generation failed: {e}")

        # Build a fallback report from available data
        report = _build_fallback_report(drugs, patient, interactions, risk_scores, errors)

    return {
        "report": report,
        "errors": errors,
    }


def _build_fallback_report(
    drugs: list[dict],
    patient: dict,
    interactions: dict,
    risk_scores: list[dict],
    errors: list[str],
) -> dict:
    """Build a minimal report when the LLM-based report generation fails."""

    interaction_list = interactions.get("interactions", [])
    critical = [i for i in interaction_list if i.get("severity") == "critical"]
    high = [i for i in interaction_list if i.get("severity") == "high"]

    overall = "critical" if critical else "high" if high else "moderate"

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
        "overall_risk_level": overall,
        "report_text": (
            f"ARIA Analysis Report (Fallback)\n\n"
            f"Medications analyzed: {', '.join(med_names)}\n"
            f"Total interactions: {len(interaction_list)}\n"
            f"Critical: {len(critical)}, High: {len(high)}\n"
            f"Overall risk: {overall}\n\n"
            f"Note: Full LLM-powered report generation encountered errors. "
            f"Errors: {'; '.join(errors)}"
        ),
    }
