use anyhow::Result;

use crate::api::GeminiClient;
use crate::llm::DEPRESCRIBING_SYSTEM_PROMPT;
use crate::models::{DeprescribingPlan, FullAnalysis};

/// Generate a prioritized, actionable deprescribing plan from the full analysis.
pub async fn generate_deprescribing_plan(
    analysis: &FullAnalysis,
    gemini: &GeminiClient,
) -> Result<DeprescribingPlan> {
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
        .generate(DEPRESCRIBING_SYSTEM_PROMPT, &user_prompt)
        .await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "steps": [],
            "total_expected_risk_reduction": 0.0,
            "summary": "Unable to generate deprescribing plan",
            "warnings": ["LLM response could not be parsed"]
        })
    });

    Ok(DeprescribingPlan {
        steps: parsed
            .get("steps")
            .and_then(|s| serde_json::from_value(s.clone()).ok())
            .unwrap_or_default(),
        total_expected_risk_reduction: parsed
            .get("total_expected_risk_reduction")
            .and_then(|t| t.as_f64())
            .unwrap_or(0.0),
        summary: parsed
            .get("summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Unable to generate deprescribing plan")
            .to_string(),
        warnings: parsed
            .get("warnings")
            .and_then(|w| serde_json::from_value(w.clone()).ok())
            .unwrap_or_default(),
    })
}
