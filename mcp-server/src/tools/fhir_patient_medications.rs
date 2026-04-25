// mcp-server/src/tools/fhir_patient_medications.rs
//
// MCP tool: reads a patient's active medications from a FHIR R4 endpoint.
// Used to ingest real-world medication lists without the clinician manually
// typing them. Patient context and bearer token are provided either via
// SHARP Extension headers (when running under Prompt Opinion) or via env
// fallback for standalone testing.

use serde::{Deserialize, Serialize};
use anyhow::{Context, Result};
use std::env;

#[derive(Debug, Deserialize)]
pub struct FhirPatientMedicationsInput {
    /// Patient FHIR resource ID. When empty, falls back to FHIR_DEFAULT_PATIENT_ID.
    #[serde(default)]
    pub patient_id: String,
    /// Optional SHARP-propagated bearer token. When empty, no auth is sent
    /// (works for public HAPI sandbox; production endpoints require a token).
    #[serde(default)]
    pub fhir_bearer_token: String,
}

#[derive(Debug, Serialize)]
pub struct FhirPatientMedicationsOutput {
    pub patient_id: String,
    pub medications: Vec<FhirMedication>,
    pub total: usize,
    pub fhir_base_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct FhirMedication {
    pub rxnorm_code: Option<String>,
    pub display_name: String,
    pub status: String,
    pub dosage_text: Option<String>,
}

pub async fn execute(input: FhirPatientMedicationsInput) -> Result<FhirPatientMedicationsOutput> {
    let base_url = env::var("FHIR_BASE_URL")
        .unwrap_or_else(|_| "https://hapi.fhir.org/baseR4".to_string());

    let patient_id = if input.patient_id.is_empty() {
        env::var("FHIR_DEFAULT_PATIENT_ID")
            .context("patient_id not provided and FHIR_DEFAULT_PATIENT_ID unset")?
    } else {
        input.patient_id
    };

    let url = format!("{base_url}/MedicationRequest?patient={patient_id}&status=active&_count=50");

    let client = reqwest::Client::new();
    let mut req = client.get(&url)
        .header("Accept", "application/fhir+json");

    if !input.fhir_bearer_token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", input.fhir_bearer_token));
    }

    let bundle: serde_json::Value = req.send().await?.error_for_status()?.json().await?;

    let entries = bundle.get("entry").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut medications = Vec::new();

    for entry in entries {
        let resource = match entry.get("resource") { Some(r) => r, None => continue };
        let medication_cc = resource.pointer("/medicationCodeableConcept");

        let display_name = medication_cc
            .and_then(|m| m.pointer("/text"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                medication_cc
                    .and_then(|m| m.pointer("/coding/0/display"))
                    .and_then(|v| v.as_str())
            })
            .unwrap_or("Unknown medication")
            .to_string();

        let rxnorm_code = medication_cc
            .and_then(|m| m.get("coding").and_then(|c| c.as_array()))
            .and_then(|codings| {
                codings.iter().find(|c| {
                    c.get("system").and_then(|s| s.as_str())
                        == Some("http://www.nlm.nih.gov/research/umls/rxnorm")
                })
            })
            .and_then(|c| c.get("code").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let status = resource.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();

        let dosage_text = resource
            .pointer("/dosageInstruction/0/text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        medications.push(FhirMedication {
            rxnorm_code,
            display_name,
            status,
            dosage_text,
        });
    }

    let total = medications.len();
    Ok(FhirPatientMedicationsOutput {
        patient_id,
        medications,
        total,
        fhir_base_url: base_url,
    })
}