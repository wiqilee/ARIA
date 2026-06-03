//! Renal dosing assessment — deterministic, rule-based.
//!
//! Unlike the other tools in this crate, this one does NOT call Gemini.
//! Renal dose adjustment is a clinical-safety surface where a fixed,
//! auditable ruleset is preferable to generative variance: the same
//! patient + medication list must always produce the same flags. The
//! reference ruleset lives in `../data/renal_dosing.json` and is embedded
//! at compile time via `include_str!`, so there is no runtime file-path or
//! deployment dependency.
//!
//! eGFR is ESTIMATED from CKD stage (the patient phenotype carries a stage,
//! not a measured eGFR). The estimate drives a simple threshold rule per
//! drug. See the `disclaimer` field in the dataset.

use anyhow::Result;
use serde::Deserialize;
use std::collections::HashMap;

use crate::api::GeminiClient;
use crate::models::{Drug, PatientContext, RenalAssessment, RenalDrugAdjustment};

const RENAL_DATA: &str = include_str!("../data/renal_dosing.json");

#[derive(Debug, Deserialize)]
struct RenalRuleSet {
    #[serde(default)]
    stage_egfr_estimate: HashMap<String, f64>,
    drugs: Vec<RenalRule>,
    #[serde(default)]
    disclaimer: String,
}

#[derive(Debug, Deserialize, Clone)]
struct RenalRule {
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    renal_handling: String,
    apply_at_egfr_below: f64,
    action: String,
    recommendation: String,
}

fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

fn estimate_egfr(ckd_stage: u8, rules: &RenalRuleSet) -> f64 {
    if let Some(v) = rules.stage_egfr_estimate.get(&ckd_stage.to_string()) {
        return *v;
    }
    match ckd_stage {
        0 | 1 => 95.0,
        2 => 75.0,
        3 => 45.0,
        4 => 22.0,
        _ => 10.0,
    }
}

fn egfr_range_label(ckd_stage: u8) -> String {
    match ckd_stage {
        0 => "\u{2265}90 (assumed normal)".to_string(),
        1 => "\u{2265}90".to_string(),
        2 => "60\u{2013}89".to_string(),
        3 => "30\u{2013}59".to_string(),
        4 => "15\u{2013}29".to_string(),
        _ => "<15".to_string(),
    }
}

/// Pure, testable core: apply the ruleset to a drug list + CKD stage.
fn assess(drugs: &[Drug], ckd_stage: u8) -> Result<RenalAssessment> {
    let rules: RenalRuleSet = serde_json::from_str(RENAL_DATA)?;
    let egfr = estimate_egfr(ckd_stage, &rules);

    let mut flagged: Vec<RenalDrugAdjustment> = Vec::new();
    let mut ok: Vec<String> = Vec::new();

    for d in drugs {
        let dn = normalize(&d.name);
        let rule = rules.drugs.iter().find(|r| {
            normalize(&r.name) == dn || r.aliases.iter().any(|a| normalize(a) == dn)
        });
        match rule {
            Some(r) if egfr < r.apply_at_egfr_below => {
                flagged.push(RenalDrugAdjustment {
                    drug: d.name.clone(),
                    renal_handling: r.renal_handling.clone(),
                    action: r.action.clone(),
                    recommendation: r.recommendation.clone(),
                    egfr_threshold: Some(r.apply_at_egfr_below),
                });
            }
            _ => ok.push(d.name.clone()),
        }
    }

    let summary = if flagged.is_empty() {
        format!(
            "No drugs in the reference set require renal dose adjustment at an estimated eGFR of ~{:.0} mL/min/1.73m\u{00B2} (CKD stage {}).",
            egfr, ckd_stage
        )
    } else {
        let names: Vec<String> = flagged.iter().map(|f| f.drug.clone()).collect();
        format!(
            "{} medication(s) warrant renal review at an estimated eGFR of ~{:.0} mL/min/1.73m\u{00B2} (CKD stage {}): {}.",
            flagged.len(),
            egfr,
            ckd_stage,
            names.join(", ")
        )
    };

    Ok(RenalAssessment {
        ckd_stage,
        estimated_egfr_range: egfr_range_label(ckd_stage),
        flagged,
        ok,
        summary,
        disclaimer: rules.disclaimer.clone(),
    })
}

/// Tool entrypoint. `_gemini` is accepted to match the dispatcher signature
/// but is intentionally unused — this assessment is deterministic.
pub async fn assess_renal_dosing(
    drugs: &[Drug],
    patient: &PatientContext,
    _gemini: &GeminiClient,
) -> Result<RenalAssessment> {
    assess(drugs, patient.ckd_stage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_parses_and_has_rules() {
        let rs: RenalRuleSet =
            serde_json::from_str(RENAL_DATA).expect("renal_dosing.json must parse");
        assert!(!rs.drugs.is_empty());
        assert!(!rs.disclaimer.is_empty());
    }

    #[test]
    fn egfr_estimate_by_stage() {
        let rs: RenalRuleSet = serde_json::from_str(RENAL_DATA).unwrap();
        let e3 = estimate_egfr(3, &rs);
        assert!(e3 > 30.0 && e3 < 60.0, "CKD3 eGFR estimate out of band: {e3}");
        assert!(estimate_egfr(5, &rs) < 15.0);
        assert!(estimate_egfr(0, &rs) >= 90.0);
    }

    #[test]
    fn digoxin_rule_present_and_reduce() {
        let rs: RenalRuleSet = serde_json::from_str(RENAL_DATA).unwrap();
        let dig = rs
            .drugs
            .iter()
            .find(|r| normalize(&r.name) == "digoxin")
            .expect("digoxin rule present");
        assert_eq!(dig.action, "reduce");
        assert!(dig.apply_at_egfr_below >= 45.0);
    }
}
