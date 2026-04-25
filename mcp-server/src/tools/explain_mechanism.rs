use anyhow::Result;

use crate::api::{DrugBankClient, GeminiClient};
use crate::llm::MECHANISM_SYSTEM_PROMPT;
use crate::models::{Drug, MechanisticExplanation};

/// Provide mechanistic reasoning for a specific drug interaction.
pub async fn explain_mechanism(
    drug_a: &Drug,
    drug_b: &Drug,
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<MechanisticExplanation> {
    // Gather CYP pathway data from DrugBank
    let pharm_a = drugbank.get_pharmacology(&drug_a.name).await?;
    let pharm_b = drugbank.get_pharmacology(&drug_b.name).await?;
    let cyp_overlap = drugbank.check_cyp_overlap(&drug_a.name, &drug_b.name);

    let user_prompt = serde_json::json!({
        "drug_a": {
            "name": drug_a.name,
            "pharmacology": pharm_a,
        },
        "drug_b": {
            "name": drug_b.name,
            "pharmacology": pharm_b,
        },
        "shared_cyp_enzymes": cyp_overlap,
    })
    .to_string();

    let response = gemini.generate(MECHANISM_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "mechanism_type": "unknown",
            "pathways": [],
            "clinical_consequence": "Unable to determine",
            "management_recommendation": "Consult clinical pharmacist"
        })
    });

    Ok(MechanisticExplanation {
        drug_a: drug_a.name.clone(),
        drug_b: drug_b.name.clone(),
        mechanism_type: parsed
            .get("mechanism_type")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string(),
        pathways: parsed
            .get("pathways")
            .and_then(|p| serde_json::from_value(p.clone()).ok())
            .unwrap_or_default(),
        clinical_consequence: parsed
            .get("clinical_consequence")
            .and_then(|c| c.as_str())
            .unwrap_or("Unknown")
            .to_string(),
        management_recommendation: parsed
            .get("management_recommendation")
            .and_then(|m| m.as_str())
            .unwrap_or("Consult clinical pharmacist")
            .to_string(),
    })
}
