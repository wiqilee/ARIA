use anyhow::Result;

use crate::api::{DrugBankClient, GeminiClient, RxNormClient};
use crate::llm::GRAPH_SYSTEM_PROMPT;
use crate::models::{Drug, InteractionGraph};

/// Build an N-drug interaction graph with hub identification and emergent interaction detection.
pub async fn build_interaction_graph(
    drugs: &[Drug],
    rxnorm: &RxNormClient,
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<InteractionGraph> {
    // Step 1: Resolve all RxCUIs
    let mut resolved: Vec<(String, Option<String>)> = Vec::new();
    for drug in drugs {
        let rxcui = if let Some(ref cui) = drug.rxcui {
            Some(cui.clone())
        } else {
            rxnorm
                .resolve_rxcui(&drug.name)
                .await?
                .map(|r| r.rxcui)
        };
        resolved.push((drug.name.clone(), rxcui));
    }

    // Step 2: Collect all pairwise interaction data
    let mut pairwise_data = Vec::new();
    for i in 0..resolved.len() {
        for j in (i + 1)..resolved.len() {
            if let (Some(ref cui_a), Some(ref cui_b)) = (&resolved[i].1, &resolved[j].1) {
                let interactions = rxnorm.get_interactions(cui_a, cui_b).await?;
                for interaction in &interactions {
                    pairwise_data.push(serde_json::json!({
                        "drug_a": resolved[i].0,
                        "drug_b": resolved[j].0,
                        "severity": interaction.severity,
                        "description": interaction.description,
                    }));
                }
            }

            // Also check CYP overlap from DrugBank
            let cyp_overlap = drugbank.check_cyp_overlap(&resolved[i].0, &resolved[j].0);
            if !cyp_overlap.is_empty() {
                pairwise_data.push(serde_json::json!({
                    "drug_a": resolved[i].0,
                    "drug_b": resolved[j].0,
                    "cyp_overlap": cyp_overlap,
                    "source": "drugbank_cyp_analysis",
                }));
            }
        }
    }

    // Step 3: Collect pharmacology data for each drug
    let mut pharmacology = Vec::new();
    for drug in drugs {
        if let Some(pharm) = drugbank.get_pharmacology(&drug.name).await? {
            pharmacology.push(serde_json::json!({
                "name": pharm.name,
                "cyp_enzymes": pharm.cyp_enzymes,
                "half_life": pharm.half_life,
                "protein_binding": pharm.protein_binding,
                "clearance_route": pharm.clearance_route,
            }));
        }
    }

    // Step 4: Use Gemini to build the full graph analysis
    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "total_drugs": drugs.len(),
        "possible_pairs": drugs.len() * (drugs.len() - 1) / 2,
        "pairwise_interactions": pairwise_data,
        "pharmacology_data": pharmacology,
    })
    .to_string();

    let response = gemini.generate(GRAPH_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "nodes": [],
            "edges": [],
            "hub_drugs": [],
            "emergent_interactions": [],
            "graph_density": 0.0
        })
    });

    let nodes = parsed
        .get("nodes")
        .and_then(|n| serde_json::from_value(n.clone()).ok())
        .unwrap_or_default();
    let edges: Vec<crate::models::GraphEdge> = parsed
        .get("edges")
        .and_then(|e| serde_json::from_value(e.clone()).ok())
        .unwrap_or_default();
    let hub_drugs = parsed
        .get("hub_drugs")
        .and_then(|h| serde_json::from_value(h.clone()).ok())
        .unwrap_or_default();
    let emergent_interactions = parsed
        .get("emergent_interactions")
        .and_then(|e| serde_json::from_value(e.clone()).ok())
        .unwrap_or_default();
    let graph_density = parsed
        .get("graph_density")
        .and_then(|d| d.as_f64())
        .unwrap_or(0.0);

    let total_edges = edges.len();

    Ok(InteractionGraph {
        nodes,
        edges,
        hub_drugs,
        emergent_interactions,
        total_edges,
        graph_density,
    })
}
