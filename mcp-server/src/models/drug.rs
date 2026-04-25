#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Represents a single drug with optional RxNorm normalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Drug {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rxcui: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indication: Option<String>,
}

/// Normalized drug with confirmed RxNorm CUI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedDrug {
    pub name: String,
    pub rxcui: String,
    pub normalized_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indication: Option<String>,
}

/// DrugBank pharmacology data for a drug.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugPharmacology {
    pub name: String,
    pub drugbank_id: Option<String>,
    pub cyp_enzymes: Vec<CypEnzyme>,
    pub half_life: Option<String>,
    pub protein_binding: Option<String>,
    pub clearance_route: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CypEnzyme {
    pub enzyme: String,
    pub role: String, // "substrate", "inhibitor", "inducer"
}

/// FDA label data from OpenFDA.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FdaLabel {
    pub brand_name: Option<String>,
    pub generic_name: Option<String>,
    pub drug_interactions: Option<String>,
    pub warnings: Option<String>,
    pub adverse_reactions: Option<String>,
    pub contraindications: Option<String>,
}
