mod api;
mod llm;
mod models;
mod tools;

use std::sync::Arc;

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;

use api::{DrugBankClient, GeminiClient, OpenFdaClient, PubMedClient, RxNormClient};
use tools::{dispatch_tool, list_tools};

// ── Shared Application State ───────────────────────────────

#[derive(Clone)]
struct AppState {
    rxnorm: RxNormClient,
    openfda: OpenFdaClient,
    pubmed: PubMedClient,
    drugbank: DrugBankClient,
    gemini: GeminiClient,
}

// ── MCP Protocol Types ─────────────────────────────────────

/// JSON-RPC 2.0 request envelope used by MCP.
///
/// The `jsonrpc` field is present for protocol compliance (clients send
/// `"jsonrpc": "2.0"`), but we don't currently validate or read it after
/// deserialization — Serde just consumes it from the wire.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// JSON-RPC 2.0 response envelope.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

impl JsonRpcResponse {
    fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(JsonRpcError { code, message }),
        }
    }
}

// ── Health Check ───────────────────────────────────────────

async fn health_check() -> Json<Value> {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "aria-mcp-server",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

// ── MCP Protocol Handler ───────────────────────────────────

async fn handle_mcp(
    State(state): State<Arc<AppState>>,
    Json(request): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    let id = request.id.unwrap_or(Value::Null);

    info!(method = %request.method, "MCP request received");

    let response = match request.method.as_str() {
        // ── MCP Initialize ─────────────────────────────────
        "initialize" => JsonRpcResponse::success(
            id,
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {
                        "listChanged": false
                    }
                },
                "serverInfo": {
                    "name": "aria-mcp-server",
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }),
        ),

        // ── MCP List Tools ─────────────────────────────────
        "tools/list" => {
            let tool_defs = list_tools();
            let tools_json: Vec<Value> = tool_defs
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                    })
                })
                .collect();

            JsonRpcResponse::success(
                id,
                serde_json::json!({ "tools": tools_json }),
            )
        }

        // ── MCP Call Tool ──────────────────────────────────
        "tools/call" => {
            let tool_name = request
                .params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("");

            let arguments = request
                .params
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));

            info!(tool = %tool_name, "Dispatching tool call");

            match dispatch_tool(
                tool_name,
                &arguments,
                &state.rxnorm,
                &state.openfda,
                &state.pubmed,
                &state.drugbank,
                &state.gemini,
            )
            .await
            {
                Ok(result) => JsonRpcResponse::success(
                    id,
                    serde_json::json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
                        }],
                        "isError": false
                    }),
                ),
                Err(e) => {
                    tracing::error!(error = %e, tool = %tool_name, "Tool execution failed");
                    JsonRpcResponse::success(
                        id,
                        serde_json::json!({
                            "content": [{
                                "type": "text",
                                "text": format!("Error: {}", e)
                            }],
                            "isError": true
                        }),
                    )
                }
            }
        }

        // ── MCP Ping ───────────────────────────────────────
        "ping" => JsonRpcResponse::success(id, serde_json::json!({})),

        // ── Notifications (no response needed) ─────────────
        "notifications/initialized" | "notifications/cancelled" => {
            JsonRpcResponse::success(id, serde_json::json!({}))
        }

        // ── Unknown Method ─────────────────────────────────
        _ => JsonRpcResponse::error(
            id,
            -32601,
            format!("Method not found: {}", request.method),
        ),
    };

    Json(response)
}

// ── Main ───────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present (local development)
    let _ = dotenvy::dotenv();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    // Read configuration from environment.
    // Vertex AI / AI Studio mode is selected automatically inside
    // GeminiClient::from_env() via the LLM_MODE env var. The project_id
    // and location below are read here purely for the startup log line —
    // the client itself reads them from env.
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()?;
    let project_id =
        std::env::var("GOOGLE_CLOUD_PROJECT").unwrap_or_else(|_| "local-dev".to_string());
    let location =
        std::env::var("VERTEXAI_LOCATION").unwrap_or_else(|_| "asia-southeast2".to_string());
    let model =
        std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-pro".to_string());
    let llm_mode = std::env::var("LLM_MODE").unwrap_or_else(|_| "vertex_ai".to_string());
    let openfda_key = std::env::var("OPENFDA_API_KEY").ok();

    // Initialize API clients.
    // GeminiClient::from_env() picks Vertex AI vs AI Studio based on
    // LLM_MODE. Fails fast with a clear error if required vars are missing.
    let state = Arc::new(AppState {
        rxnorm: RxNormClient::new(),
        openfda: OpenFdaClient::new(openfda_key),
        pubmed: PubMedClient::new(),
        drugbank: DrugBankClient::new(),
        gemini: GeminiClient::from_env()?,
    });

    // CORS configuration — allow all origins for development and Prompt Opinion
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build router
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/mcp", post(handle_mcp))
        // Also support root POST for simpler integrations
        .route("/", post(handle_mcp))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", host, port);
    info!(
        address = %addr,
        llm_mode = %llm_mode,
        project = %project_id,
        region = %location,
        model = %model,
        "ARIA MCP Server starting"
    );

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_tools_returns_nine_tools() {
        let tools = list_tools();
        assert_eq!(tools.len(), 9, "ARIA should expose exactly 9 MCP tools");
    }

    #[test]
    fn test_tool_names() {
        let tools = list_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"check_interactions"));
        assert!(names.contains(&"explain_mechanism"));
        assert!(names.contains(&"score_risk"));
        assert!(names.contains(&"suggest_alternatives"));
        assert!(names.contains(&"build_interaction_graph"));
        assert!(names.contains(&"compute_burden_scores"));
        assert!(names.contains(&"model_temporal_cascade"));
        assert!(names.contains(&"generate_deprescribing_plan"));
        assert!(names.contains(&"generate_report"));
    }

    #[test]
    fn test_json_rpc_response_success() {
        let resp = JsonRpcResponse::success(
            Value::Number(1.into()),
            serde_json::json!({"status": "ok"}),
        );
        assert!(resp.error.is_none());
        assert!(resp.result.is_some());
        assert_eq!(resp.jsonrpc, "2.0");
    }

    #[test]
    fn test_json_rpc_response_error() {
        let resp = JsonRpcResponse::error(
            Value::Number(1.into()),
            -32601,
            "Method not found".to_string(),
        );
        assert!(resp.result.is_none());
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, -32601);
    }

    #[test]
    fn test_drug_model_deserialize() {
        let json = r#"{"name": "warfarin", "rxcui": "11289", "dose": "5mg"}"#;
        let drug: models::Drug = serde_json::from_str(json).unwrap();
        assert_eq!(drug.name, "warfarin");
        assert_eq!(drug.rxcui, Some("11289".to_string()));
        assert_eq!(drug.dose, Some("5mg".to_string()));
    }

    #[test]
    fn test_drug_model_minimal() {
        let json = r#"{"name": "aspirin"}"#;
        let drug: models::Drug = serde_json::from_str(json).unwrap();
        assert_eq!(drug.name, "aspirin");
        assert!(drug.rxcui.is_none());
    }

    #[test]
    fn test_patient_context_defaults() {
        let json = r#"{}"#;
        let ctx: models::PatientContext = serde_json::from_str(json).unwrap();
        assert_eq!(ctx.age, 50);
        assert_eq!(ctx.sex, "unknown");
        assert_eq!(ctx.ckd_stage, 0);
        assert!(!ctx.hepatic_impairment);
    }

    #[test]
    fn test_severity_ordering() {
        use models::Severity;
        assert!(Severity::Low < Severity::Moderate);
        assert!(Severity::Moderate < Severity::High);
        assert!(Severity::High < Severity::Critical);
    }

    #[test]
    fn test_drugbank_cyp_overlap() {
        let db = DrugBankClient::new();
        let overlap = db.check_cyp_overlap("warfarin", "fluconazole");
        assert!(!overlap.is_empty(), "Warfarin and fluconazole share CYP2C9");
        assert!(overlap.contains(&"CYP2C9".to_string()));
    }

    #[test]
    fn test_drugbank_no_overlap() {
        let db = DrugBankClient::new();
        let overlap = db.check_cyp_overlap("metformin", "lisinopril");
        assert!(overlap.is_empty(), "Metformin and lisinopril have no CYP overlap");
    }

    #[tokio::test]
    async fn test_drugbank_pharmacology() {
        let db = DrugBankClient::new();
        let pharm = db.get_pharmacology("warfarin").await.unwrap();
        assert!(pharm.is_some());
        let p = pharm.unwrap();
        assert_eq!(p.drugbank_id, Some("DB00682".to_string()));
        assert!(!p.cyp_enzymes.is_empty());
    }
}
