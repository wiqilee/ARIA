use anyhow::Result;

use crate::api::{DrugBankClient, GeminiClient};
use crate::llm::TEMPORAL_SYSTEM_PROMPT;
use crate::models::{CascadeModel, Drug};

/// Model the temporal evolution of drug interaction risk over a timeline.
pub async fn model_temporal_cascade(
    drugs: &[Drug],
    timeline_days: u32,
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<CascadeModel> {
    // Gather half-life and pharmacokinetic data for temporal modeling
    let mut pk_data = Vec::new();
    for drug in drugs {
        let pharm = drugbank.get_pharmacology(&drug.name).await?;
        pk_data.push(serde_json::json!({
            "name": drug.name,
            "dose": drug.dose,
            "frequency": drug.frequency,
            "pharmacology": pharm,
        }));
    }

    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "timeline_days": timeline_days,
        "pharmacokinetic_data": pk_data,
        "instructions": format!(
            "Model the risk evolution over {} days. Consider drug half-lives, \
             time to steady state, onset of enzyme inhibition/induction effects, \
             and accumulation with repeated dosing.",
            timeline_days
        ),
    })
    .to_string();

    let response = gemini.generate(TEMPORAL_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "timeline_days": timeline_days,
            "daily_risk": [],
            "peak_risk_day": 1,
            "peak_risk_score": 5.0,
            "intervention_windows": [],
            "summary": "Unable to model temporal cascade"
        })
    });

    Ok(CascadeModel {
        drugs: drug_names.iter().map(|s| s.to_string()).collect(),
        timeline_days: parsed
            .get("timeline_days")
            .and_then(|t| t.as_u64())
            .unwrap_or(timeline_days as u64) as u32,
        daily_risk: parsed
            .get("daily_risk")
            .and_then(|d| serde_json::from_value(d.clone()).ok())
            .unwrap_or_default(),
        peak_risk_day: parsed
            .get("peak_risk_day")
            .and_then(|p| p.as_u64())
            .unwrap_or(1) as u32,
        peak_risk_score: parsed
            .get("peak_risk_score")
            .and_then(|p| p.as_f64())
            .unwrap_or(5.0),
        intervention_windows: parsed
            .get("intervention_windows")
            .and_then(|w| serde_json::from_value(w.clone()).ok())
            .unwrap_or_default(),
        summary: parsed
            .get("summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Unable to model temporal cascade")
            .to_string(),
    })
}
