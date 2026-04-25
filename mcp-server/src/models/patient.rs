use serde::{Deserialize, Serialize};

/// Full patient context for risk assessment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientContext {
    #[serde(default = "default_age")]
    pub age: u32,
    #[serde(default = "default_sex")]
    pub sex: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight_kg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_cm: Option<f64>,
    #[serde(default)]
    pub ckd_stage: u8,
    #[serde(default)]
    pub hepatic_impairment: bool,
    #[serde(default)]
    pub smoking: bool,
    #[serde(default = "default_alcohol")]
    pub alcohol_use: String,
    #[serde(default)]
    pub comorbidities: Vec<String>,
    #[serde(default)]
    pub allergies: Vec<String>,
}

fn default_age() -> u32 {
    50
}
fn default_sex() -> String {
    "unknown".to_string()
}
fn default_alcohol() -> String {
    "none".to_string()
}

/// Patient phenotype fields relevant to risk scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatientPhenotype {
    pub age: u32,
    pub sex: String,
    pub weight_kg: Option<f64>,
    pub ckd_stage: u8,
    pub hepatic_impairment: bool,
    pub smoking: bool,
}

impl From<&PatientContext> for PatientPhenotype {
    fn from(ctx: &PatientContext) -> Self {
        Self {
            age: ctx.age,
            sex: ctx.sex.clone(),
            weight_kg: ctx.weight_kg,
            ckd_stage: ctx.ckd_stage,
            hepatic_impairment: ctx.hepatic_impairment,
            smoking: ctx.smoking,
        }
    }
}
