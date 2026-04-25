#!/usr/bin/env bash
# ============================================================
# ARIA — Deployment Script
# Deploys MCP Server + Agent to Cloud Run, Frontend to Vercel
# ============================================================
set -euo pipefail

REGION="asia-southeast2"
REPO="aria-repo"

# ── Colors ──────────────────────────────────────────────────
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${CYAN}[ARIA]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────
log "Pre-flight checks..."
command -v gcloud >/dev/null 2>&1 || fail "gcloud CLI not found"
command -v docker >/dev/null 2>&1 || fail "docker not found"

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
[ -z "$PROJECT_ID" ] && fail "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID"
ok "GCP Project: $PROJECT_ID"

# ── Step 1: Ensure APIs are enabled ────────────────────────
log "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com \
  --quiet
ok "APIs enabled"

# ── Step 2: Ensure Artifact Registry exists ─────────────────
log "Checking Artifact Registry..."
if ! gcloud artifacts repositories describe $REPO --location=$REGION >/dev/null 2>&1; then
  log "Creating Artifact Registry..."
  gcloud artifacts repositories create $REPO \
    --repository-format=docker \
    --location=$REGION \
    --description="ARIA container images"
fi
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
ok "Artifact Registry ready"

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")

# ── Step 3: Deploy MCP Server ──────────────────────────────
log "Building MCP Server..."
docker build -t ${IMAGE_BASE}/aria-mcp-server:${TAG} ./mcp-server
docker push ${IMAGE_BASE}/aria-mcp-server:${TAG}
ok "MCP Server image pushed"

log "Deploying MCP Server to Cloud Run ($REGION)..."
gcloud run deploy aria-mcp-server \
  --image ${IMAGE_BASE}/aria-mcp-server:${TAG} \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEXAI_LOCATION=${REGION},GEMINI_MODEL=gemini-2.5-pro \
  --set-secrets OPENFDA_API_KEY=openfda-api-key:latest \
  --quiet
ok "MCP Server deployed"

MCP_URL=$(gcloud run services describe aria-mcp-server --region $REGION --format='value(status.url)')
ok "MCP Server URL: $MCP_URL"

# ── Step 4: Deploy A2A Agent ───────────────────────────────
log "Building A2A Agent..."
docker build -t ${IMAGE_BASE}/aria-agent:${TAG} ./agent
docker push ${IMAGE_BASE}/aria-agent:${TAG}
ok "Agent image pushed"

log "Deploying Agent to Cloud Run ($REGION)..."
gcloud run deploy aria-agent \
  --image ${IMAGE_BASE}/aria-agent:${TAG} \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars MCP_SERVER_URL=${MCP_URL},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},VERTEXAI_LOCATION=${REGION},GEMINI_MODEL=gemini-2.5-pro \
  --quiet
ok "Agent deployed"

AGENT_URL=$(gcloud run services describe aria-agent --region $REGION --format='value(status.url)')
ok "Agent URL: $AGENT_URL"

# ── Step 5: Deploy Frontend to Vercel ──────────────────────
log "Deploying Frontend to Vercel..."
if command -v vercel >/dev/null 2>&1; then
  cd frontend
  vercel env rm NEXT_PUBLIC_AGENT_URL production --yes 2>/dev/null || true
  echo "$AGENT_URL" | vercel env add NEXT_PUBLIC_AGENT_URL production
  vercel --prod
  cd ..
  ok "Frontend deployed to Vercel"
else
  log "Vercel CLI not found. Install with: npm i -g vercel"
  log "Then run:"
  log "  cd frontend && vercel env add NEXT_PUBLIC_AGENT_URL production"
  log "  vercel --prod"
fi

# ── Step 6: Health checks ──────────────────────────────────
log "Running health checks..."

MCP_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${MCP_URL}/health" || echo "000")
[ "$MCP_HEALTH" = "200" ] && ok "MCP Server: healthy" || log "MCP Server: $MCP_HEALTH (may be cold-starting)"

AGENT_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${AGENT_URL}/health" || echo "000")
[ "$AGENT_HEALTH" = "200" ] && ok "Agent: healthy" || log "Agent: $AGENT_HEALTH (may be cold-starting)"

# ── Done ────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ARIA Deployment Complete"
echo "============================================"
echo "  MCP Server: $MCP_URL"
echo "  Agent:      $AGENT_URL"
echo "  Frontend:   Check Vercel dashboard"
echo "============================================"
