#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Severity level for a drug interaction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Moderate,
    High,
    Critical,
}

/// Evidence grade for a drug interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvidenceGrade {
    A, // Strong clinical evidence
    B, // Moderate clinical evidence
    C, // Limited evidence / case reports
    D, // Theoretical / in-vitro only
}

/// A single detected drug interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Interaction {
    pub id: String,
    pub drugs: Vec<String>,
    pub severity: Severity,
    pub interaction_type: String, // "pharmacokinetic", "pharmacodynamic", "combined"
    pub description: String,
    pub mechanism: Option<String>,
    pub clinical_significance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_grade: Option<EvidenceGrade>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence_score: Option<f64>,
    #[serde(default)]
    pub pubmed_ids: Vec<String>,
}

/// Full interaction report from check_interactions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionReport {
    pub interactions: Vec<Interaction>,
    pub total_interactions: usize,
    pub critical_count: usize,
    pub high_count: usize,
    pub summary: String,
}

/// Mechanistic explanation for a drug pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MechanisticExplanation {
    pub drug_a: String,
    pub drug_b: String,
    pub mechanism_type: String,
    pub pathways: Vec<MechanismPathway>,
    pub clinical_consequence: String,
    pub management_recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MechanismPathway {
    pub pathway_name: String,
    pub description: String,
    pub enzymes_involved: Vec<String>,
    pub effect: String,
}

/// Node in the N-drug interaction graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub drug_name: String,
    pub rxcui: Option<String>,
    pub degree: usize,
    pub is_hub: bool,
    pub hub_score: f64,
}

/// Edge in the N-drug interaction graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub severity: Severity,
    pub interaction_type: String,
    pub weight: f64,
}

/// Emergent multi-drug interaction that pairwise logic misses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmergentInteraction {
    pub drugs: Vec<String>,
    pub description: String,
    pub mechanism: String,
    pub severity: Severity,
}

/// Full N-drug interaction graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub hub_drugs: Vec<String>,
    pub emergent_interactions: Vec<EmergentInteraction>,
    pub total_edges: usize,
    pub graph_density: f64,
}

/// Drug substitution alternative.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternative {
    pub drug_name: String,
    pub reason: String,
    pub trade_offs: String,
    pub evidence_support: String,
}

/// Alternatives response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternatives {
    pub original_drug: String,
    pub removal_reason: String,
    pub alternatives: Vec<Alternative>,
}

/// PubMed citation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PubMedCitation {
    pub pmid: String,
    pub title: String,
    pub authors: String,
    pub journal: String,
    pub year: String,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
}
