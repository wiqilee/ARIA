use anyhow::Result;

use crate::api::{DrugBankClient, GeminiClient};
use crate::llm::BURDEN_SYSTEM_PROMPT;
use crate::models::{BurdenScores, Drug};

/// Calculate anticholinergic burden, sedation load, and QT prolongation risk.
pub async fn compute_burden_scores(
    drugs: &[Drug],
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<BurdenScores> {
    // Gather pharmacology data for burden assessment
    let mut pharmacology = Vec::new();
    for drug in drugs {
        let pharm = drugbank.get_pharmacology(&drug.name).await?;
        pharmacology.push(serde_json::json!({
            "name": drug.name,
            "dose": drug.dose,
            "frequency": drug.frequency,
            "pharmacology": pharm,
        }));
    }

    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "total_drugs": drugs.len(),
        "pharmacology_data": pharmacology,
    })
    .to_string();

    let response = gemini.generate(BURDEN_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "anticholinergic_burden": {
                "total_score": 0.0,
                "risk_level": "low",
                "per_drug": [],
                "clinical_implication": "Unable to compute"
            },
            "sedation_load": {
                "total_score": 0.0,
                "risk_level": "low",
                "per_drug": [],
                "clinical_implication": "Unable to compute"
            },
            "qt_prolongation_risk": {
                "total_score": 0.0,
                "risk_level": "low",
                "per_drug": [],
                "clinical_implication": "Unable to compute"
            },
            "total_burden_summary": "Unable to compute burden scores"
        })
    });

    Ok(BurdenScores {
        anticholinergic_burden: parsed
            .get("anticholinergic_burden")
            .and_then(|b| serde_json::from_value(b.clone()).ok())
            .unwrap_or_else(|| crate::models::BurdenDetail {
                total_score: 0.0,
                risk_level: "unknown".to_string(),
                per_drug: vec![],
                clinical_implication: "Unable to compute".to_string(),
            }),
        sedation_load: parsed
            .get("sedation_load")
            .and_then(|b| serde_json::from_value(b.clone()).ok())
            .unwrap_or_else(|| crate::models::BurdenDetail {
                total_score: 0.0,
                risk_level: "unknown".to_string(),
                per_drug: vec![],
                clinical_implication: "Unable to compute".to_string(),
            }),
        qt_prolongation_risk: parsed
            .get("qt_prolongation_risk")
            .and_then(|b| serde_json::from_value(b.clone()).ok())
            .unwrap_or_else(|| crate::models::BurdenDetail {
                total_score: 0.0,
                risk_level: "unknown".to_string(),
                per_drug: vec![],
                clinical_implication: "Unable to compute".to_string(),
            }),
        total_burden_summary: parsed
            .get("total_burden_summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Unable to compute burden scores")
            .to_string(),
    })
}
