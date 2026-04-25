#![allow(dead_code)]

pub mod burden_scores;
pub mod check_interactions;
pub mod deprescribing_plan;
pub mod explain_mechanism;
pub mod generate_report;
pub mod interaction_graph;
pub mod score_risk;
pub mod suggest_alternatives;
pub mod temporal_cascade;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::{DrugBankClient, GeminiClient, OpenFdaClient, PubMedClient, RxNormClient};
use crate::models::{Drug, FullAnalysis, PatientContext};

/// MCP tool call request.
#[derive(Debug, Deserialize)]
pub struct ToolCallRequest {
    pub method: String,
    pub params: Value,
}

/// MCP tool call response.
#[derive(Debug, Serialize)]
pub struct ToolCallResponse {
    pub result: Value,
}

/// Registry of all available MCP tools.
#[derive(Debug, Serialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Return the list of all available tools and their schemas.
pub fn list_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "check_interactions".to_string(),
            description: "Detect pairwise and N-drug interactions from a medication list with patient context.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "rxcui": {"type": "string"},
                                "dose": {"type": "string"},
                                "frequency": {"type": "string"},
                                "indication": {"type": "string"}
                            },
                            "required": ["name"]
                        }
                    },
                    "patient_context": {
                        "type": "object",
                        "properties": {
                            "age": {"type": "integer"},
                            "sex": {"type": "string"},
                            "weight_kg": {"type": "number"},
                            "ckd_stage": {"type": "integer"},
                            "hepatic_impairment": {"type": "boolean"},
                            "smoking": {"type": "boolean"},
                            "comorbidities": {"type": "array", "items": {"type": "string"}},
                            "allergies": {"type": "array", "items": {"type": "string"}}
                        }
                    }
                },
                "required": ["drugs"]
            }),
        },
        ToolDefinition {
            name: "explain_mechanism".to_string(),
            description: "Provide mechanistic reasoning for a drug interaction at the molecular level (CYP enzymes, renal clearance, protein binding).".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drug_a": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
                    "drug_b": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
                },
                "required": ["drug_a", "drug_b"]
            }),
        },
        ToolDefinition {
            name: "score_risk".to_string(),
            description: "Calculate a personalized risk score (0-10) for a drug interaction adjusted for patient phenotype.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "interaction": {"type": "object"},
                    "phenotype": {
                        "type": "object",
                        "properties": {
                            "age": {"type": "integer"},
                            "sex": {"type": "string"},
                            "weight_kg": {"type": "number"},
                            "ckd_stage": {"type": "integer"},
                            "hepatic_impairment": {"type": "boolean"},
                            "smoking": {"type": "boolean"}
                        }
                    }
                },
                "required": ["interaction", "phenotype"]
            }),
        },
        ToolDefinition {
            name: "suggest_alternatives".to_string(),
            description: "Suggest evidence-based drug alternatives to reduce interaction risk.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drug": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
                    "reason": {"type": "string"},
                    "patient_context": {"type": "object"}
                },
                "required": ["drug", "reason"]
            }),
        },
        ToolDefinition {
            name: "build_interaction_graph".to_string(),
            description: "Construct an N-drug interaction graph with hub drug identification and emergent multi-drug interaction detection.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
                    }
                },
                "required": ["drugs"]
            }),
        },
        ToolDefinition {
            name: "compute_burden_scores".to_string(),
            description: "Calculate cumulative anticholinergic burden, sedation load, and QT prolongation risk across all medications.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
                    }
                },
                "required": ["drugs"]
            }),
        },
        ToolDefinition {
            name: "model_temporal_cascade".to_string(),
            description: "Model the timeline of risk evolution for drug interactions, predicting peak risk and intervention windows.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "drugs": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
                    },
                    "timeline": {
                        "type": "object",
                        "properties": {
                            "duration_days": {"type": "integer", "default": 14}
                        }
                    }
                },
                "required": ["drugs"]
            }),
        },
        ToolDefinition {
            name: "generate_deprescribing_plan".to_string(),
            description: "Produce a prioritized, actionable deprescribing plan with expected risk reduction per step.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis": {"type": "object", "description": "Full analysis output from all previous tools"}
                },
                "required": ["analysis"]
            }),
        },
        ToolDefinition {
            name: "generate_report".to_string(),
            description: "Assemble all analysis results into a structured clinical report.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "analysis": {"type": "object", "description": "Full analysis output from all previous tools"}
                },
                "required": ["analysis"]
            }),
        },
    ]
}

/// Dispatch a tool call to the appropriate handler.
pub async fn dispatch_tool(
    tool_name: &str,
    params: &Value,
    rxnorm: &RxNormClient,
    openfda: &OpenFdaClient,
    _pubmed: &PubMedClient,
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<Value> {
    match tool_name {
        "check_interactions" => {
            let drugs: Vec<Drug> = serde_json::from_value(
                params.get("drugs").cloned().unwrap_or(Value::Array(vec![])),
            )?;
            let patient_context: PatientContext = params
                .get("patient_context")
                .and_then(|p| serde_json::from_value(p.clone()).ok())
                .unwrap_or_else(|| PatientContext {
                    age: 50,
                    sex: "unknown".to_string(),
                    weight_kg: None,
                    height_cm: None,
                    ckd_stage: 0,
                    hepatic_impairment: false,
                    smoking: false,
                    alcohol_use: "none".to_string(),
                    comorbidities: vec![],
                    allergies: vec![],
                });

            let result = check_interactions::check_interactions(
                &drugs,
                &patient_context,
                rxnorm,
                openfda,
                gemini,
            )
            .await?;

            Ok(serde_json::to_value(result)?)
        }

        "explain_mechanism" => {
            let drug_a: Drug = serde_json::from_value(
                params.get("drug_a").cloned().unwrap_or(Value::Null),
            )?;
            let drug_b: Drug = serde_json::from_value(
                params.get("drug_b").cloned().unwrap_or(Value::Null),
            )?;

            let result =
                explain_mechanism::explain_mechanism(&drug_a, &drug_b, drugbank, gemini).await?;

            Ok(serde_json::to_value(result)?)
        }

        "score_risk" => {
            let interaction = serde_json::from_value(
                params.get("interaction").cloned().unwrap_or(Value::Null),
            )?;
            let phenotype = serde_json::from_value(
                params.get("phenotype").cloned().unwrap_or(Value::Null),
            )?;

            let result = score_risk::score_risk(&interaction, &phenotype, gemini).await?;

            Ok(serde_json::to_value(result)?)
        }

        "suggest_alternatives" => {
            let drug: Drug = serde_json::from_value(
                params.get("drug").cloned().unwrap_or(Value::Null),
            )?;
            let reason = params
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or("interaction risk");
            let patient_context: PatientContext = params
                .get("patient_context")
                .and_then(|p| serde_json::from_value(p.clone()).ok())
                .unwrap_or_else(|| PatientContext {
                    age: 50,
                    sex: "unknown".to_string(),
                    weight_kg: None,
                    height_cm: None,
                    ckd_stage: 0,
                    hepatic_impairment: false,
                    smoking: false,
                    alcohol_use: "none".to_string(),
                    comorbidities: vec![],
                    allergies: vec![],
                });

            let result = suggest_alternatives::suggest_alternatives(
                &drug,
                reason,
                &patient_context,
                gemini,
            )
            .await?;

            Ok(serde_json::to_value(result)?)
        }

        "build_interaction_graph" => {
            let drugs: Vec<Drug> = serde_json::from_value(
                params.get("drugs").cloned().unwrap_or(Value::Array(vec![])),
            )?;

            let result =
                interaction_graph::build_interaction_graph(&drugs, rxnorm, drugbank, gemini)
                    .await?;

            Ok(serde_json::to_value(result)?)
        }

        "compute_burden_scores" => {
            let drugs: Vec<Drug> = serde_json::from_value(
                params.get("drugs").cloned().unwrap_or(Value::Array(vec![])),
            )?;

            let result =
                burden_scores::compute_burden_scores(&drugs, drugbank, gemini).await?;

            Ok(serde_json::to_value(result)?)
        }

        "model_temporal_cascade" => {
            let drugs: Vec<Drug> = serde_json::from_value(
                params.get("drugs").cloned().unwrap_or(Value::Array(vec![])),
            )?;
            let timeline_days = params
                .get("timeline")
                .and_then(|t| t.get("duration_days"))
                .and_then(|d| d.as_u64())
                .unwrap_or(14) as u32;

            let result = temporal_cascade::model_temporal_cascade(
                &drugs,
                timeline_days,
                drugbank,
                gemini,
            )
            .await?;

            Ok(serde_json::to_value(result)?)
        }

        "generate_deprescribing_plan" => {
            let analysis: FullAnalysis = serde_json::from_value(
                params.get("analysis").cloned().unwrap_or(Value::Null),
            )?;

            let result =
                deprescribing_plan::generate_deprescribing_plan(&analysis, gemini).await?;

            Ok(serde_json::to_value(result)?)
        }

        "generate_report" => {
            let analysis: FullAnalysis = serde_json::from_value(
                params.get("analysis").cloned().unwrap_or(Value::Null),
            )?;

            let result = generate_report::generate_report(&analysis, gemini).await?;

            Ok(serde_json::to_value(result)?)
        }

        _ => bail!("Unknown tool: {}", tool_name),
    }
}
