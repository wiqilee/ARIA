//! Geriatric prescribing-appropriateness screen — deterministic, rule-based.
//!
//! Like `renal_dosing`, this tool does NOT call Gemini. PIM/omission
//! screening against published criteria (AGS Beers, STOPP/START) is a
//! clinical-safety surface where a fixed, auditable ruleset is preferable
//! to generative variance: the same patient + medication list must always
//! produce the same flags, and each flag must cite a concrete criterion.
//!
//! The reference criteria live in `../data/beers_stopp.json` and are
//! embedded at compile time via `include_str!`, so there is no runtime
//! file-path or deployment dependency.
//!
//! Screening only applies at/above the framework age threshold (default 65,
//! the population these criteria target). Below that age the assessment is
//! returned with `screened = false` and no flags.

use anyhow::Result;
use serde::Deserialize;

use crate::api::GeminiClient;
use crate::models::{
    AppropriatenessAssessment, AppropriatenessFlag, Drug, PatientContext, PrescribingOmission,
};

const APPROPRIATENESS_DATA: &str = include_str!("../data/beers_stopp.json");

#[derive(Debug, Deserialize)]
struct CriteriaSet {
    #[serde(default = "default_age_threshold")]
    age_threshold: u32,
    #[serde(default)]
    beers: Vec<PimRule>,
    #[serde(default)]
    stopp: Vec<PimRule>,
    #[serde(default)]
    start: Vec<StartRule>,
    #[serde(default)]
    disclaimer: String,
}

fn default_age_threshold() -> u32 {
    65
}

#[derive(Debug, Deserialize, Clone)]
struct PimRule {
    drug: String,
    #[serde(default)]
    aliases: Vec<String>,
    criterion: String,
    #[serde(default)]
    rationale: String,
    #[serde(default)]
    recommendation: String,
}

#[derive(Debug, Deserialize, Clone)]
struct StartRule {
    omission: String,
    #[serde(default)]
    aliases: Vec<String>,
    criterion: String,
    #[serde(default)]
    trigger_comorbidities: Vec<String>,
    #[serde(default)]
    rationale: String,
    #[serde(default)]
    recommendation: String,
}

fn normalize(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Does the medication list contain this rule's drug (by name or alias)?
fn list_has(drug_names: &[String], rule_name: &str, aliases: &[String]) -> bool {
    let target = normalize(rule_name);
    drug_names.iter().any(|d| {
        let dn = normalize(d);
        // substring match both ways so "omeprazole 20mg" still matches
        // "omeprazole", and a class alias like "ppi" can match too.
        dn == target
            || dn.contains(&target)
            || target.contains(&dn)
            || aliases.iter().any(|a| {
                let an = normalize(a);
                dn == an || dn.contains(&an) || an.contains(&dn)
            })
    })
}

/// Pure, testable core: apply the criteria to a drug list + patient.
fn assess(drugs: &[Drug], age: u32, comorbidities: &[String]) -> Result<AppropriatenessAssessment> {
    let criteria: CriteriaSet = serde_json::from_str(APPROPRIATENESS_DATA)?;

    // Below the screening age, return an empty (not screened) assessment.
    if age < criteria.age_threshold {
        return Ok(AppropriatenessAssessment {
            age,
            screened: false,
            pim_flags: Vec::new(),
            omissions: Vec::new(),
            summary: format!(
                "Geriatric appropriateness screening (Beers / STOPP-START) applies from age {}; patient age {} — not screened.",
                criteria.age_threshold, age
            ),
            disclaimer: criteria.disclaimer.clone(),
        });
    }

    let drug_names: Vec<String> = drugs.iter().map(|d| d.name.clone()).collect();
    let comorbid_norm: Vec<String> = comorbidities.iter().map(|c| normalize(c)).collect();

    let mut pim_flags: Vec<AppropriatenessFlag> = Vec::new();

    // Beers PIMs present in the list.
    for rule in &criteria.beers {
        if list_has(&drug_names, &rule.drug, &rule.aliases) {
            pim_flags.push(AppropriatenessFlag {
                drug: rule.drug.clone(),
                framework: "beers".to_string(),
                criterion: rule.criterion.clone(),
                rationale: rule.rationale.clone(),
                recommendation: rule.recommendation.clone(),
            });
        }
    }

    // STOPP PIMs present in the list.
    for rule in &criteria.stopp {
        if list_has(&drug_names, &rule.drug, &rule.aliases) {
            pim_flags.push(AppropriatenessFlag {
                drug: rule.drug.clone(),
                framework: "stopp".to_string(),
                criterion: rule.criterion.clone(),
                rationale: rule.rationale.clone(),
                recommendation: rule.recommendation.clone(),
            });
        }
    }

    // START omissions: a triggering comorbidity is present AND the drug
    // (class) is NOT already in the medication list.
    let mut omissions: Vec<PrescribingOmission> = Vec::new();
    for rule in &criteria.start {
        let trigger = rule
            .trigger_comorbidities
            .iter()
            .find(|c| comorbid_norm.iter().any(|pc| pc.contains(&normalize(c))));
        if let Some(t) = trigger {
            let already_present = list_has(&drug_names, &rule.omission, &rule.aliases);
            if !already_present {
                omissions.push(PrescribingOmission {
                    omission: rule.omission.clone(),
                    criterion: rule.criterion.clone(),
                    triggered_by: t.clone(),
                    rationale: rule.rationale.clone(),
                    recommendation: rule.recommendation.clone(),
                });
            }
        }
    }

    let summary = build_summary(age, &pim_flags, &omissions);

    Ok(AppropriatenessAssessment {
        age,
        screened: true,
        pim_flags,
        omissions,
        summary,
        disclaimer: criteria.disclaimer.clone(),
    })
}

fn build_summary(
    age: u32,
    pim_flags: &[AppropriatenessFlag],
    omissions: &[PrescribingOmission],
) -> String {
    if pim_flags.is_empty() && omissions.is_empty() {
        return format!(
            "No potentially inappropriate medications or prescribing omissions detected for age {} against the Beers / STOPP-START reference set.",
            age
        );
    }
    let pim_names: Vec<String> = pim_flags.iter().map(|f| f.drug.clone()).collect();
    let omit_names: Vec<String> = omissions.iter().map(|o| o.omission.clone()).collect();
    let mut parts: Vec<String> = Vec::new();
    if !pim_names.is_empty() {
        parts.push(format!(
            "{} potentially inappropriate medication(s): {}",
            pim_names.len(),
            pim_names.join(", ")
        ));
    }
    if !omit_names.is_empty() {
        parts.push(format!(
            "{} potential prescribing omission(s): {}",
            omit_names.len(),
            omit_names.join(", ")
        ));
    }
    format!("Geriatric screen (age {}): {}.", age, parts.join("; "))
}

/// Tool entrypoint. `_gemini` is accepted to match the dispatcher signature
/// but is intentionally unused — this assessment is deterministic.
pub async fn screen_appropriateness(
    drugs: &[Drug],
    patient: &PatientContext,
    _gemini: &GeminiClient,
) -> Result<AppropriatenessAssessment> {
    assess(drugs, patient.age as u32, &patient.comorbidities)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drug(name: &str) -> Drug {
        Drug {
            name: name.to_string(),
            rxcui: None,
            dose: None,
            frequency: None,
            indication: None,
        }
    }

    #[test]
    fn data_parses_and_has_rules() {
        let cs: CriteriaSet =
            serde_json::from_str(APPROPRIATENESS_DATA).expect("beers_stopp.json must parse");
        assert!(!cs.beers.is_empty());
        assert!(!cs.start.is_empty());
        assert!(!cs.disclaimer.is_empty());
    }

    #[test]
    fn under_age_not_screened() {
        let a = assess(&[drug("diazepam")], 40, &[]).unwrap();
        assert!(!a.screened);
        assert!(a.pim_flags.is_empty());
    }

    #[test]
    fn diazepam_flagged_as_pim_over_65() {
        let a = assess(&[drug("diazepam")], 72, &[]).unwrap();
        assert!(a.screened);
        assert!(a.pim_flags.iter().any(|f| normalize(&f.drug) == "diazepam"));
    }

    #[test]
    fn statin_omission_with_cad_and_no_statin() {
        let a = assess(&[drug("aspirin")], 72, &["coronary artery disease".to_string()]).unwrap();
        assert!(a.omissions.iter().any(|o| normalize(&o.omission).contains("statin")));
    }

    #[test]
    fn no_statin_omission_when_already_prescribed() {
        let a = assess(
            &[drug("atorvastatin")],
            72,
            &["coronary artery disease".to_string()],
        )
        .unwrap();
        assert!(!a.omissions.iter().any(|o| normalize(&o.omission).contains("statin")));
    }
}
