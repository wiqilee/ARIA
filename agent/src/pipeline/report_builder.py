"""Report build step: assemble the final structured clinical report via MCP tool."""

from __future__ import annotations

import logging
import math
import re
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


# Mirrors `severity_label_for_score` in `mcp-server/src/tools/score_risk.rs`
# and `frontend/src/lib/severity.ts`. See `phenotype_scorer.py` for the matching
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


def _as_dict(obj: Any) -> dict | None:
    """Coerce an MCP tool result (dict OR Pydantic model / object) into a dict.

    The MCP client deserialises tool I/O into the Pydantic models defined in
    ``mcp_client/schema.py``, so ``mcp.generate_report`` and the entries in
    ``risk_scores`` may be model instances, not plain dicts. The original
    ``_enforce_overall_risk`` bailed out with ``return report`` on any
    non-dict, which silently skipped the entire single-source-of-truth
    override — exactly the path that let a wrong label survive to the
    Prompt Opinion artifact. Coercing here closes that gap.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj
    model_dump = getattr(obj, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump()
        except Exception:  # pragma: no cover - defensive
            pass
    dict_method = getattr(obj, "dict", None)
    if callable(dict_method):
        try:
            return dict_method()
        except Exception:  # pragma: no cover - defensive
            pass
    if hasattr(obj, "__dict__"):
        try:
            return dict(vars(obj))
        except Exception:  # pragma: no cover - defensive
            pass
    return None


# Matches the rendered overall-risk score token, e.g. "Risk score: 10.0 / 10".
# Only the *overall* line uses the "Risk score: … / 10" phrasing; the per-pair
# interaction table uses a "Severity" column and the deprescribing rationale
# uses "adjusted score N", neither of which match this anchor — so rewriting
# is safe and scoped to the overall summary.
_RENDERED_SCORE_RE = re.compile(
    r"(Risk\s+score\s*[:=]?\s*)([0-9]+(?:\.[0-9]+)?)(\s*/\s*10)",
    re.IGNORECASE,
)

# Matches the rendered overall-risk label token, e.g. "Level: LOW". Restricted
# to the four canonical severity words so it never touches unrelated text such
# as "CKD Stage 3".
_RENDERED_LABEL_RE = re.compile(
    r"(Level\s*[:=]?\s*)(LOW|MODERATE|HIGH|CRITICAL)\b",
    re.IGNORECASE,
)


def _sanitize_rendered_text(text: str, score: float, label: str) -> tuple[str, bool]:
    """Rewrite any rendered 'Risk score: X / 10 • Level: Y' so the displayed
    number and label match the canonical values. Returns (new_text, changed)."""
    if not isinstance(text, str) or not text:
        return text, False

    new_text, n_score = _RENDERED_SCORE_RE.subn(
        lambda m: f"{m.group(1)}{score:.1f}{m.group(3)}", text
    )
    new_text, n_label = _RENDERED_LABEL_RE.subn(
        lambda m: f"{m.group(1)}{label}", new_text
    )
    return new_text, (n_score > 0 or n_label > 0)


def _sanitize_obj(obj: Any, score: float, label: str) -> Any:
    """Recursively rewrite the overall-risk score/label tokens inside any
    string values nested in the report (report_text, summary, markdown, etc.),
    wherever the renderer ends up reading them from."""
    if isinstance(obj, str):
        new_text, _ = _sanitize_rendered_text(obj, score, label)
        return new_text
    if isinstance(obj, dict):
        return {k: _sanitize_obj(v, score, label) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_obj(v, score, label) for v in obj]
    return obj


def _canonical_overall_score(
    report: dict,
    overall_risk: dict | None,
    risk_scores: list | None,
) -> float:
    """Derive the authoritative overall risk score (0–10).

    By definition (see `phenotype_scorer.py`) overall risk = the max
    adjusted_score across all interactions. We compute it from the most
    trustworthy source available and DO NOT trust the MCP/LLM report value
    (that is the field we are overriding). Taking the max of the agent's
    overall_risk and the recomputed max adjusted_score makes this resilient
    even if `phenotype_scorer` ever regresses and emits a stale 0.0.
    """
    candidates: list[float] = []

    if isinstance(overall_risk, dict) and isinstance(overall_risk.get("score"), (int, float)):
        candidates.append(_clamp_score(overall_risk.get("score")))

    if risk_scores:
        adjusted: list[float] = []
        for rs in risk_scores:
            rs_d = _as_dict(rs)
            if rs_d is not None and isinstance(rs_d.get("adjusted_score"), (int, float)):
                adjusted.append(_clamp_score(rs_d.get("adjusted_score")))
        if adjusted:
            candidates.append(max(adjusted))

    if candidates:
        return max(candidates)

    # Last resort only: nothing agent-side to go on, fall back to the MCP
    # report's own (clamped) number.
    return _clamp_score(report.get("overall_risk_score"))


def _enforce_overall_risk(
    report: Any,
    overall_risk: dict | None,
    risk_scores: list | None = None,
) -> dict:
    """Force the report's overall_risk_score / overall_risk_level — and every
    rendered copy of them — to match the deterministic Python-side value.

    Why this exists: the MCP server's `generate_report` tool builds its own
    overall-risk summary by asking Gemini, which has been observed to:
      (a) emit numeric scores outside [0, 10] (e.g. "15.3 / 10" when the LLM
          summed pair severities), and
      (b) attach a label that disagrees with whatever number it picked
          (e.g. score 10.0 tagged "LOW", showing up in Prompt Opinion as
          "Risk score: 10.0 / 10 • Level: LOW").

    The previous version of this function fixed (a) and the *structured*
    fields for (b), but the Prompt Opinion artifact is rendered from the
    LLM-produced report TEXT (e.g. `report_text`), which still embedded the
    wrong "Level". So we now ALSO:
      • derive the score independently of `phenotype_scorer` (robust to a
        stale 0.0 upstream),
      • write the canonical value to the flat fields AND a nested
        `overall_risk` object (covers renderers reading either shape),
      • rewrite the embedded "Risk score: X / 10 • Level: Y" line in every
        string field of the report.
    Original MCP-emitted values are preserved under `_mcp_*` for debugging.
    """
    report = _as_dict(report)
    if report is None:
        # Truly uncoercible — nothing we can safely override.
        return {}

    score = _canonical_overall_score(report, overall_risk, risk_scores)
    label = _severity_label_for_score(score)  # ALWAYS from the number, never the LLM

    # Log (do not propagate) when the upstream agent label disagreed.
    if overall_risk and overall_risk.get("severity_label"):
        upstream_lbl = str(overall_risk.get("severity_label")).upper()
        if upstream_lbl != label:
            logger.warning(
                "Discarding upstream overall_risk.severity_label %r — "
                "does not match canonical score %.2f (expected %r). "
                "Check phenotype_scorer.",
                overall_risk.get("severity_label"),
                score,
                label,
            )

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
                "Overriding MCP overall_risk_level %r → %r (matches canonical score %.2f)",
                report.get("overall_risk_level"),
                label,
                score,
            )

    # Canonical structured fields.
    report["overall_risk_score"] = score
    report["overall_risk_level"] = label.lower()  # downstream UI expects lowercase

    # Also write a nested object, in case a renderer reads the structured
    # `overall_risk` shape rather than the flat fields.
    report["overall_risk"] = {
        "score": score,
        "severity_label": label,
        "level": label.lower(),
    }

    # CRITICAL for Prompt Opinion: the artifact is rendered from the LLM text,
    # not the structured fields. Rewrite the embedded overall-risk line so the
    # number and label shown can never disagree with the canonical value.
    sanitized = _sanitize_obj(report, score, label)
    if isinstance(sanitized, dict):
        report = sanitized

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
        report = _as_dict(await mcp.generate_report(analysis)) or {}

        # Attach the deprescribing plan to the report
        if deprescribing_plan:
            report["deprescribing_plan"] = deprescribing_plan

        # ── CRITICAL: enforce single source of truth ────────────────────
        # Override MCP's overall_risk_score / overall_risk_level AND any
        # rendered text with the Python-side deterministic values. Without
        # this the Prompt Opinion artifact has been seen rendering
        # "🔴 Risk score: 10.0 / 10 • Level: LOW" — number right, label wrong,
        # because the artifact reads the LLM-rendered text, not the fields.
        report = _enforce_overall_risk(report, overall_risk, risk_scores)

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
            (_clamp_score((_as_dict(rs) or {}).get("adjusted_score")) for rs in risk_scores if _as_dict(rs) is not None),
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
