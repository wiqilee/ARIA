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

    let adjusted_score = parsed.get("adjusted_score").and_then(|s| s.as_f64()).unwrap_or(5.0);
    let base_score = parsed.get("base_score").and_then(|s| s.as_f64()).unwrap_or(5.0);

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
    use super::severity_label_for_score;

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
}
