use anyhow::Result;
use tracing::warn;

use crate::api::{DrugBankClient, GeminiClient};
use crate::llm::BURDEN_SYSTEM_PROMPT;
use crate::models::{BurdenScores, Drug};

/// Calculate anticholinergic burden, sedation load, and QT prolongation risk.
pub async fn compute_burden_scores(
    drugs: &[Drug],
    drugbank: &DrugBankClient,
    gemini: &GeminiClient,
) -> Result<BurdenScores> {
    // Gather pharmacology data for burden assessment
    let mut pharmacology = Vec::new();
    for drug in drugs {
        let pharm = drugbank.get_pharmacology(&drug.name).await?;
        pharmacology.push(serde_json::json!({
            "name": drug.name,
            "dose": drug.dose,
            "frequency": drug.frequency,
            "pharmacology": pharm,
        }));
    }

    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "total_drugs": drugs.len(),
        "pharmacology_data": pharmacology,
    })
    .to_string();

    let response = gemini.generate(BURDEN_SYSTEM_PROMPT, &user_prompt).await?;

    // Robustly extract JSON from the LLM response. Gemini frequently wraps
    // its JSON output in a markdown code fence (```json ... ```) or prefixes
    // it with a sentence like "Here is the burden analysis:". The original
    // implementation called `serde_json::from_str(&response)` directly and,
    // on any parse failure, silently substituted zeros for every score —
    // producing the all-0.0 cards the frontend has been showing.
    //
    // We now:
    //   1. Strip the markdown fence if present.
    //   2. Fall back to slicing from the first `{` to the last `}` if step 1
    //      doesn't leave us with valid JSON.
    //   3. Log a warning with the raw response when parsing still fails, so
    //      operators can see *why* the burden card came back empty instead of
    //      pretending everything was "low".
    let parsed: Option<serde_json::Value> = parse_llm_json(&response);

    if parsed.is_none() {
        warn!(
            target: "burden_scores",
            raw_response = %truncate_for_log(&response, 1_200),
            drug_count = drugs.len(),
            "Gemini burden_scores response did not parse as JSON; returning fallback. \
             First 1.2kB of response logged above for diagnosis."
        );
    }

    // From here we always have *something* to read from. Use the parsed
    // value when present, otherwise an empty object so the field-level
    // fallbacks below fire and produce "unknown"-tagged buckets (which the
    // frontend can detect, rather than the misleading "low" tag the old
    // outer fallback produced on a parse miss).
    let parsed = parsed.unwrap_or_else(|| serde_json::json!({}));

    Ok(BurdenScores {
        anticholinergic_burden: extract_bucket(&parsed, "anticholinergic_burden"),
        sedation_load: extract_bucket(&parsed, "sedation_load"),
        qt_prolongation_risk: extract_bucket(&parsed, "qt_prolongation_risk"),
        total_burden_summary: parsed
            .get("total_burden_summary")
            .and_then(|s| s.as_str())
            .unwrap_or(
                "Burden scores were not computed: the LLM response could not be parsed. \
                 Check server logs for the raw response.",
            )
            .to_string(),
    })
}

/// Pull a single burden bucket (anticholinergic_burden / sedation_load /
/// qt_prolongation_risk) out of the parsed root, with a clearly-labelled
/// fallback so the UI can tell the difference between "we computed this
/// and it really is low" vs "we tried to compute and failed".
fn extract_bucket(root: &serde_json::Value, key: &str) -> crate::models::BurdenDetail {
    root.get(key)
        .and_then(|b| serde_json::from_value(b.clone()).ok())
        .unwrap_or_else(|| crate::models::BurdenDetail {
            total_score: 0.0,
            // "unknown" — not "low" — so a downstream consumer that cares
            // about the difference can tell. The old code mixed these two
            // states, which is why all-zero cards looked indistinguishable
            // from genuinely-low regimens.
            risk_level: "unknown".to_string(),
            per_drug: vec![],
            clinical_implication: format!(
                "Unable to compute {} (parser fallback fired)",
                key.replace('_', " ")
            ),
        })
}

/// Best-effort JSON extraction from an LLM completion.
///
/// Returns `Some(value)` if we can pull a JSON object out of the response,
/// `None` if every attempt fails. Caller is responsible for logging the
/// raw response on `None` so we don't lose diagnostic information.
fn parse_llm_json(raw: &str) -> Option<serde_json::Value> {
    let trimmed = raw.trim();

    // First try: response is already pure JSON (the happy path).
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(v);
    }

    // Second try: strip a markdown code fence. Gemini almost always emits
    // ```json … ``` or ``` … ``` around its JSON payloads.
    if let Some(stripped) = strip_code_fence(trimmed) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(stripped.trim()) {
            return Some(v);
        }
    }

    // Last resort: slice from the first `{` to the matching last `}` and
    // try again. Handles cases like "Here is the analysis: { ... }" or a
    // trailing sentence after the JSON.
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            let candidate = &trimmed[start..=end];
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(candidate) {
                return Some(v);
            }
        }
    }

    None
}

/// If `s` starts with a triple-backtick code fence, return the contents
/// between the opening and closing fences. Tolerates an optional language
/// tag (e.g. ```json) on the opening fence.
fn strip_code_fence(s: &str) -> Option<&str> {
    let s = s.trim_start();
    let rest = s.strip_prefix("```")?;
    // Skip an optional language tag like "json" up to the first newline.
    let after_lang = match rest.find('\n') {
        Some(i) => &rest[i + 1..],
        None => rest,
    };
    // Find the closing fence.
    let end = after_lang.rfind("```")?;
    Some(&after_lang[..end])
}

/// Truncate a string for logging so a 50kB Gemini hallucination doesn't
/// blow up the log file.
fn truncate_for_log(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s[..max].to_string();
        out.push_str(&format!("... [truncated, {} more chars]", s.len() - max));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_fence_json_tag() {
        let input = "```json\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(input).unwrap().trim(), "{\"a\":1}");
    }

    #[test]
    fn strip_fence_no_tag() {
        let input = "```\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(input).unwrap().trim(), "{\"a\":1}");
    }

    #[test]
    fn parse_plain_json() {
        let v = parse_llm_json("{\"a\":1}").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parse_fenced_json() {
        let v = parse_llm_json("```json\n{\"a\":1}\n```").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parse_prefixed_json() {
        let v = parse_llm_json("Here is the analysis: {\"a\":1} hope that helps").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parse_garbage_returns_none() {
        assert!(parse_llm_json("not json at all").is_none());
    }
}