# ARIA — System Architecture

## Overview

ARIA is a three-tier system designed for clinical drug interaction reasoning. Each tier is independently deployable and communicates over HTTPS.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend       │────▶│   A2A Agent      │────▶│   MCP Server    │
│   Next.js        │     │   Python/LGraph  │     │   Rust          │
│   Vercel         │     │   Cloud Run      │     │   Cloud Run     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                          ┌─────────────┼─────────────┐
                                          ▼             ▼             ▼
                                      OpenFDA       RxNorm        PubMed
                                                  Gemini 2.5 Pro
                                                  DrugBank Open
```

---

## MCP Server (Rust)

The MCP Server is the data and reasoning backbone. It exposes nine tools over the Model Context Protocol (MCP) via HTTP transport.

**Responsibilities:**
- Drug data retrieval from OpenFDA, RxNorm, PubMed, and DrugBank
- LLM-powered reasoning via Gemini 2.5 Pro (Vertex AI)
- Stateless tool execution with structured JSON responses

**Key design decisions:**
- Rust for memory safety, low latency, and minimal Cloud Run cold starts
- Each tool is a self-contained module with its own prompt template
- External API calls are parallelized using `tokio::join!`

---

## A2A Agent (Python / LangGraph)

The Agent orchestrates the full clinical reasoning pipeline. It receives a medication list and patient context, then invokes MCP tools in a defined sequence to build a structured clinical report.

**Pipeline stages:**
1. **Intake** — Parse and validate medication list and patient context
2. **Normalize** — Map drug names to RxNorm CUIs for standardization
3. **Graph Build** — Construct N-drug interaction graph with hub identification
4. **Phenotype Score** — Apply patient-specific risk multipliers
5. **Temporal Model** — Project risk cascade timelines
6. **Evidence Grade** — Attach PubMed citations and confidence scores
7. **Deprescribing Plan** — Generate prioritized action plan
8. **Report** — Assemble final structured clinical output

**Key design decisions:**
- LangGraph state machine for explicit, testable pipeline flow
- Async MCP client for parallel tool invocations where possible
- A2A protocol support for Prompt Opinion marketplace integration

---

## Frontend (Next.js + React Three Fiber)

The Frontend provides the clinician-facing interface with 3D visualizations for complex drug interaction data.

**Pages:**
- **Landing** (`/`) — Hero with 3D background, value proposition
- **Analyze** (`/analyze`) — Patient context form + medication input
- **Report** (`/report`) — Full interactive clinical report with 3D graphs

**3D Visualizations:**
- Force-directed interaction graph (drug nodes, interaction edges)
- Temporal risk timeline (animated cascade projection)
- Phenotype radar chart (patient risk factor visualization)
- Deprescribing waterfall (step-by-step risk reduction)

---

## Data Flow

```
User submits medications + patient context
        │
        ▼
Frontend POST /api/analyze ──▶ Agent /analyze
        │
        ▼
Agent runs LangGraph pipeline:
  ├── intake.parse(request)
  ├── normalize.map_rxnorm(drugs)         ──▶ MCP: RxNorm API
  ├── graph_builder.build(drugs)          ──▶ MCP: check_interactions + build_interaction_graph
  ├── phenotype_scorer.score(graph, pt)   ──▶ MCP: score_risk
  ├── temporal_modeler.project(graph)     ──▶ MCP: model_temporal_cascade
  ├── evidence_grader.grade(interactions) ──▶ MCP: PubMed API
  ├── plan_generator.plan(analysis)       ──▶ MCP: generate_deprescribing_plan
  └── report_builder.build(all_results)   ──▶ MCP: generate_report
        │
        ▼
Agent returns structured JSON report
        │
        ▼
Frontend renders 3D visualizations + report cards
```

---

## Deployment Topology

All backend services deploy to Google Cloud Run in the `asia-southeast2` region. The frontend deploys to Vercel's edge network.

| Service | Runtime | Region | Scaling |
|---------|---------|--------|---------|
| MCP Server | Cloud Run | asia-southeast2 | 0–10 instances, 512Mi / 1 CPU |
| A2A Agent | Cloud Run | asia-southeast2 | 0–10 instances, 1Gi / 1 CPU |
| Frontend | Vercel Edge | Global | Automatic |

Service-to-service communication between Agent and MCP Server stays within GCP's internal network, minimizing latency and avoiding egress charges.
