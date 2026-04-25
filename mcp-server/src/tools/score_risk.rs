use anyhow::Result;

use crate::api::GeminiClient;
use crate::llm::RISK_SCORE_SYSTEM_PROMPT;
use crate::models::{Interaction, PatientPhenotype, RiskScore};

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

    Ok(RiskScore {
        interaction_id: interaction.id.clone(),
        drugs: interaction.drugs.clone(),
        base_score: parsed.get("base_score").and_then(|s| s.as_f64()).unwrap_or(5.0),
        adjusted_score: parsed.get("adjusted_score").and_then(|s| s.as_f64()).unwrap_or(5.0),
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
