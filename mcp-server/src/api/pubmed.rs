#![allow(dead_code)]

use anyhow::{Context, Result};
use reqwest::Client;

use crate::models::PubMedCitation;

const PUBMED_SEARCH: &str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH: &str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

/// Client for the PubMed E-utilities API.
#[derive(Clone)]
pub struct PubMedClient {
    http: Client,
}

impl PubMedClient {
    pub fn new() -> Self {
        Self {
            http: Client::new(),
        }
    }

    /// Search PubMed for articles related to a drug interaction.
    pub async fn search_interaction(
        &self,
        drug_a: &str,
        drug_b: &str,
        max_results: u32,
    ) -> Result<Vec<PubMedCitation>> {
        let query = format!(
            "({} AND {} AND drug interaction)",
            drug_a, drug_b
        );
        self.search(&query, max_results).await
    }

    /// General PubMed search with a query string.
    pub async fn search(&self, query: &str, max_results: u32) -> Result<Vec<PubMedCitation>> {
        // Step 1: Search for PMIDs
        let search_url = format!(
            "{}?db=pubmed&term={}&retmax={}&retmode=json&sort=relevance",
            PUBMED_SEARCH, query, max_results
        );

        let search_resp = self
            .http
            .get(&search_url)
            .send()
            .await
            .context("PubMed search failed")?;

        let search_data: serde_json::Value = search_resp.json().await?;

        let pmids: Vec<String> = search_data
            .pointer("/esearchresult/idlist")
            .and_then(|ids| ids.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        if pmids.is_empty() {
            return Ok(vec![]);
        }

        // Step 2: Fetch summaries for the PMIDs
        let ids_param = pmids.join(",");
        let fetch_url = format!(
            "{}?db=pubmed&id={}&retmode=json",
            PUBMED_FETCH, ids_param
        );

        let fetch_resp = self.http.get(&fetch_url).send().await?;
        let fetch_data: serde_json::Value = fetch_resp.json().await?;

        let result_map = fetch_data
            .pointer("/result")
            .and_then(|r| r.as_object());

        let citations: Vec<PubMedCitation> = pmids
            .iter()
            .filter_map(|pmid| {
                result_map
                    .and_then(|m| m.get(pmid))
                    .map(|entry| PubMedCitation {
                        pmid: pmid.clone(),
                        title: entry
                            .get("title")
                            .and_then(|t| t.as_str())
                            .unwrap_or("Unknown title")
                            .to_string(),
                        authors: entry
                            .get("authors")
                            .and_then(|a| a.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|a| a.get("name").and_then(|n| n.as_str()))
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            })
                            .unwrap_or_else(|| "Unknown authors".to_string()),
                        journal: entry
                            .get("fulljournalname")
                            .and_then(|j| j.as_str())
                            .unwrap_or("Unknown journal")
                            .to_string(),
                        year: entry
                            .get("pubdate")
                            .and_then(|d| d.as_str())
                            .unwrap_or("Unknown")
                            .to_string(),
                        abstract_text: None,
                    })
            })
            .collect();

        Ok(citations)
    }
}
