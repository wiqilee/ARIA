use anyhow::Result;

use crate::api::GeminiClient;
use crate::llm::ALTERNATIVES_SYSTEM_PROMPT;
use crate::models::{Alternatives, Drug, PatientContext};

/// Suggest evidence-based drug substitutions to reduce interaction risk.
pub async fn suggest_alternatives(
    drug: &Drug,
    reason: &str,
    patient_context: &PatientContext,
    gemini: &GeminiClient,
) -> Result<Alternatives> {
    let user_prompt = serde_json::json!({
        "drug": {
            "name": drug.name,
            "dose": drug.dose,
            "indication": drug.indication,
        },
        "removal_reason": reason,
        "patient_context": {
            "age": patient_context.age,
            "sex": patient_context.sex,
            "ckd_stage": patient_context.ckd_stage,
            "hepatic_impairment": patient_context.hepatic_impairment,
            "comorbidities": patient_context.comorbidities,
            "allergies": patient_context.allergies,
        },
    })
    .to_string();

    let response = gemini.generate(ALTERNATIVES_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "original_drug": drug.name,
            "removal_reason": reason,
            "alternatives": []
        })
    });

    Ok(Alternatives {
        original_drug: parsed
            .get("original_drug")
            .and_then(|o| o.as_str())
            .unwrap_or(&drug.name)
            .to_string(),
        removal_reason: parsed
            .get("removal_reason")
            .and_then(|r| r.as_str())
            .unwrap_or(reason)
            .to_string(),
        alternatives: parsed
            .get("alternatives")
            .and_then(|a| serde_json::from_value(a.clone()).ok())
            .unwrap_or_default(),
    })
}
