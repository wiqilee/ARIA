use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;

use crate::models::{CypEnzyme, DrugPharmacology};

/// Client for DrugBank Open Data.
///
/// DrugBank Open Data is a CSV/XML dataset. For this implementation, we use
/// an in-memory lookup table of common drugs and their CYP interactions.
/// In production, this would be loaded from the full DrugBank Open Data release.
#[derive(Clone)]
pub struct DrugBankClient {
    pharmacology_db: HashMap<String, DrugPharmacologyEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct DrugPharmacologyEntry {
    drugbank_id: String,
    cyp_enzymes: Vec<CypEnzymeEntry>,
    half_life: String,
    protein_binding: String,
    clearance_route: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CypEnzymeEntry {
    enzyme: String,
    role: String,
}

impl DrugBankClient {
    pub fn new() -> Self {
        let mut db = HashMap::new();

        // Preloaded pharmacology data for commonly interacting drugs
        let entries = vec![
            ("warfarin", DrugPharmacologyEntry {
                drugbank_id: "DB00682".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2C9".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP1A2".to_string(), role: "substrate".to_string() },
                ],
                half_life: "20-60 hours".to_string(),
                protein_binding: "99%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("aspirin", DrugPharmacologyEntry {
                drugbank_id: "DB00945".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2C9".to_string(), role: "substrate".to_string() },
                ],
                half_life: "15-20 minutes (aspirin); 6 hours (salicylate)".to_string(),
                protein_binding: "80-90%".to_string(),
                clearance_route: "renal".to_string(),
            }),
            ("omeprazole", DrugPharmacologyEntry {
                drugbank_id: "DB00338".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2C19".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP2C19".to_string(), role: "inhibitor".to_string() },
                ],
                half_life: "0.5-1 hour".to_string(),
                protein_binding: "95%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("fluconazole", DrugPharmacologyEntry {
                drugbank_id: "DB00196".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2C9".to_string(), role: "inhibitor".to_string() },
                    CypEnzymeEntry { enzyme: "CYP2C19".to_string(), role: "inhibitor".to_string() },
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "inhibitor".to_string() },
                ],
                half_life: "30 hours".to_string(),
                protein_binding: "11-12%".to_string(),
                clearance_route: "renal".to_string(),
            }),
            ("metformin", DrugPharmacologyEntry {
                drugbank_id: "DB00331".to_string(),
                cyp_enzymes: vec![],
                half_life: "4-8.7 hours".to_string(),
                protein_binding: "negligible".to_string(),
                clearance_route: "renal".to_string(),
            }),
            ("amlodipine", DrugPharmacologyEntry {
                drugbank_id: "DB00381".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                ],
                half_life: "30-50 hours".to_string(),
                protein_binding: "93-98%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("simvastatin", DrugPharmacologyEntry {
                drugbank_id: "DB00641".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                ],
                half_life: "1.9 hours".to_string(),
                protein_binding: "95%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("amitriptyline", DrugPharmacologyEntry {
                drugbank_id: "DB00321".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2D6".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP2C19".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                ],
                half_life: "10-50 hours".to_string(),
                protein_binding: "96%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("diphenhydramine", DrugPharmacologyEntry {
                drugbank_id: "DB01075".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2D6".to_string(), role: "inhibitor".to_string() },
                ],
                half_life: "2.4-9.3 hours".to_string(),
                protein_binding: "78%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("oxybutynin", DrugPharmacologyEntry {
                drugbank_id: "DB01062".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                ],
                half_life: "2-3 hours".to_string(),
                protein_binding: ">99%".to_string(),
                clearance_route: "hepatic".to_string(),
            }),
            ("clopidogrel", DrugPharmacologyEntry {
                drugbank_id: "DB00758".to_string(),
                cyp_enzymes: vec![
                    CypEnzymeEntry { enzyme: "CYP2C19".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP3A4".to_string(), role: "substrate".to_string() },
                    CypEnzymeEntry { enzyme: "CYP2B6".to_string(), role: "substrate".to_string() },
                ],
                half_life: "6 hours".to_string(),
                protein_binding: "94-98%".to_string(),
                clearance_route: "hepatic/renal".to_string(),
            }),
            ("lisinopril", DrugPharmacologyEntry {
                drugbank_id: "DB00722".to_string(),
                cyp_enzymes: vec![],
                half_life: "12 hours".to_string(),
                protein_binding: "0%".to_string(),
                clearance_route: "renal".to_string(),
            }),
        ];

        for (name, entry) in entries {
            db.insert(name.to_string(), entry);
        }

        Self {
            pharmacology_db: db,
        }
    }

    /// Get pharmacology data for a drug.
    pub async fn get_pharmacology(&self, drug_name: &str) -> Result<Option<DrugPharmacology>> {
        let key = drug_name.to_lowercase();

        Ok(self.pharmacology_db.get(&key).map(|entry| DrugPharmacology {
            name: drug_name.to_string(),
            drugbank_id: Some(entry.drugbank_id.clone()),
            cyp_enzymes: entry
                .cyp_enzymes
                .iter()
                .map(|e| CypEnzyme {
                    enzyme: e.enzyme.clone(),
                    role: e.role.clone(),
                })
                .collect(),
            half_life: Some(entry.half_life.clone()),
            protein_binding: Some(entry.protein_binding.clone()),
            clearance_route: Some(entry.clearance_route.clone()),
        }))
    }

    /// Check if two drugs share CYP enzyme pathways (potential pharmacokinetic interaction).
    pub fn check_cyp_overlap(&self, drug_a: &str, drug_b: &str) -> Vec<String> {
        let a_key = drug_a.to_lowercase();
        let b_key = drug_b.to_lowercase();

        let a_enzymes: Vec<_> = self
            .pharmacology_db
            .get(&a_key)
            .map(|e| &e.cyp_enzymes)
            .unwrap_or(&vec![])
            .iter()
            .map(|e| e.enzyme.clone())
            .collect();

        let b_enzymes: Vec<_> = self
            .pharmacology_db
            .get(&b_key)
            .map(|e| &e.cyp_enzymes)
            .unwrap_or(&vec![])
            .iter()
            .map(|e| e.enzyme.clone())
            .collect();

        a_enzymes
            .iter()
            .filter(|e| b_enzymes.contains(e))
            .cloned()
            .collect()
    }
}
