use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;

#[derive(Clone, Debug)]
pub enum LlmMode {
    VertexAi {
        project_id: String,
        location: String,
    },
    AiStudio {
        api_key: String,
    },
}

impl LlmMode {
    pub fn from_env() -> Result<Self> {
        let mode = env::var("LLM_MODE").unwrap_or_else(|_| "vertex_ai".to_string());
        match mode.as_str() {
            "vertex_ai" => {
                let project_id = env::var("GOOGLE_CLOUD_PROJECT")
                    .context("LLM_MODE=vertex_ai but GOOGLE_CLOUD_PROJECT is unset")?;
                let location = env::var("VERTEXAI_LOCATION")
                    .unwrap_or_else(|_| "asia-southeast2".to_string());
                Ok(LlmMode::VertexAi { project_id, location })
            }
            "ai_studio" => {
                let api_key = env::var("GOOGLE_AI_STUDIO_API_KEY")
                    .context("LLM_MODE=ai_studio but GOOGLE_AI_STUDIO_API_KEY is unset")?;
                if api_key.trim().is_empty() {
                    anyhow::bail!("GOOGLE_AI_STUDIO_API_KEY is empty");
                }
                Ok(LlmMode::AiStudio { api_key })
            }
            other => {
                anyhow::bail!(
                    "Unknown LLM_MODE: {} (expected 'vertex_ai' or 'ai_studio')",
                    other
                )
            }
        }
    }
}

/// Thinking-budget tier for a single Gemini call. Each tier also picks the
/// underlying model — Fast tiers run on `gemini-2.5-flash`, the Standard tier
/// keeps the full `gemini-2.5-pro` reasoning stack.
///
/// Calibrated empirically against Po's ~50s blocking budget on
/// SendA2AMessage. With all tools on Pro the 4-drug pipeline runs ~80–110s
/// and Po rejects the "working" task with "did not respond with a task".
/// Splitting structural/computational tools to Flash brings the same case
/// to ~45–55s so Po sees a state="completed" task in the same response.
///
/// Tier guidance:
///   - `Off`      → structural / computational tools (default)
///                  Flash + thinking_budget=0. ~2–3s/call.
///                  Used by: interaction_graph, score_risk, burden_scores,
///                  check_interactions, temporal_cascade.
///   - `Light`    → tools that benefit from a small reasoning budget but
///                  not full Pro. Flash + thinking_budget=512. ~3–5s/call.
///                  Reserved for future use.
///   - `Standard` → clinical reasoning tools where Pro thinking earns
///                  its keep. Pro + thinking_budget=1024. ~6–10s/call.
///                  Used by: explain_mechanism, deprescribing_plan,
///                  generate_report.
#[derive(Debug, Clone, Copy)]
pub enum ThinkingMode {
    Off,
    Light,
    Standard,
}

impl ThinkingMode {
    fn budget(self) -> i32 {
        match self {
            ThinkingMode::Off => 0,
            ThinkingMode::Light => 512,
            ThinkingMode::Standard => 1024,
        }
    }
}

/// Client for Gemini 2.5 (Pro for clinical reasoning, Flash for the rest)
/// via Vertex AI or Google AI Studio.
#[derive(Clone)]
pub struct GeminiClient {
    http: Client,
    mode: LlmMode,
    /// Default Pro model used by `ThinkingMode::Standard` and the legacy
    /// `generate_text` path. Override via `GEMINI_MODEL` env.
    model: String,
    /// Faster Flash model used by `ThinkingMode::Off` and `Light`. Override
    /// via `GEMINI_MODEL_FAST` env.
    fast_model: String,
}

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<Content>,
    #[serde(rename = "generationConfig")]
    generation_config: GenerationConfig,
}

#[derive(Debug, Serialize)]
struct Content {
    role: String,
    parts: Vec<Part>,
}

#[derive(Debug, Serialize)]
struct Part {
    text: String,
}

#[derive(Debug, Serialize)]
struct GenerationConfig {
    temperature: f64,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
    #[serde(rename = "responseMimeType")]
    response_mime_type: String,
    #[serde(rename = "thinkingConfig")]
    thinking_config: ThinkingConfig,
}

#[derive(Debug, Serialize)]
struct ThinkingConfig {
    #[serde(rename = "thinkingBudget")]
    thinking_budget: i32,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<CandidateContent>,
}

#[derive(Debug, Deserialize)]
struct CandidateContent {
    parts: Option<Vec<CandidatePart>>,
}

#[derive(Debug, Deserialize)]
struct CandidatePart {
    text: Option<String>,
}

impl GeminiClient {
    pub fn from_env() -> Result<Self> {
        let mode = LlmMode::from_env()?;
        let model = env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-pro".to_string());
        let fast_model =
            env::var("GEMINI_MODEL_FAST").unwrap_or_else(|_| "gemini-2.5-flash".to_string());
        Ok(Self {
            http: Client::new(),
            mode,
            model,
            fast_model,
        })
    }

    #[allow(dead_code)]
    pub fn new(project_id: String, location: String, model: String) -> Self {
        Self {
            http: Client::new(),
            mode: LlmMode::VertexAi { project_id, location },
            model,
            fast_model: "gemini-2.5-flash".to_string(),
        }
    }

    #[allow(dead_code)]
    pub fn new_ai_studio(api_key: String, model: String) -> Self {
        Self {
            http: Client::new(),
            mode: LlmMode::AiStudio { api_key },
            model,
            fast_model: "gemini-2.5-flash".to_string(),
        }
    }

    /// Pick the model name appropriate for the requested thinking tier.
    fn model_for(&self, mode: ThinkingMode) -> &str {
        match mode {
            ThinkingMode::Standard => &self.model,
            ThinkingMode::Off | ThinkingMode::Light => &self.fast_model,
        }
    }

    async fn get_access_token(&self) -> Result<String> {
        let metadata_url =
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

        let resp = self
            .http
            .get(metadata_url)
            .header("Metadata-Flavor", "Google")
            .send()
            .await;

        if let Ok(resp) = resp {
            if resp.status().is_success() {
                let data: serde_json::Value = resp.json().await?;
                if let Some(token) = data.get("access_token").and_then(|t| t.as_str()) {
                    return Ok(token.to_string());
                }
            }
        }

        let output = tokio::process::Command::new("gcloud")
            .args(["auth", "print-access-token"])
            .output()
            .await
            .context("Failed to get access token. Ensure gcloud CLI is installed or running on Cloud Run.")?;

        let token = String::from_utf8(output.stdout)
            .context("Invalid token output")?
            .trim()
            .to_string();

        if token.is_empty() {
            anyhow::bail!("Empty access token. Run 'gcloud auth application-default login'.");
        }

        Ok(token)
    }

    async fn build_endpoint(&self, model: &str) -> Result<(String, Option<String>)> {
        match &self.mode {
            LlmMode::VertexAi { project_id, location } => {
                let url = format!(
                    "https://{loc}-aiplatform.googleapis.com/v1/projects/{proj}/locations/{loc}/publishers/google/models/{model}:generateContent",
                    loc = location,
                    proj = project_id,
                    model = model,
                );
                let token = self.get_access_token().await?;
                Ok((url, Some(token)))
            }
            LlmMode::AiStudio { api_key } => {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                    model = model,
                    key = api_key,
                );
                Ok((url, None))
            }
        }
    }

    async fn send(&self, model: &str, request: &GeminiRequest) -> Result<String> {
        let (url, bearer) = self.build_endpoint(model).await?;

        let mut req = self.http.post(&url).json(request);
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }

        let resp = req.send().await.context("Gemini API request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Gemini API error {} ({}): {}", status, model, body);
        }

        let data: GeminiResponse =
            resp.json().await.context("Failed to parse Gemini response")?;

        let text = data
            .candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content)
            .and_then(|c| c.parts)
            .and_then(|p| p.into_iter().next())
            .and_then(|p| p.text)
            .unwrap_or_default();

        if text.trim().is_empty() {
            anyhow::bail!(
                "Gemini ({}) returned empty content. If on Pro, check that thinking_budget \
                 meets the model minimum (currently {} for active mode).",
                model,
                request.generation_config.thinking_config.thinking_budget,
            );
        }

        Ok(text)
    }

    /// JSON-mode prompt with the default thinking tier (Off → Flash, no thinking).
    /// Every existing tool that calls `gemini.generate(...)` ends up here, which
    /// keeps the 5 structural/computational tools (interaction_graph, score_risk,
    /// burden_scores, check_interactions, temporal_cascade) on the fast path.
    pub async fn generate(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.generate_with_mode(system_prompt, user_prompt, ThinkingMode::Off)
            .await
    }

    /// JSON-mode prompt with explicit thinking-budget control. Use
    /// `ThinkingMode::Standard` in clinical-reasoning tools (explain_mechanism,
    /// deprescribing_plan, generate_report) to keep them on Pro.
    pub async fn generate_with_mode(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        mode: ThinkingMode,
    ) -> Result<String> {
        let model = self.model_for(mode).to_string();
        let request = GeminiRequest {
            contents: vec![Content {
                role: "user".to_string(),
                parts: vec![Part {
                    text: format!("{}\n\n{}", system_prompt, user_prompt),
                }],
            }],
            generation_config: GenerationConfig {
                temperature: 0.2,
                max_output_tokens: 8192,
                response_mime_type: "application/json".to_string(),
                thinking_config: ThinkingConfig {
                    thinking_budget: mode.budget(),
                },
            },
        };
        self.send(&model, &request).await
    }

    /// Free-form text prompt (non-JSON), default Off tier (Flash, no thinking).
    pub async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.generate_text_with_mode(system_prompt, user_prompt, ThinkingMode::Off)
            .await
    }

    /// Free-form text prompt with explicit thinking-budget control.
    pub async fn generate_text_with_mode(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        mode: ThinkingMode,
    ) -> Result<String> {
        let model = self.model_for(mode).to_string();
        let request = GeminiRequest {
            contents: vec![Content {
                role: "user".to_string(),
                parts: vec![Part {
                    text: format!("{}\n\n{}", system_prompt, user_prompt),
                }],
            }],
            generation_config: GenerationConfig {
                temperature: 0.3,
                max_output_tokens: 8192,
                response_mime_type: "text/plain".to_string(),
                thinking_config: ThinkingConfig {
                    thinking_budget: mode.budget(),
                },
            },
        };
        self.send(&model, &request).await
    }
}