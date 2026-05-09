# ARIA System Architecture

This document explains how ARIA is wired together end to end: the three deployed services, the data flow on a single analysis request, the design choices behind each layer, and the trade-offs that fell out of those choices.

For a fast overview, read the [System Architecture](../README.md#system-architecture) section in the main README first. This document goes deeper.

## Table of Contents

- [Overview](#overview)
- [Why Three Services](#why-three-services)
- [MCP Server (Rust)](#mcp-server-rust)
- [A2A Agent (Python and LangGraph)](#a2a-agent-python-and-langgraph)
- [Frontend (Next.js and React Three Fiber)](#frontend-nextjs-and-react-three-fiber)
- [Data Flow](#data-flow)
- [Request Lifecycle Timeline](#request-lifecycle-timeline)
- [State Model](#state-model)
- [Deployment Topology](#deployment-topology)
- [Cross-Region Latency Trade-Off](#cross-region-latency-trade-off)
- [Failure Modes and Recovery](#failure-modes-and-recovery)
- [Scaling Notes](#scaling-notes)
- [Security Boundaries](#security-boundaries)

## Overview

ARIA is a three-tier system designed for clinical drug interaction reasoning. Each tier is independently deployable and communicates over HTTPS.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   A2A Agent     │────▶│   MCP Server    │
│   Next.js       │     │   Python/LGraph │     │   Rust          │
│   Vercel        │     │   Cloud Run     │     │   Cloud Run     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                          ┌─────────────┼─────────────┐
                                          ▼             ▼             ▼
                                      OpenFDA       RxNorm        PubMed
                                                  Gemini 2.5 Pro
                                                  DrugBank Open
                                                    FHIR R4
```

A2A clients (Prompt Opinion, sharp-on-fhir-mcp clients, generic A2A v1.0 callers) reach the system through the A2A Agent's `/a2a/v1` endpoint, parallel to the Frontend path.

## Why Three Services

ARIA could have been a single monolithic Python service. Splitting it into three independently deployable layers buys three properties that matter for healthcare AI:

**Different work, different runtimes.** Drug knowledge lookup is CPU-bound, parses JSON from external APIs, and benefits from Rust's memory safety and concurrency. The agent's reasoning loop is async I/O-heavy and benefits from Python's LangGraph and Vertex AI SDK. The frontend needs the Next.js and React Three Fiber ecosystem. Letting each layer pick the best tool keeps each one small.

**Independent deploy and rollback.** A bug fix in the LangGraph orchestration does not require rebuilding the Rust binary. A frontend regression does not bring down the agent.

**Path B compliance for the hackathon.** The A2A agent is the public, A2A v1.0 compliant entry point. The MCP server is a private implementation detail behind it. Other agents in the Prompt Opinion ecosystem talk to the A2A endpoint, never to the MCP server directly.

## MCP Server (Rust)

The MCP Server is the data and reasoning backbone. It exposes ten tools over the Model Context Protocol (MCP) via HTTP transport. The full input and output schema for each tool lives in [`docs/api-reference.md`](api-reference.md).

**Responsibilities:**

- Drug data retrieval from OpenFDA, RxNorm, PubMed, and DrugBank Open Data
- FHIR R4 medication ingestion via the `fhir_patient_medications` tool, with vendor-neutral support for HAPI, Epic, Cerner, MEDITECH, and any other R4 endpoint
- LLM-powered mechanistic reasoning via Gemini 2.5 Pro on Vertex AI
- Stateless tool execution with structured JSON responses

**Key design decisions:**

- Rust for memory safety, low latency, and minimal Cloud Run cold starts (under one second on `min-instances 0`)
- Each tool is a self-contained module with its own prompt template, kept under `mcp-server/src/llm/reasoning.rs` for easy review
- External API calls inside a tool are parallelized with `tokio::join!`. For example, `build_interaction_graph` fans out N pairwise lookups in parallel and joins the results.
- No state. There is no in-process cache, no database, no on-disk write. Every cold-cache request hits the upstream APIs fresh, which is a deliberate choice for clinical safety: drug data freshness matters more than the marginal latency a cache would save.

## A2A Agent (Python and LangGraph)

The Agent orchestrates the full clinical reasoning pipeline. It receives a medication list and patient context, then invokes MCP tools in a defined sequence to build a structured clinical report.

**Pipeline stages:**

1. **Intake.** Parse and validate medication list and patient context.
2. **Normalize.** Map drug names to RxNorm CUIs for standardization.
3. **Graph Build.** Construct N-drug interaction graph with hub identification.
4. **Phenotype Score.** Apply patient-specific risk multipliers.
5. **Temporal Model.** Project risk cascade timelines.
6. **Evidence Grade.** Attach PubMed citations and confidence scores.
7. **Deprescribing Plan.** Generate prioritized action plan.
8. **Report.** Assemble the final structured clinical output.

**Key design decisions:**

- LangGraph state machine for explicit, testable pipeline flow. Every analysis mutates a single `AnalysisState` object, so the pipeline is deterministic given the same input and any node can be re-run independently for debugging.
- Async MCP client with parallel tool invocations where possible (RxNorm normalization, pairwise interaction checks, PubMed citation lookups).
- A2A v1.0 protocol support exposed at `/a2a/v1`, with the agent card published at `/.well-known/agent-card.json` for automatic discovery.
- FHIR context propagation through the A2A FHIR Context extension (Prompt Opinion native, camelCase JSON) and the SHARP HTTP headers (sharp-on-fhir-mcp compatibility), in that priority order. See [`docs/sharp-integration.md`](sharp-integration.md) for the full propagation rules.

## Frontend (Next.js and React Three Fiber)

The Frontend provides the clinician-facing interface with 3D visualizations for complex drug interaction data.

**Pages:**

- **Landing** (`/`). Hero with 3D background, value proposition.
- **Analyze** (`/analyze`). Patient context form and medication input, with Quick Test presets backed by the synthetic fixtures.
- **Report** (`/report`). Full interactive clinical report with 3D graphs, exportable to HTML and PDF.
- **About** (`/about`). Project overview, capabilities, usage guide, credits.

**3D visualizations:**

- Force-directed interaction graph (drug nodes, interaction edges)
- Temporal risk timeline (animated cascade projection)
- Phenotype radar chart (patient risk factor visualization)
- Deprescribing waterfall (step-by-step risk reduction)
- Patient avatar with scan animation and auto-rotate

**Key design decisions:**

- Next.js 15 on Vercel for the best balance of build-time SEO, client-side interactivity, and edge-cached static assets across regions.
- The `/api/analyze` route is a thin Next.js API proxy that forwards to the agent's REST endpoint, which keeps the agent URL out of the client bundle and leaves room to add auth headers later.

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

When the request arrives via the A2A endpoint instead of the REST endpoint, the agent additionally extracts FHIR context (extension or SHARP headers) and may insert an extra step before *intake* that calls `MCP: fhir_patient_medications` to populate the medication list from the patient's EHR.

## Request Lifecycle Timeline

The 60-second clinician flow described in the README breaks down like this end to end. Times are measured from a warm Cloud Run instance against the asia-southeast2 deployment:

```
T+0.0s   User clicks "72F CKD3" preset on /analyze
T+0.1s   Frontend POSTs to /api/analyze with the preset payload
T+0.1s   Next.js API route forwards to the Cloud Run agent
T+0.2s   Agent extracts FHIR context (none for the preset path)
T+0.2s   LangGraph pipeline starts at the intake node
T+0.3s   Intake -> Normalize: RxNorm lookups in parallel
T+0.8s   Normalize -> Graph Build: pairwise check_interactions in parallel
T+1.5s   Graph Build -> Phenotype Score: score_risk per interaction
T+2.5s   Phenotype Score -> Temporal Model: model_temporal_cascade
T+4.0s   Temporal Model -> Evidence Grade: PubMed lookups in parallel
T+5.5s   Evidence Grade -> Plan Generator: Gemini 2.5 Pro reasoning
T+8.0s   Plan Generator -> Report Builder: assemble final clinical report
T+8.5s   Agent returns the structured report to the frontend
T+9.0s   Frontend renders the 3D visualizations as the data streams in
T+10s    Full report visible, exportable to PDF or HTML
```

The single longest leg is the Vertex AI call inside `Plan Generator`. Everything else is bounded by external API latency and parallel fan-out.

## State Model

ARIA is stateless across requests. Every single piece of context that affects the output is one of:

- The medication list and patient context in the request body
- The FHIR context propagated through the A2A extension or SHARP headers
- The static drug knowledge in OpenFDA, RxNorm, PubMed, and DrugBank
- The Gemini 2.5 Pro model weights, pinned to `gemini-2.5-pro`

There is no user account, no session, no saved analysis history. A reviewer who clicks the same preset twice gets the same report twice, modulo Gemini's natural sampling variance which is bounded by `temperature: 0.2`.

This matters for hackathon judging because it makes ARIA trivially reproducible. It also matters for HIPAA-style compliance: there is no patient identifier sitting at rest in any ARIA-controlled system.

## Deployment Topology

All backend services deploy to Google Cloud Run in the `asia-southeast2` region. The frontend deploys to Vercel's edge network.

| Service | Runtime | Region | Scaling |
|---------|---------|--------|---------|
| MCP Server | Cloud Run | asia-southeast2 | 0 to 10 instances, 512 MiB / 1 CPU |
| A2A Agent | Cloud Run | asia-southeast2 | 0 to 10 instances, 1 GiB / 1 CPU |
| Frontend | Vercel Edge | Global | Automatic |

Service-to-service communication between Agent and MCP Server stays inside GCP's internal network, which minimizes latency and avoids egress charges.

## Cross-Region Latency Trade-Off

Cloud Run services run in `asia-southeast2` (Jakarta), but Vertex AI runs in `us-central1`. This is because Gemini 2.5 Pro is not yet available in `asia-southeast2`.

The added latency is roughly 200 ms per Vertex AI call, measured from the agent in Jakarta to Vertex AI in Iowa and back. ARIA makes between two and five Vertex AI calls per analysis request, so the total cross-region cost is in the range of 400 ms to 1 second per request. That is tolerable for a deliberative clinical reasoning workflow, where the user already expects 5 to 10 seconds of "thinking" time.

When `gemini-2.5-pro` becomes available in `asia-southeast2`, flipping `VERTEXAI_LOCATION` is a one-line change. The Rust client at `mcp-server/src/api/gemini.rs` reads the location from the environment.

## Failure Modes and Recovery

| Failure | Symptom | Recovery |
|---|---|---|
| OpenFDA timeout or rate limit | A single `check_interactions` call returns a partial result with the affected drug flagged | Pipeline continues, the report shows a warning that one interaction is unverified |
| RxNorm 404 on an unknown drug name | `Normalize` stage cannot map the drug to an `rxcui` | Pipeline continues with the raw name, downstream Gemini reasoning still produces a useful answer |
| Vertex AI transient `429` | `Plan Generator` retries once with exponential backoff | If both attempts fail, the agent returns a graceful error and the frontend shows a retry banner |
| FHIR server unreachable | `fhir_patient_medications` returns an empty list | Agent treats it as "no medications on file" and asks the caller to provide them inline |
| MCP server cold start | First request after idle takes about 2 seconds longer | Subsequent requests reuse the warm container, no user action needed |

The pipeline is designed so that no single external dependency can fail the whole analysis. Worst case, the report is annotated with what was unavailable.

## Scaling Notes

**Cloud Run autoscaling.** Both the MCP server and the agent run with `--min-instances 0 --max-instances 10`. Cold starts add roughly 1 to 2 seconds for Rust and 3 to 5 seconds for Python on the first request after idle. For the hackathon judging window, this is more than enough headroom.

**Vertex AI quotas.** Gemini 2.5 Pro per-project quotas are the actual scaling ceiling. With the default project quotas, ARIA can comfortably handle a few dozen concurrent analyses. Production deployments would request a quota bump.

**OpenFDA per-key quota.** With a registered API key, the per-day cap is 120,000 requests. A heavy reviewer flow uses about 30 requests per analysis, which means roughly 4,000 analyses per day on the free tier. More than enough for a hackathon, and it scales linearly if the key is upgraded.

## Security Boundaries

The detailed security invariants for FHIR context handling are in [`docs/sharp-integration.md`](sharp-integration.md). The system-wide invariants are:

**TLS everywhere.** Cloud Run terminates HTTPS at the edge. The agent calls the MCP server over HTTPS, even though both run in the same project.

**No persistent state, anywhere.** No database. No on-disk cache. No environment write-back. Every request brings its own context and the context is dropped at the end of the request.

**No PHI.** The system has only ever been tested against synthetic data and the public HAPI FHIR sandbox, which contains synthetic patient records by design. The hackathon's safety compliance requirement is met by construction, not by policy.

**Vendor neutral.** The same MCP server can be pointed at Epic, Cerner, MEDITECH, athenahealth, HAPI, or any other FHIR R4 endpoint without code changes, because the FHIR base URL is propagated per request. The MCP server contains no Epic-specific or Cerner-specific code.

**Secrets in Secret Manager.** The OpenFDA API key is stored in GCP Secret Manager and mounted into the MCP server at runtime. It never lives in the container image, the source code, or environment variables that are visible in the Cloud Run console.