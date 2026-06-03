use serde::{Deserialize, Serialize};

/// Personalized risk score for an interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskScore {
    pub interaction_id: String,
    pub drugs: Vec<String>,
    pub base_score: f64,
    pub adjusted_score: f64,
    /// Deterministic severity label derived from `adjusted_score` by
    /// `severity_label_for_score()` in `tools/score_risk.rs`.
    /// One of: "LOW", "MODERATE", "HIGH", "CRITICAL".
    /// `#[serde(default)]` keeps older payloads (without this field)
    /// deserializable as empty string — the agent layer backfills it.
    #[serde(default)]
    pub severity_label: String,
    pub risk_factors: Vec<RiskFactor>,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskFactor {
    pub factor: String,
    pub multiplier: f64,
    pub explanation: String,
}

/// Cumulative burden scores across all medications.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurdenScores {
    pub anticholinergic_burden: BurdenDetail,
    pub sedation_load: BurdenDetail,
    pub qt_prolongation_risk: BurdenDetail,
    pub total_burden_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BurdenDetail {
    pub total_score: f64,
    pub risk_level: String, // "low", "moderate", "high", "critical"
    pub per_drug: Vec<DrugContribution>,
    pub clinical_implication: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrugContribution {
    pub drug_name: String,
    pub contribution: f64,
    pub note: String,
}

/// Temporal cascade model for risk evolution over time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CascadeModel {
    pub drugs: Vec<String>,
    pub timeline_days: u32,
    pub daily_risk: Vec<DailyRisk>,
    pub peak_risk_day: u32,
    pub peak_risk_score: f64,
    pub intervention_windows: Vec<InterventionWindow>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyRisk {
    pub day: u32,
    pub risk_score: f64,
    pub key_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterventionWindow {
    pub day_start: u32,
    pub day_end: u32,
    pub action: String,
    pub urgency: String,
}

/// Single step in a deprescribing plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeprescribingStep {
    pub priority: u32,
    pub drug: String,
    pub action: String, // "discontinue", "reduce", "substitute"
    pub substitute: Option<String>,
    pub monitoring: Vec<String>,
    pub expected_risk_reduction: f64,
    pub timeline: String,
    pub rationale: String,
}

/// Full deprescribing plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeprescribingPlan {
    pub steps: Vec<DeprescribingStep>,
    pub total_expected_risk_reduction: f64,
    pub summary: String,
    pub warnings: Vec<String>,
}

/// Full structured clinical report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalReport {
    pub patient_summary: String,
    pub medication_count: usize,
    pub interaction_summary: String,
    pub critical_findings: Vec<String>,
    pub risk_scores: Vec<RiskScore>,
    pub burden_scores: Option<BurdenScores>,
    pub temporal_summary: Option<String>,
    pub deprescribing_plan: Option<DeprescribingPlan>,
    pub evidence_citations: Vec<String>,
    pub overall_risk_level: String,
    pub report_text: String,
}

/// One drug flagged for renal dose review.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenalDrugAdjustment {
    pub drug: String,
    pub renal_handling: String,
    /// "reduce" | "avoid" | "monitor" | "adjust" | "no_change"
    pub action: String,
    pub recommendation: String,
    /// eGFR (mL/min/1.73m²) below which this rule applies, if any.
    pub egfr_threshold: Option<f64>,
}

/// Deterministic renal dosing assessment for the medication list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenalAssessment {
    pub ckd_stage: u8,
    /// Estimated eGFR band derived from CKD stage (not measured).
    pub estimated_egfr_range: String,
    pub flagged: Vec<RenalDrugAdjustment>,
    /// Drugs with no renal concern in the reference set.
    pub ok: Vec<String>,
    pub summary: String,
    pub disclaimer: String,
}

/// One potentially-inappropriate medication (PIM) flag from Beers / STOPP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppropriatenessFlag {
    pub drug: String,
    /// "beers" | "stopp"
    pub framework: String,
    /// Short criterion reference, e.g. "Beers 2023: first-generation antihistamine".
    pub criterion: String,
    pub rationale: String,
    pub recommendation: String,
}

/// One prescribing omission (a drug that should arguably be present) from START.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrescribingOmission {
    /// Drug class or agent that may be missing, e.g. "statin".
    pub omission: String,
    pub criterion: String,
    /// The comorbidity/indication that triggered the omission flag.
    pub triggered_by: String,
    pub rationale: String,
    pub recommendation: String,
}

/// Deterministic geriatric prescribing-appropriateness screen
/// (AGS Beers + STOPP/START), mirrors `RenalAssessment` in shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppropriatenessAssessment {
    pub age: u32,
    /// True when the patient meets the screening age (default 65).
    pub screened: bool,
    /// Potentially inappropriate medications detected (Beers + STOPP).
    pub pim_flags: Vec<AppropriatenessFlag>,
    /// Potential prescribing omissions detected (START).
    pub omissions: Vec<PrescribingOmission>,
    pub summary: String,
    pub disclaimer: String,
}

/// Combined analysis passed to report and deprescribing tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullAnalysis {
    pub medications: Vec<String>,
    pub patient_context: serde_json::Value,
    pub interactions: serde_json::Value,
    pub graph: Option<serde_json::Value>,
    pub risk_scores: Vec<serde_json::Value>,
    pub burden_scores: Option<serde_json::Value>,
    pub temporal_model: Option<serde_json::Value>,
    pub evidence: Vec<serde_json::Value>,
}
