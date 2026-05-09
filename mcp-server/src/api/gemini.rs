use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;

/// Auth mode for the Gemini client.
///
/// `VertexAi` is the production mode — auth is handled via GCP IAM
/// (metadata server on Cloud Run, or `gcloud` CLI fallback for local dev).
///
/// `AiStudio` is the lightweight mode used for hackathon / external
/// platform integration (e.g. Prompt Opinion's "Start Free" onboarding,
/// which expects a Google AI Studio API key). It hits a different
/// endpoint and uses URL-parameter auth instead of a bearer token, but
/// the request/response JSON shape is identical, so the rest of the
/// codebase doesn't need to know which mode is active.
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
    /// Read the active mode from env vars. Defaults to `vertex_ai`.
    /// Fails with a clear message if the chosen mode's required vars
    /// are missing — that's better than a confusing 401 at first call.
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

/// Thinking-budget tier for a single Gemini call.
///
/// Gemini 2.5 Pro defaults to "dynamic" thinking, which can burn 500–2000+
/// tokens reasoning silently before producing output, adding 15–30s of
/// latency per call. For most ARIA tools — which already pass an explicit
/// JSON schema in their system prompt — thinking adds very little quality
/// but a lot of wall-clock time.
///
/// Tier guidance:
///   - `Off`      → structural / computational tools
///                  (interaction_graph, score_risk, burden_scores, check_interactions)
///   - `Light`    → tools that benefit from a small reasoning budget
///                  (temporal_cascade, suggest_alternatives)
///   - `Standard` → clinical reasoning tools where Pro thinking earns its keep
///                  (explain_mechanism, deprescribing_plan, generate_report)
///
/// If `Off` (budget = 0) ever returns a 400 from Vertex AI complaining about
/// the minimum thinking budget for `gemini-2.5-pro`, change `Off` to 128
/// — that is the documented floor for Pro and still cuts ~90% of the
/// thinking latency vs. the dynamic default.
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
            ThinkingMode::Light => 256,
            ThinkingMode::Standard => 1024,
        }
    }
}

/// Client for Gemini 2.5 Pro via Vertex AI or Google AI Studio.
#[derive(Clone)]
pub struct GeminiClient {
    http: Client,
    mode: LlmMode,
    model: String,
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
    /// Construct a client by reading env vars (`LLM_MODE` decides the
    /// auth path; `GEMINI_MODEL` overrides the default model).
    pub fn from_env() -> Result<Self> {
        let mode = LlmMode::from_env()?;
        let model = env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-pro".to_string());
        Ok(Self {
            http: Client::new(),
            mode,
            model,
        })
    }

    /// Construct a Vertex AI client explicitly. Kept for backwards
    /// compatibility with call sites that already pass project/location/model.
    /// New code should prefer `from_env()`.
    #[allow(dead_code)]
    pub fn new(project_id: String, location: String, model: String) -> Self {
        Self {
            http: Client::new(),
            mode: LlmMode::VertexAi { project_id, location },
            model,
        }
    }

    /// Construct an AI Studio client explicitly. Useful for tests and for
    /// callers that already have an API key in hand without going through env.
    #[allow(dead_code)]
    pub fn new_ai_studio(api_key: String, model: String) -> Self {
        Self {
            http: Client::new(),
            mode: LlmMode::AiStudio { api_key },
            model,
        }
    }

    /// Get an access token from the GCP metadata server (Cloud Run) or
    /// fall back to `gcloud auth print-access-token` for local dev.
    ///
    /// Only called in `VertexAi` mode; AI Studio uses URL-parameter auth
    /// and never reaches this function.
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

        // Fallback: gcloud CLI for local development.
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

    /// Build the (url, optional bearer-auth header) tuple for the active
    /// mode. AI Studio embeds the API key in the URL; Vertex AI uses an
    /// Authorization header.
    async fn build_endpoint(&self) -> Result<(String, Option<String>)> {
        match &self.mode {
            LlmMode::VertexAi { project_id, location } => {
                let url = format!(
                    "https://{loc}-aiplatform.googleapis.com/v1/projects/{proj}/locations/{loc}/publishers/google/models/{model}:generateContent",
                    loc = location,
                    proj = project_id,
                    model = self.model,
                );
                let token = self.get_access_token().await?;
                Ok((url, Some(token)))
            }
            LlmMode::AiStudio { api_key } => {
                let url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                    model = self.model,
                    key = api_key,
                );
                Ok((url, None))
            }
        }
    }

    /// Internal: send the request body to whichever endpoint matches
    /// the active mode and parse the text out. Both endpoints return
    /// the same `candidates[0].content.parts[0].text` shape.
    async fn send(&self, request: &GeminiRequest) -> Result<String> {
        let (url, bearer) = self.build_endpoint().await?;

        let mut req = self.http.post(&url).json(request);
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }

        let resp = req.send().await.context("Gemini API request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Gemini API error {}: {}", status, body);
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

        Ok(text)
    }

    /// Send a JSON-mode prompt to Gemini.
    ///
    /// Thinking budget defaults to **Off** (0 tokens) — every existing
    /// call site (`check_interactions`, `score_risk`, etc.) automatically
    /// benefits from removed thinking latency without any change to the
    /// tool file. If a particular tool needs deeper clinical reasoning,
    /// switch its call to `generate_with_mode(.., ThinkingMode::Standard)`.
    pub async fn generate(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.generate_with_mode(system_prompt, user_prompt, ThinkingMode::Off)
            .await
    }

    /// JSON-mode prompt with explicit thinking-budget control.
    ///
    /// Use this in tools that need clinical reasoning depth — see the
    /// `ThinkingMode` doc-comment for the recommended tier per tool.
    pub async fn generate_with_mode(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        mode: ThinkingMode,
    ) -> Result<String> {
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
        self.send(&request).await
    }

    /// Send a free-form text prompt (not JSON). Thinking budget defaults to **Off**.
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
        self.send(&request).await
    }
}