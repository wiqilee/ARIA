use anyhow::Result;

use crate::api::GeminiClient;
use crate::llm::REPORT_SYSTEM_PROMPT;
use crate::models::{ClinicalReport, FullAnalysis};

/// Assemble all analysis results into a structured clinical report.
pub async fn generate_report(
    analysis: &FullAnalysis,
    gemini: &GeminiClient,
) -> Result<ClinicalReport> {
    let user_prompt = serde_json::json!({
        "medications": analysis.medications,
        "patient_context": analysis.patient_context,
        "interactions": analysis.interactions,
        "interaction_graph": analysis.graph,
        "risk_scores": analysis.risk_scores,
        "burden_scores": analysis.burden_scores,
        "temporal_model": analysis.temporal_model,
        "evidence": analysis.evidence,
    })
    .to_string();

    let response = gemini
        .generate_text(REPORT_SYSTEM_PROMPT, &user_prompt)
        .await?;

    // Try parsing as JSON first (Gemini may return JSON even with text mode)
    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        // If it's plain text, wrap it as report_text
        serde_json::json!({
            "patient_summary": "See full report below",
            "medication_count": analysis.medications.len(),
            "interaction_summary": "See full report below",
            "critical_findings": [],
            "overall_risk_level": "moderate",
            "report_text": response,
        })
    });

    // Extract risk scores from analysis for the report
    let risk_scores = analysis
        .risk_scores
        .iter()
        .filter_map(|rs| serde_json::from_value(rs.clone()).ok())
        .collect();

    let burden_scores = analysis
        .burden_scores
        .as_ref()
        .and_then(|b| serde_json::from_value(b.clone()).ok());

    let temporal_summary = analysis
        .temporal_model
        .as_ref()
        .and_then(|t| t.get("summary"))
        .and_then(|s| s.as_str())
        .map(String::from);

    let deprescribing_plan = None; // Attached separately by the agent

    let evidence_citations: Vec<String> = analysis
        .evidence
        .iter()
        .filter_map(|e| {
            e.get("pmid")
                .and_then(|p| p.as_str())
                .map(|pmid| format!("PMID: {}", pmid))
        })
        .collect();

    Ok(ClinicalReport {
        patient_summary: parsed
            .get("patient_summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Patient summary unavailable")
            .to_string(),
        medication_count: parsed
            .get("medication_count")
            .and_then(|m| m.as_u64())
            .unwrap_or(analysis.medications.len() as u64) as usize,
        interaction_summary: parsed
            .get("interaction_summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Interaction summary unavailable")
            .to_string(),
        critical_findings: parsed
            .get("critical_findings")
            .and_then(|c| serde_json::from_value(c.clone()).ok())
            .unwrap_or_default(),
        risk_scores,
        burden_scores,
        temporal_summary,
        deprescribing_plan,
        evidence_citations,
        overall_risk_level: parsed
            .get("overall_risk_level")
            .and_then(|o| o.as_str())
            .unwrap_or("moderate")
            .to_string(),
        report_text: parsed
            .get("report_text")
            .and_then(|r| r.as_str())
            .unwrap_or("Report generation failed. Please retry.")
            .to_string(),
    })
}
