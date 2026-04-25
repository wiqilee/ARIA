#!/usr/bin/env bash
# ============================================================
# ARIA — Start All Services (single terminal)
# Usage: ./start.sh
# Stop:  Ctrl+C (kills all 3 services)
# ============================================================
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo -e "${CYAN}[ARIA]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }

cleanup() {
  echo ""
  log "Shutting down all services..."
  kill $MCP_PID $AGENT_PID $FRONTEND_PID 2>/dev/null
  wait $MCP_PID $AGENT_PID $FRONTEND_PID 2>/dev/null
  ok "All services stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          ARIA — Starting All Services    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. MCP Server (Rust) ───────────────────────────────────
log "Starting MCP Server (Rust) on :8080..."
cd "$ROOT_DIR/mcp-server"
if [ ! -f target/release/aria-mcp-server ]; then
  log "First run — building Rust (this takes 3-5 min)..."
  cargo build --release 2>&1 | tail -5
fi
cargo run --release 2>&1 | sed 's/^/  [MCP] /' &
MCP_PID=$!
sleep 3

# Check MCP health
for i in 1 2 3 4 5; do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    ok "MCP Server healthy on :8080"
    break
  fi
  sleep 2
done

# ── 2. Agent (Python) ──────────────────────────────────────
log "Starting Agent (Python) on :8000..."
cd "$ROOT_DIR/agent"
if [ ! -d .venv ]; then
  log "Creating Python venv..."
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -q -r requirements.txt
else
  source .venv/bin/activate
fi
python src/main.py 2>&1 | sed 's/^/  [AGT] /' &
AGENT_PID=$!
sleep 3

for i in 1 2 3; do
  if curl -sf http://localhost:8000/health >/dev/null 2>&1; then
    ok "Agent healthy on :8000"
    break
  fi
  sleep 2
done

# ── 3. Frontend (Next.js) ─────────────────────────────────
log "Starting Frontend (Next.js) on :3000..."
cd "$ROOT_DIR/frontend"
if [ ! -d node_modules ]; then
  log "Installing npm dependencies..."
  npm install --silent
fi
npx next dev 2>&1 | sed 's/^/  [WEB] /' &
FRONTEND_PID=$!
sleep 3

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       All services running!              ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  MCP Server:  http://localhost:8080      ║${NC}"
echo -e "${GREEN}║  Agent:       http://localhost:8000      ║${NC}"
echo -e "${GREEN}║  Frontend:    http://localhost:3000      ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all services       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Wait for all background jobs
wait
