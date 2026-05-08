// mcp-server/src/tools/fhir_patient_medications.rs
//
// MCP tool: reads a patient's active medications from a FHIR R4 endpoint.
//
// SHARP Extension Specs propagation:
//   X-FHIR-Server-URL   -> fhir_server_url    (overrides FHIR_BASE_URL)
//   X-FHIR-Access-Token -> fhir_bearer_token  (sent as Authorization: Bearer)
//   X-Patient-ID        -> patient_id         (overrides FHIR_DEFAULT_PATIENT_ID)
//
// All three are optional. The agent layer reads them off the inbound A2A
// request and passes them down as MCP tool arguments. See docs/sharp-integration.md.

use serde::{Deserialize, Serialize};
use anyhow::{Context, Result};
use std::env;

#[derive(Debug, Deserialize)]
pub struct FhirPatientMedicationsInput {
    /// Patient FHIR resource ID. Falls back to FHIR_DEFAULT_PATIENT_ID env var
    /// when empty. Sourced from the X-Patient-ID SHARP header at the agent layer.
    #[serde(default)]
    pub patient_id: String,

    /// Optional bearer token. When empty, no Authorization header is sent
    /// (works for the public HAPI sandbox; production endpoints require a
    /// token). Sourced from the X-FHIR-Access-Token SHARP header at the
    /// agent layer.
    #[serde(default)]
    pub fhir_bearer_token: String,

    /// Optional per-request FHIR base URL. When empty, falls back to the
    /// FHIR_BASE_URL env var. Sourced from the X-FHIR-Server-URL SHARP
    /// header at the agent layer. This is what enables a single ARIA
    /// deployment to serve callers pointing at different FHIR endpoints
    /// (Epic, Cerner, HAPI, etc.) without redeploying.
    #[serde(default)]
    pub fhir_server_url: String,
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
    // 1. Resolve the FHIR base URL.
    //    Priority: explicit tool arg (from SHARP header) > env var > public sandbox.
    let base_url = if !input.fhir_server_url.is_empty() {
        input.fhir_server_url
    } else {
        env::var("FHIR_BASE_URL")
            .unwrap_or_else(|_| "https://hapi.fhir.org/baseR4".to_string())
    };

    // 2. Resolve the patient ID.
    //    Priority: explicit tool arg (from SHARP header) > env var > error.
    let patient_id = if input.patient_id.is_empty() {
        env::var("FHIR_DEFAULT_PATIENT_ID")
            .context("patient_id not provided and FHIR_DEFAULT_PATIENT_ID unset")?
    } else {
        input.patient_id
    };

    // 3. Build the FHIR query.
    let url = format!(
        "{base_url}/MedicationRequest?patient={patient_id}&status=active&_count=50"
    );

    let client = reqwest::Client::new();
    let mut req = client.get(&url)
        .header("Accept", "application/fhir+json");

    // 4. Attach the bearer token when provided.
    //    The token never appears in logs; reqwest masks it in error output.
    if !input.fhir_bearer_token.is_empty() {
        // Strip a leading "Bearer " in case the upstream caller already added it,
        // so we never send "Authorization: Bearer Bearer <token>".
        let token = input.fhir_bearer_token
            .strip_prefix("Bearer ")
            .or_else(|| input.fhir_bearer_token.strip_prefix("bearer "))
            .unwrap_or(&input.fhir_bearer_token)
            .trim();
        req = req.header("Authorization", format!("Bearer {token}"));
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