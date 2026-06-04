"""Slice A: final score/label consistency guardrail.

This is the last node in the pipeline. It enforces a single source of truth
for severity: every rendered "Level" / severity label must be derived from
the numeric score via the same threshold function used everywhere else
(`report_builder._severity_label_for_score`, which mirrors
`mcp-server/src/tools/score_risk.rs::severity_label_for_score` and
`frontend/src/lib/severity.ts`).

Why this exists: the score-to-label mapping was previously computed in
several places (the Rust server, the Python agent, the Vercel frontend, the
PDF export, and the LLM-authored report text). When those drift, a clinician
sees an 8.6 labelled "CRITICAL" in one surface and "0 critical" in another,
which is exactly the kind of inconsistency that destroys trust in the tool.

This node does not invent or change any score. It only ensures the *label*
attached to a score matches the canonical mapping, repairs it in place if it
has drifted (e.g. an LLM wrote "Level: HIGH" next to a 9.2), and records what
it corrected so the drift is visible in logs and tests rather than silent.

It is intentionally non-fatal: a guardrail that crashes the pipeline is worse
than the drift it guards against. On any unexpected error it logs and returns
the report untouched.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Any

logger = logging.getLogger(__name__)


# ── Canonical mapping ───────────────────────────────────────
# Thresholds MUST match report_builder._severity_label_for_score,
# score_risk.rs::severity_label_for_score, and frontend/src/lib/severity.ts.
# CRITICAL >= 8.5, HIGH >= 5.0, MODERATE >= 2.0, else LOW.


def severity_label_for_score(score: Any) -> str:
    """The single source of truth for mapping a 0-10 score to a label."""
    if score is None or not isinstance(score, (int, float)) or math.isnan(float(score)):
        return "LOW"
    s = max(0.0, min(10.0, float(score)))
    if s >= 8.5:
        return "CRITICAL"
    if s >= 5.0:
        return "HIGH"
    if s >= 2.0:
        return "MODERATE"
    return "LOW"


# Matches "Level: HIGH", "Level = critical", "Risk Level CRITICAL", etc.
_LEVEL_RE = re.compile(
    r"(Level\s*[:=]?\s*)(LOW|MODERATE|HIGH|CRITICAL)\b",
    re.IGNORECASE,
)


def _coerce_score(value: Any) -> float | None:
    try:
        if value is None:
            return None
        f = float(value)
        if math.isnan(f):
            return None
        return max(0.0, min(10.0, f))
    except (TypeError, ValueError):
        return None


def _check_interactions(report: dict[str, Any], corrections: list[str]) -> None:
    """Ensure each interaction's severity label matches its numeric score,
    when the interaction carries a numeric score field."""
    interactions = report.get("interactions")
    if not isinstance(interactions, list):
        # Some reports nest interactions under raw_interactions.
        raw = report.get("raw_interactions")
        if isinstance(raw, dict):
            interactions = raw.get("interactions")
    if not isinstance(interactions, list):
        return

    for ix in interactions:
        if not isinstance(ix, dict):
            continue
        # Only validate when a numeric score is actually present; many
        # interactions are categorical-only and have no score to check.
        score = _coerce_score(
            ix.get("score")
            if ix.get("score") is not None
            else ix.get("adjusted_score")
            if ix.get("adjusted_score") is not None
            else ix.get("risk_score")
        )
        if score is None:
            continue
        expected = severity_label_for_score(score).lower()
        current = str(ix.get("severity", "")).lower()
        if current and current != expected:
            corrections.append(
                f"interaction {ix.get('drugs') or ix.get('id') or '?'}: "
                f"severity '{current}' -> '{expected}' (score {score})"
            )
            ix["severity"] = expected


def _check_overall(report: dict[str, Any], corrections: list[str]) -> None:
    """Ensure the overall risk level matches the overall score."""
    score = _coerce_score(
        report.get("overall_risk_score")
        if report.get("overall_risk_score") is not None
        else report.get("risk_score")
    )
    if score is None:
        return
    expected = severity_label_for_score(score)

    for key in ("overall_risk_level", "risk_level", "overall_level"):
        if key in report and report[key] is not None:
            current = str(report[key])
            # Preserve the caller's casing convention (upper vs lower).
            target = expected if current.isupper() else expected.lower()
            if current.lower() != expected.lower():
                corrections.append(
                    f"{key}: '{current}' -> '{target}' (score {score})"
                )
                report[key] = target


def _check_rendered_text(report: dict[str, Any], corrections: list[str]) -> None:
    """Repair any 'Level: X' in the rendered report text so it agrees with
    the overall score. The artifact shown in Prompt Opinion is rendered from
    this text, so a drifted label here is what a user actually sees."""
    score = _coerce_score(
        report.get("overall_risk_score")
        if report.get("overall_risk_score") is not None
        else report.get("risk_score")
    )
    if score is None:
        return
    expected = severity_label_for_score(score)

    for key in ("report_text", "report_markdown", "markdown", "text"):
        text = report.get(key)
        if not isinstance(text, str) or not text:
            continue

        def _repl(m: re.Match) -> str:
            found = m.group(2).upper()
            if found != expected:
                corrections.append(
                    f"{key}: rendered 'Level: {found}' -> '{expected}' (score {score})"
                )
            # Keep the label in the same case family as the canonical label.
            return f"{m.group(1)}{expected}"

        report[key] = _LEVEL_RE.sub(_repl, text)


async def consistency_check(state: dict[str, Any]) -> dict[str, Any]:
    """Final guardrail node. Enforces score/label consistency on the report.

    Non-fatal by design: never raises into the pipeline. Returns the (possibly
    repaired) report plus a list of any corrections made, which the test suite
    asserts is empty for well-formed reports.
    """
    report = state.get("report")
    errors = state.get("errors", [])

    if not isinstance(report, dict):
        return {"consistency_corrections": [], "errors": errors}

    corrections: list[str] = []
    try:
        _check_overall(report, corrections)
        _check_interactions(report, corrections)
        _check_rendered_text(report, corrections)
    except Exception as e:  # never crash the pipeline on a guardrail
        logger.error("consistency_check failed (non-fatal): %s", e)
        return {"report": report, "consistency_corrections": [], "errors": errors}

    if corrections:
        logger.warning(
            "consistency_check repaired %d score/label mismatch(es): %s",
            len(corrections),
            "; ".join(corrections),
        )
    else:
        logger.info("consistency_check: all score/label pairs consistent")

    return {
        "report": report,
        "consistency_corrections": corrections,
        "errors": errors,
    }
