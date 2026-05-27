use anyhow::Result;

use crate::api::GeminiClient;
use crate::llm::RISK_SCORE_SYSTEM_PROMPT;
use crate::models::{Interaction, PatientPhenotype, RiskScore};

/// Map a numeric risk score (0.0-10.0) to a human-readable severity label.
///
/// This is the SINGLE SOURCE OF TRUTH for severity classification on the
/// backend. The frontend `lib/severity.ts` mirrors these exact thresholds.
/// Do NOT let the LLM produce its own label — it has been observed to
/// return "MODERATE" for scores of 9.4 and 10.0, which is clinically
/// dangerous. The label MUST be derived deterministically from the score.
///
/// Thresholds:
///   0.0 – 2.0   → "LOW"
///   2.0 – 5.0   → "MODERATE"
///   5.0 – 8.5   → "HIGH"
///   8.5 – 10.0  → "CRITICAL"
pub fn severity_label_for_score(score: f64) -> &'static str {
    if !score.is_finite() {
        return "LOW";
    }
    let s = score.clamp(0.0, 10.0);
    if s >= 8.5 {
        "CRITICAL"
    } else if s >= 5.0 {
        "HIGH"
    } else if s >= 2.0 {
        "MODERATE"
    } else {
        "LOW"
    }
}

/// Clamp any incoming score to the canonical 0.0-10.0 range.
///
/// Defensive helper for LLM-emitted numeric fields. Gemini has been observed
/// to occasionally:
///   - emit a score on the wrong scale (e.g. 95.0 if it treats the metric as
///     a percentage, or 1.0 if it treats it as a fraction),
///   - sum per-pair severities instead of returning the max (the cause of
///     the "15.3 / 10" output that surfaced in the Prompt Opinion artifact),
///   - emit NaN / null / "n/a" on prompt failure.
/// Every downstream consumer assumes the value is bounded, so we clamp at
/// the boundary between LLM output and the structured response.
fn clamp_score(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    value.clamp(0.0, 10.0)
}

/// Calculate a personalized risk score adjusted for patient phenotype.
pub async fn score_risk(
    interaction: &Interaction,
    phenotype: &PatientPhenotype,
    gemini: &GeminiClient,
) -> Result<RiskScore> {
    let user_prompt = serde_json::json!({
        "interaction": {
            "id": interaction.id,
            "drugs": interaction.drugs,
            "severity": interaction.severity,
            "interaction_type": interaction.interaction_type,
            "description": interaction.description,
            "mechanism": interaction.mechanism,
        },
        "patient_phenotype": {
            "age": phenotype.age,
            "sex": phenotype.sex,
            "weight_kg": phenotype.weight_kg,
            "ckd_stage": phenotype.ckd_stage,
            "hepatic_impairment": phenotype.hepatic_impairment,
            "smoking": phenotype.smoking,
        },
    })
    .to_string();

    let response = gemini.generate(RISK_SCORE_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "base_score": 5.0,
            "adjusted_score": 5.0,
            "risk_factors": [],
            "reasoning": "Unable to compute personalized risk score"
        })
    });

    // Extract raw values, then clamp into [0, 10]. The raw (un-clamped)
    // values are logged when they fall outside the band so we can audit
    // prompt regressions without losing the diagnostic data.
    let raw_adjusted = parsed.get("adjusted_score").and_then(|s| s.as_f64()).unwrap_or(5.0);
    let raw_base = parsed.get("base_score").and_then(|s| s.as_f64()).unwrap_or(5.0);

    let adjusted_score = clamp_score(raw_adjusted);
    let base_score = clamp_score(raw_base);

    if raw_adjusted.is_finite() && raw_adjusted != adjusted_score {
        tracing::warn!(
            interaction_id = %interaction.id,
            raw_adjusted_score = raw_adjusted,
            clamped = adjusted_score,
            "LLM returned out-of-range adjusted_score; clamping to [0, 10]"
        );
    }
    if raw_base.is_finite() && raw_base != base_score {
        tracing::warn!(
            interaction_id = %interaction.id,
            raw_base_score = raw_base,
            clamped = base_score,
            "LLM returned out-of-range base_score; clamping to [0, 10]"
        );
    }

    // Deterministic severity label — never trust the LLM for this.
    let severity_label = severity_label_for_score(adjusted_score);

    // If the LLM volunteered a conflicting label, log it so we can audit
    // prompt regressions. The deterministic label always wins.
    if let Some(llm_label) = parsed.get("severity_label").and_then(|v| v.as_str()) {
        if !llm_label.eq_ignore_ascii_case(severity_label) {
            tracing::warn!(
                interaction_id = %interaction.id,
                adjusted_score,
                llm_label,
                deterministic_label = severity_label,
                "LLM returned severity label conflicting with deterministic mapping; using deterministic"
            );
        }
    }

    Ok(RiskScore {
        interaction_id: interaction.id.clone(),
        drugs: interaction.drugs.clone(),
        base_score,
        adjusted_score,
        // Deterministic severity label, mirrored by `frontend/lib/severity.ts`
        // and the agent backstop in `phenotype_scorer.py`. Field is defined in
        // `models/risk.rs` with `#[serde(default)]` for backward compatibility.
        severity_label: severity_label.to_string(),
        risk_factors: parsed
            .get("risk_factors")
            .and_then(|r| serde_json::from_value(r.clone()).ok())
            .unwrap_or_default(),
        reasoning: parsed
            .get("reasoning")
            .and_then(|r| r.as_str())
            .unwrap_or("No reasoning available")
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{clamp_score, severity_label_for_score};

    #[test]
    fn severity_thresholds_match_readme_examples() {
        // From README §"Try It Live in 60 Seconds"
        assert_eq!(severity_label_for_score(9.6), "CRITICAL");
        assert_eq!(severity_label_for_score(8.3), "HIGH");
        assert_eq!(severity_label_for_score(8.4), "HIGH");
        // Bugs observed in production that this fix prevents
        assert_eq!(severity_label_for_score(10.0), "CRITICAL");
        assert_eq!(severity_label_for_score(9.4), "CRITICAL");
        // Boundary cases
        assert_eq!(severity_label_for_score(0.0), "LOW");
        assert_eq!(severity_label_for_score(2.0), "MODERATE");
        assert_eq!(severity_label_for_score(5.0), "HIGH");
        assert_eq!(severity_label_for_score(8.5), "CRITICAL");
        assert_eq!(severity_label_for_score(1.99), "LOW");
        assert_eq!(severity_label_for_score(4.99), "MODERATE");
        assert_eq!(severity_label_for_score(8.49), "HIGH");
        // Defensive: out-of-range and NaN
        assert_eq!(severity_label_for_score(-1.0), "LOW");
        assert_eq!(severity_label_for_score(15.0), "CRITICAL");
        assert_eq!(severity_label_for_score(f64::NAN), "LOW");
    }

    #[test]
    fn clamp_handles_out_of_range_inputs() {
        // Valid range — passes through unchanged.
        assert_eq!(clamp_score(0.0), 0.0);
        assert_eq!(clamp_score(5.5), 5.5);
        assert_eq!(clamp_score(10.0), 10.0);
        // Above range — pulled down to the ceiling.
        assert_eq!(clamp_score(15.3), 10.0); // the exact value seen in production
        assert_eq!(clamp_score(95.0), 10.0); // LLM-emitted percentage
        // Below range — pulled up to the floor.
        assert_eq!(clamp_score(-1.0), 0.0);
        // Non-finite — collapsed to floor.
        assert_eq!(clamp_score(f64::NAN), 0.0);
        assert_eq!(clamp_score(f64::INFINITY), 0.0);
        assert_eq!(clamp_score(f64::NEG_INFINITY), 0.0);
    }
}
