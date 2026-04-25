# ARIA — Local Development Setup Guide

This guide walks you through setting up ARIA for local development. All three services (MCP Server, A2A Agent, Frontend) can run simultaneously using Docker Compose or individually.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker & Docker Compose | 24+ | Container orchestration |
| Rust | 1.75+ | MCP Server development |
| Python | 3.12+ | A2A Agent development |
| Node.js | 20+ | Frontend development |
| gcloud CLI | Latest | GCP authentication (for Vertex AI) |

---

## Quick Start (Docker Compose)

```bash
git clone https://github.com/wiqi-lee/ARIA
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
- **MCP Server**: http://localhost:8080
- **A2A Agent**: http://localhost:8000
- **Frontend**: http://localhost:3000

---

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

The agent starts on port 8000 and provides the `/analyze` endpoint.

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

The frontend starts on port 3000 with hot reload.

---

## GCP Authentication for Local Development

ARIA uses Gemini 2.5 Pro via Vertex AI. No API key is needed — authentication is handled through GCP Application Default Credentials (ADC).

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

---

## OpenFDA API Key

Get a free API key at [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication/). Add it to your `.env` file as `OPENFDA_API_KEY`.

The system works without an API key but is rate-limited to 40 requests per minute (vs. 240 with a key).

---

## Verifying the Setup

### Health Check

```bash
# MCP Server
curl http://localhost:8080/health

# Agent
curl http://localhost:8000/health
```

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

---

## Troubleshooting

**Port already in use**: Change the port in the service's `.env` file or stop the conflicting process.

**Vertex AI permission denied**: Ensure your GCP account has the `Vertex AI User` role and the API is enabled.

**Docker build fails for Rust**: The Rust build requires significant memory. Ensure Docker has at least 4GB allocated.

**Frontend can't reach agent**: Check `NEXT_PUBLIC_AGENT_URL` in `frontend/.env.local` points to the correct agent URL.
