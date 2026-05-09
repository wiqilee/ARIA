# ARIA Local Development Setup Guide

This guide walks you through setting up ARIA for local development. All three services (MCP Server, A2A Agent, Frontend) can run together with Docker Compose, or individually for active development on a single layer.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start with Docker Compose](#quick-start-with-docker-compose)
- [Running Services Individually](#running-services-individually)
- [GCP Authentication for Local Development](#gcp-authentication-for-local-development)
- [OpenFDA API Key](#openfda-api-key)
- [Verifying the Setup](#verifying-the-setup)
- [Troubleshooting](#troubleshooting)

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker and Docker Compose | 24+ | Container orchestration |
| Rust | 1.75+ | MCP Server development |
| Python | 3.12+ | A2A Agent development |
| Node.js | 20+ | Frontend development |
| gcloud CLI | Latest | GCP authentication for Vertex AI |

## Quick Start with Docker Compose

```bash
git clone https://github.com/wiqilee/ARIA
cd ARIA

# Copy environment files
cp .env.example .env
cp mcp-server/.env.example mcp-server/.env
cp agent/.env.example agent/.env
cp frontend/.env.example frontend/.env.local

# Edit .env with your actual values
# At minimum you need: GCP_PROJECT_ID, OPENFDA_API_KEY

# Authenticate with GCP (required for Vertex AI / Gemini)
gcloud auth application-default login

# Start all services
docker-compose up
```

Services will be available at:

- **MCP Server:** http://localhost:8080
- **A2A Agent:** http://localhost:8000
- **Frontend:** http://localhost:3000

## Running Services Individually

### MCP Server (Rust)

```bash
cd mcp-server
cp .env.example .env
# Edit .env with your values

cargo build --release
cargo run
```

The MCP server starts on port 8080 and exposes the MCP protocol over HTTP.

### A2A Agent (Python)

```bash
cd agent
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install -r requirements.txt
python src/main.py
```

The agent starts on port 8000 and provides both the `/a2a/v1` JSON-RPC endpoint and the `/analyze` REST endpoint.

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

The frontend starts on port 3000 with hot reload.

## GCP Authentication for Local Development

ARIA uses Gemini 2.5 Pro via Vertex AI. No API key is needed. Authentication is handled through GCP Application Default Credentials (ADC).

```bash
# Login to GCP
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_PROJECT_ID

# Verify Vertex AI is enabled
gcloud services list --enabled | grep aiplatform
```

If Vertex AI is not enabled:

```bash
gcloud services enable aiplatform.googleapis.com
```

Your local user account also needs the `roles/aiplatform.user` IAM role on the project to call Gemini 2.5 Pro:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="user:YOUR_EMAIL@example.com" \
  --role="roles/aiplatform.user"
```

## OpenFDA API Key

Get a free API key at [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication/). Add it to your `.env` file as `OPENFDA_API_KEY`.

The system works without an API key. Per the [OpenFDA documentation](https://open.fda.gov/apis/authentication/), the rate limits are:

| Auth | Per-minute limit | Per-day limit |
|---|---|---|
| No API key | 240 requests per minute, per IP address | 1,000 requests per day, per IP address |
| With API key | 240 requests per minute, per key | 120,000 requests per day, per key |

The per-minute rate is the same. The benefit of registering for a free key is the much higher daily cap, which matters when you are iterating on the MCP server during development.

## Verifying the Setup

### Health Check

```bash
# MCP Server
curl http://localhost:8080/health

# A2A Agent
curl http://localhost:8000/health
```

Both should return `200 OK` with a JSON body.

### Test Analysis

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "medications": ["warfarin", "aspirin", "omeprazole"],
    "patient": {
      "age": 72,
      "sex": "female",
      "weight_kg": 65,
      "ckd_stage": 3,
      "hepatic_impairment": false,
      "smoking": false
    }
  }'
```

You should receive a structured clinical report within roughly 10 seconds, depending on Gemini latency.

### Test the A2A Path

To exercise the A2A v1.0 JSON-RPC endpoint locally:

```bash
curl -s -X POST http://localhost:8000/a2a/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "demo-1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "messageId": "m1",
        "kind": "message",
        "parts": [{"kind": "text", "text": "{\"medications\":[\"warfarin\",\"aspirin\"],\"patient\":{\"age\":78,\"sex\":\"male\",\"ckd_stage\":3}}"}]
      }
    }
  }'
```

Expected response: a JSON-RPC envelope with `"status": {"state": "completed"}` and an `aria-analysis` artifact.

## Troubleshooting

**Port already in use.** Change the port in the service's `.env` file or stop the conflicting process. On macOS, `lsof -i :8080` will tell you what is holding the port.

**Vertex AI permission denied.** Make sure your GCP account has the `roles/aiplatform.user` IAM role and that the Vertex AI API is enabled. Run `gcloud auth application-default login` again if your ADC token has expired.

**Docker build fails for Rust.** The Rust build is memory-hungry. Allocate at least 4 GB to Docker, or build the MCP server outside Docker with `cargo build --release` and skip the container for local dev.

**Frontend can't reach the agent.** Check `NEXT_PUBLIC_AGENT_URL` in `frontend/.env.local`. For local development against the local agent, it should be `http://localhost:8000`.

**FHIR call fails with `401`.** When testing against the public HAPI sandbox, no `Authorization` header is needed. If you set a stale bearer token in `FHIR_BEARER_TOKEN`, unset it. See [`docs/sharp-integration.md`](sharp-integration.md) for the full FHIR context propagation rules.

**Gemini calls return `429 Resource exhausted`.** Vertex AI applies per-project quotas on Gemini 2.5 Pro. Either reduce concurrency in the agent (`AGENT_MAX_CONCURRENCY` env var) or request a quota bump in the GCP console under IAM and Admin > Quotas.