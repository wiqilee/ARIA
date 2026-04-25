#![allow(dead_code)]

use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

const RXNORM_BASE: &str = "https://rxnav.nlm.nih.gov/REST";

/// Client for the NIH RxNorm API.
#[derive(Clone)]
pub struct RxNormClient {
    http: Client,
}

#[derive(Debug, Deserialize)]
struct RxNormSearchResponse {
    #[serde(rename = "idGroup")]
    id_group: Option<IdGroup>,
}

#[derive(Debug, Deserialize)]
struct IdGroup {
    #[serde(rename = "rxnormId")]
    rxnorm_id: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct RxNormPropertiesResponse {
    properties: Option<RxNormProperties>,
}

#[derive(Debug, Deserialize)]
struct RxNormProperties {
    #[serde(rename = "rxcui")]
    rxcui: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InteractionResponse {
    #[serde(rename = "fullInteractionTypeGroup")]
    full_interaction_type_group: Option<Vec<InteractionTypeGroup>>,
}

#[derive(Debug, Deserialize)]
struct InteractionTypeGroup {
    #[serde(rename = "fullInteractionType")]
    full_interaction_type: Option<Vec<FullInteractionType>>,
}

#[derive(Debug, Deserialize)]
struct FullInteractionType {
    #[serde(rename = "interactionPair")]
    interaction_pair: Option<Vec<InteractionPair>>,
}

#[derive(Debug, Deserialize)]
struct InteractionPair {
    severity: Option<String>,
    description: Option<String>,
}

/// Result of an RxNorm lookup.
#[derive(Debug, Clone)]
pub struct RxNormResult {
    pub rxcui: String,
    pub name: String,
}

/// Pairwise interaction from RxNorm.
#[derive(Debug, Clone)]
pub struct RxNormInteraction {
    pub severity: String,
    pub description: String,
}

impl RxNormClient {
    pub fn new() -> Self {
        Self {
            http: Client::new(),
        }
    }

    /// Resolve a drug name to its RxNorm CUI.
    pub async fn resolve_rxcui(&self, drug_name: &str) -> Result<Option<RxNormResult>> {
        let url = format!("{}/rxcui.json?name={}&search=1", RXNORM_BASE, drug_name);
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .context("RxNorm lookup failed")?;

        let data: RxNormSearchResponse = resp.json().await?;

        let rxcui = match data.id_group.and_then(|g| g.rxnorm_id).and_then(|ids| ids.into_iter().next()) {
            Some(id) => id,
            None => return Ok(None),
        };

        // Fetch the normalized name
        let props_url = format!("{}/rxcui/{}/properties.json", RXNORM_BASE, rxcui);
        let props_resp = self.http.get(&props_url).send().await?;
        let props: serde_json::Value = props_resp.json().await?;

        let name = props
            .pointer("/properties/name")
            .and_then(|n| n.as_str())
            .unwrap_or(drug_name)
            .to_string();

        Ok(Some(RxNormResult { rxcui, name }))
    }

    /// Get pairwise interactions between two drugs by RxCUI.
    pub async fn get_interactions(&self, rxcui_a: &str, rxcui_b: &str) -> Result<Vec<RxNormInteraction>> {
        let url = format!(
            "{}/interaction/list.json?rxcuis={}+{}",
            RXNORM_BASE, rxcui_a, rxcui_b
        );

        let resp = self.http.get(&url).send().await?;

        if !resp.status().is_success() {
            return Ok(vec![]);
        }

        let data: InteractionResponse = resp.json().await?;

        let interactions = data
            .full_interaction_type_group
            .unwrap_or_default()
            .into_iter()
            .flat_map(|g| g.full_interaction_type.unwrap_or_default())
            .flat_map(|t| t.interaction_pair.unwrap_or_default())
            .map(|pair| RxNormInteraction {
                severity: pair.severity.unwrap_or_else(|| "unknown".to_string()),
                description: pair.description.unwrap_or_default(),
            })
            .collect();

        Ok(interactions)
    }

    /// Get all known interactions for a single drug.
    pub async fn get_drug_interactions(&self, rxcui: &str) -> Result<Vec<RxNormInteraction>> {
        let url = format!("{}/interaction/interaction.json?rxcui={}", RXNORM_BASE, rxcui);

        let resp = self.http.get(&url).send().await?;

        if !resp.status().is_success() {
            return Ok(vec![]);
        }

        let data: InteractionResponse = resp.json().await?;

        let interactions = data
            .full_interaction_type_group
            .unwrap_or_default()
            .into_iter()
            .flat_map(|g| g.full_interaction_type.unwrap_or_default())
            .flat_map(|t| t.interaction_pair.unwrap_or_default())
            .map(|pair| RxNormInteraction {
                severity: pair.severity.unwrap_or_else(|| "unknown".to_string()),
                description: pair.description.unwrap_or_default(),
            })
            .collect();

        Ok(interactions)
    }
}
