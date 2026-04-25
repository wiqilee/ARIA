#![allow(dead_code)]

use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

use crate::models::FdaLabel;

const OPENFDA_BASE: &str = "https://api.fda.gov/drug";

/// Client for the OpenFDA Drug API.
#[derive(Clone)]
pub struct OpenFdaClient {
    http: Client,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenFdaResponse {
    results: Option<Vec<OpenFdaResult>>,
}

#[derive(Debug, Deserialize)]
struct OpenFdaResult {
    openfda: Option<OpenFdaData>,
    drug_interactions: Option<Vec<String>>,
    warnings: Option<Vec<String>>,
    adverse_reactions: Option<Vec<String>>,
    contraindications_and_precautions: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct OpenFdaData {
    brand_name: Option<Vec<String>>,
    generic_name: Option<Vec<String>>,
}

impl OpenFdaClient {
    pub fn new(api_key: Option<String>) -> Self {
        Self {
            http: Client::new(),
            api_key,
        }
    }

    /// Fetch FDA label data for a drug by name.
    pub async fn get_drug_label(&self, drug_name: &str) -> Result<Option<FdaLabel>> {
        let mut url = format!(
            "{}/label.json?search=openfda.generic_name:\"{}\"&limit=1",
            OPENFDA_BASE, drug_name
        );

        if let Some(ref key) = self.api_key {
            url.push_str(&format!("&api_key={}", key));
        }

        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .context("OpenFDA request failed")?;

        if !resp.status().is_success() {
            // Drug not found in OpenFDA — not an error
            return Ok(None);
        }

        let data: OpenFdaResponse = resp.json().await.context("Failed to parse OpenFDA response")?;

        let label = data.results.and_then(|results| {
            results.into_iter().next().map(|r| FdaLabel {
                brand_name: r
                    .openfda
                    .as_ref()
                    .and_then(|o| o.brand_name.as_ref().and_then(|v| v.first().cloned())),
                generic_name: r
                    .openfda
                    .as_ref()
                    .and_then(|o| o.generic_name.as_ref().and_then(|v| v.first().cloned())),
                drug_interactions: r.drug_interactions.and_then(|v| v.into_iter().next()),
                warnings: r.warnings.and_then(|v| v.into_iter().next()),
                adverse_reactions: r.adverse_reactions.and_then(|v| v.into_iter().next()),
                contraindications: r
                    .contraindications_and_precautions
                    .and_then(|v| v.into_iter().next()),
            })
        });

        Ok(label)
    }

    /// Fetch adverse event reports for a drug.
    pub async fn get_adverse_events(&self, drug_name: &str, limit: u32) -> Result<Vec<serde_json::Value>> {
        let mut url = format!(
            "{}/event.json?search=patient.drug.medicinalproduct:\"{}\"&limit={}",
            OPENFDA_BASE, drug_name, limit
        );

        if let Some(ref key) = self.api_key {
            url.push_str(&format!("&api_key={}", key));
        }

        let resp = self.http.get(&url).send().await?;

        if !resp.status().is_success() {
            return Ok(vec![]);
        }

        let data: serde_json::Value = resp.json().await?;
        let results = data
            .get("results")
            .and_then(|r| r.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(results)
    }
}
