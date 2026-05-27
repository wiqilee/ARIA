use anyhow::Result;
use std::fmt::Write;

use crate::api::GeminiClient;
use crate::llm::REPORT_SYSTEM_PROMPT;
use crate::models::{ClinicalReport, FullAnalysis};

// Import the canonical severity-label mapping. This lives next door in
// `tools/score_risk.rs` (see the file structure in README §Project
// Structure). If your build fails on this import, adjust the path to
// match wherever `severity_label_for_score` is defined — the function
// itself is the canonical threshold mapping for the whole backend, do
// NOT re-implement it inline here.
use super::score_risk::severity_label_for_score;

/// Severity emoji for the artifact markdown. Stays in lockstep with the
/// canonical four severity bands (LOW / MODERATE / HIGH / CRITICAL) so
/// the colored dot the user sees in Prompt Opinion matches the textual
/// label on the same line.
fn risk_emoji(label: &str) -> &'static str {
    match label {
        "CRITICAL" => "🔴",
        "HIGH" => "🟠",
        "MODERATE" => "🟡",
        "LOW" => "🟢",
        _ => "⚪",
    }
}

/// Reduce per-interaction adjusted risk scores into a single overall risk
/// score for the regimen.
///
/// Rules:
///   - Use the MAX (not sum, not average) because clinical triage follows
///     the single worst pair. Averaging dilutes a dangerous combo with
///     several benign ones and obscures the intervention target.
///   - Clamp to [0.0, 10.0]. The LLM has been observed to emit per-pair
///     scores like 15.3 — sometimes by treating the metric as a percentage,
///     sometimes by summing components it should have averaged. Either
///     way, anything outside the canonical band must not leak downstream.
///     This is the same defensive rule applied in
///     `score_risk::clamp_score`.
///   - NaN / non-finite values are ignored. They are never a clinically
///     meaningful score; treating them as 0 (rather than panicking or
///     poisoning the max) keeps the rest of the report renderable.
fn compute_overall_risk_score(risk_scores: &[serde_json::Value]) -> f64 {
    let max = risk_scores
        .iter()
        .filter_map(|rs| rs.get("adjusted_score").and_then(|v| v.as_f64()))
        .filter(|v| v.is_finite())
        .fold(0.0_f64, f64::max);
    max.clamp(0.0, 10.0)
}

/// Build the canonical artifact markdown server-side, using structured
/// fields only — never the LLM's free-form `report_text`.
///
/// Why this exists: the previous code path returned `parsed.get("report_text")`
/// verbatim, i.e. whatever Gemini chose to emit. That path was the source
/// of the "🔴 Risk score: 15.3 / 10 • Level: MODERATE" line that surfaced
/// in the Prompt Opinion artifact bubble. Both fields were wrong in
/// different ways:
///   - 15.3 / 10 is structurally impossible. The LLM had aggregated
///     per-pair severities by addition instead of taking the max, and the
///     score escaped the 0–10 contract.
///   - "MODERATE" attached to that score was a second, independent
///     mistake: even if 15.3 were valid, anything ≥ 8.5 is CRITICAL by
///     the README threshold, not MODERATE.
/// Building the markdown from `compute_overall_risk_score` + the
/// canonical `severity_label_for_score` mapping makes both kinds of
/// mistake structurally impossible.
fn build_report_markdown(
    analysis: &FullAnalysis,
    overall_score: f64,
    overall_label: &str,
    patient_summary: &str,
    interaction_summary: &str,
    critical_findings: &[String],
) -> String {
    let mut out = String::new();

    let _ = writeln!(out, "🦠 ARIA Polypharmacy Analysis");
    let _ = writeln!(out);

    // Patient line — pulled from the structured `patient_context` so the
    // header doesn't depend on the LLM having formatted `patient_summary`
    // in any particular way. Falls back to the LLM-written summary only
    // if the structured fields are all absent.
    let mut patient_parts: Vec<String> = Vec::new();
    if let Some(a) = analysis
        .patient_context
        .get("age")
        .and_then(|v| v.as_i64())
    {
        patient_parts.push(format!("{}yo", a));
    }
    if let Some(s) = analysis
        .patient_context
        .get("sex")
        .and_then(|v| v.as_str())
    {
        let trimmed = s.trim();
        if !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("unknown") {
            patient_parts.push(trimmed.to_string());
        }
    }
    if let Some(c) = analysis
        .patient_context
        .get("ckd_stage")
        .and_then(|v| v.as_i64())
    {
        if c >= 3 {
            patient_parts.push(format!("CKD stage {}", c));
        }
    }
    if analysis
        .patient_context
        .get("hepatic_impairment")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        patient_parts.push("hepatic impairment".to_string());
    }

    if !patient_parts.is_empty() {
        let _ = writeln!(out, "**Patient:** {}", patient_parts.join(", "));
    } else if !patient_summary.is_empty() {
        let _ = writeln!(out, "**Patient:** {}", patient_summary);
    }

    if !analysis.medications.is_empty() {
        let _ = writeln!(
            out,
            "**Medications ({}):** {}",
            analysis.medications.len(),
            analysis.medications.join(", ")
        );
    }
    let _ = writeln!(out);

    // Overall risk — always /10, always labelled per the deterministic
    // mapping. This is the exact line that used to render
    // "🔴 Risk score: 15.3 / 10 • Level: MODERATE". The score is clamped
    // and the label comes from `severity_label_for_score`, so the two
    // fields are guaranteed to agree, and neither can leave [0, 10].
    let _ = writeln!(out, "## 📊 Overall Risk");
    let _ = writeln!(out);
    let _ = writeln!(
        out,
        "{} **Risk score:** {:.1} / 10 • **Level:** {}",
        risk_emoji(overall_label),
        overall_score,
        overall_label
    );
    let _ = writeln!(out);

    // Interaction summary — narrative is allowed to come from the LLM
    // because it doesn't carry the numeric overall score, just prose
    // describing what was found.
    if !interaction_summary.is_empty()
        && !interaction_summary.eq_ignore_ascii_case("Interaction summary unavailable")
        && !interaction_summary.eq_ignore_ascii_case("See full report below")
    {
        let _ = writeln!(out, "## ⚠️ Drug Interactions");
        let _ = writeln!(out);
        let _ = writeln!(out, "{}", interaction_summary);
        let _ = writeln!(out);
    }

    // Critical findings — also narrative; safe to surface.
    if !critical_findings.is_empty() {
        let _ = writeln!(out, "## 🚨 Critical Findings ({})", critical_findings.len());
        let _ = writeln!(out);
        for f in critical_findings {
            let _ = writeln!(out, "- {}", f);
        }
    }

    out
}

/// Assemble all analysis results into a structured clinical report.
pub async fn generate_report(
    analysis: &FullAnalysis,
    gemini: &GeminiClient,
) -> Result<ClinicalReport> {
    let user_prompt = serde_json::json!({
        "medications": analysis.medications,
        "patient_context": analysis.patient_context,
        "interactions": analysis.interactions,
        "interaction_graph": analysis.graph,
        "risk_scores": analysis.risk_scores,
        "burden_scores": analysis.burden_scores,
        "temporal_model": analysis.temporal_model,
        "evidence": analysis.evidence,
    })
    .to_string();

    let response = gemini
        .generate_text(REPORT_SYSTEM_PROMPT, &user_prompt)
        .await?;

    // Try parsing as JSON first (Gemini may return JSON even with text mode).
    // Note we no longer fall back to using the raw `response` as
    // `report_text` — we will rebuild it server-side from structured fields
    // a few lines below.
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "patient_summary": "See full report below",
            "medication_count": analysis.medications.len(),
            "interaction_summary": "See full report below",
            "critical_findings": [],
            "overall_risk_level": "moderate",
        })
    });

    // ── Deterministic overall risk ─────────────────────────────────────
    // Compute the overall risk numerically from per-interaction
    // adjusted_scores, then derive the label via the canonical mapping.
    // We DO NOT use `parsed.get("overall_risk_level")` because the LLM
    // has been observed to return a label that disagrees with its own
    // numeric reasoning (e.g. "MODERATE" attached to a score ≥ 8.5).
    // This is the same defensive rule applied in `score_risk.rs` and the
    // Python `phenotype_scorer._severity_label_for_score`.
    let overall_risk_score = compute_overall_risk_score(&analysis.risk_scores);
    let overall_risk_label = severity_label_for_score(overall_risk_score);

    if let Some(llm_label) = parsed.get("overall_risk_level").and_then(|v| v.as_str()) {
        if !llm_label.eq_ignore_ascii_case(overall_risk_label) {
            tracing::warn!(
                overall_risk_score,
                llm_label,
                deterministic_label = overall_risk_label,
                "LLM overall_risk_level disagrees with deterministic mapping; using deterministic"
            );
        }
    }

    // Extract risk scores from analysis for the report
    let risk_scores = analysis
        .risk_scores
        .iter()
        .filter_map(|rs| serde_json::from_value(rs.clone()).ok())
        .collect();

    let burden_scores = analysis
        .burden_scores
        .as_ref()
        .and_then(|b| serde_json::from_value(b.clone()).ok());

    let temporal_summary = analysis
        .temporal_model
        .as_ref()
        .and_then(|t| t.get("summary"))
        .and_then(|s| s.as_str())
        .map(String::from);

    let deprescribing_plan = None; // Attached separately by the agent

    let evidence_citations: Vec<String> = analysis
        .evidence
        .iter()
        .filter_map(|e| {
            e.get("pmid")
                .and_then(|p| p.as_str())
                .map(|pmid| format!("PMID: {}", pmid))
        })
        .collect();

    let patient_summary = parsed
        .get("patient_summary")
        .and_then(|s| s.as_str())
        .unwrap_or("Patient summary unavailable")
        .to_string();

    let interaction_summary = parsed
        .get("interaction_summary")
        .and_then(|s| s.as_str())
        .unwrap_or("Interaction summary unavailable")
        .to_string();

    let critical_findings: Vec<String> = parsed
        .get("critical_findings")
        .and_then(|c| serde_json::from_value(c.clone()).ok())
        .unwrap_or_default();

    // ── Build the artifact markdown server-side ─────────────────────────
    // Previously this was `parsed.get("report_text")`, i.e. whatever
    // Gemini chose to emit. That path was the source of the
    // "🔴 Risk score: 15.3 / 10 • Level: MODERATE" output rendered in
    // the Prompt Opinion artifact bubble. We now build the markdown
    // from structured fields so the rendered text, the JSON
    // `overall_risk_level` field, and the frontend's numeric
    // `overall_risk_score` can never drift apart.
    let report_text = build_report_markdown(
        analysis,
        overall_risk_score,
        overall_risk_label,
        &patient_summary,
        &interaction_summary,
        &critical_findings,
    );

    Ok(ClinicalReport {
        patient_summary,
        medication_count: parsed
            .get("medication_count")
            .and_then(|m| m.as_u64())
            .unwrap_or(analysis.medications.len() as u64) as usize,
        interaction_summary,
        critical_findings,
        risk_scores,
        burden_scores,
        temporal_summary,
        deprescribing_plan,
        evidence_citations,
        // Deterministic label, never trust the LLM. The Python agent
        // backstops this in `report_builder._enforce_overall_risk`; doing
        // it here too means the MCP-level JSON (visible to anyone calling
        // the tool directly via A2A) is already correct without that
        // override.
        overall_risk_level: overall_risk_label.to_lowercase(),
        report_text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overall_risk_score_takes_max() {
        let scores = vec![
            serde_json::json!({ "adjusted_score": 4.8 }),
            serde_json::json!({ "adjusted_score": 9.4 }),
            serde_json::json!({ "adjusted_score": 5.4 }),
            serde_json::json!({ "adjusted_score": 10.0 }),
        ];
        assert_eq!(compute_overall_risk_score(&scores), 10.0);
    }

    #[test]
    fn overall_risk_score_clamps_out_of_range_inputs() {
        // The exact pathological input observed in production — the LLM
        // emitted a per-pair score of 15.3, which made the Prompt Opinion
        // artifact render "Risk score: 15.3 / 10". The max-reduction
        // helper is responsible for the last-line-of-defence clamp.
        let scores = vec![
            serde_json::json!({ "adjusted_score": 4.8 }),
            serde_json::json!({ "adjusted_score": 15.3 }),
        ];
        assert_eq!(compute_overall_risk_score(&scores), 10.0);
    }

    #[test]
    fn overall_risk_score_handles_empty_and_garbage() {
        assert_eq!(compute_overall_risk_score(&[]), 0.0);
        let scores = vec![
            serde_json::json!({ "no_score_field_here": true }),
            serde_json::json!({ "adjusted_score": "not a number" }),
            serde_json::json!({ "adjusted_score": null }),
        ];
        assert_eq!(compute_overall_risk_score(&scores), 0.0);
    }

    #[test]
    fn risk_emoji_matches_canonical_labels() {
        assert_eq!(risk_emoji("CRITICAL"), "🔴");
        assert_eq!(risk_emoji("HIGH"), "🟠");
        assert_eq!(risk_emoji("MODERATE"), "🟡");
        assert_eq!(risk_emoji("LOW"), "🟢");
        // Unknown labels never go through silently — caller can decide
        // whether to surface the white circle or fail loudly.
        assert_eq!(risk_emoji("WHATEVER"), "⚪");
    }
}
