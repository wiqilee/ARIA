<div align="center">

# ARIA
### Adaptive Risk Intelligence for Polypharmacy Assessment


**An AI agent system that does not just detect drug interactions. It reasons about them.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-MCP_Server-orange?logo=rust)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/Python-Agent_Layer-blue?logo=python)](https://www.python.org/)
[![Google Cloud Run](https://img.shields.io/badge/Google_Cloud-Run_asia--southeast2-4285F4?logo=googlecloud)](https://cloud.google.com/run)
[![Gemini](https://img.shields.io/badge/Gemini-2.5_Pro-8E75B2?logo=googlegemini)](https://deepmind.google/technologies/gemini/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?logo=vercel)](https://aria-dqx7.vercel.app/)
[![Prompt Opinion](https://img.shields.io/badge/Prompt_Opinion-Marketplace-green)](https://app.promptopinion.ai)

[![Medium](https://img.shields.io/badge/Read_on-Medium-black?logo=medium)](https://medium.com/@YOUR_MEDIUM_HANDLE)
[![Twitter](https://img.shields.io/badge/Twitter-@wiqi__lee-1DA1F2?logo=twitter)](https://twitter.com/wiqi_lee)
[![YouTube](https://img.shields.io/badge/Demo-YouTube-red?logo=youtube)](https://youtube.com/YOUR_DEMO_LINK)

<br/>

> Over 90% of drug interaction alerts are ignored by clinicians. Not because they are reckless, but because existing tools deliver undifferentiated noise with zero actionable context. ARIA fixes this.

</div>

---

## The Problem Nobody Has Solved

This is not an American problem. It is not a European problem. It is a global one.

According to the [WHO 2024 publication on the global burden of preventable medication harm](https://www.who.int/publications/i/item/9789240088887), medication errors cost the world an estimated **$42 billion USD every year**, nearly 1% of total global health expenditure. Half of all preventable harm in medical care worldwide is medication-related, and a quarter of those cases are severe or life-threatening.

In low- and middle-income countries (LMICs), the impact is estimated to be **twice as severe** in terms of healthy life years lost compared to high-income countries. A [2025 systematic review in PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0322392) found that Africa and Southeast Asia have some of the highest rates of preventable medication harm globally, compounded by pharmacies operating with no pharmacist on site at all.

The driver behind a large share of this harm is **polypharmacy**: the simultaneous use of five or more medications. Two major 2024 meta-analyses quantify how widespread this is. A [review in Pharmacoepidemiology and Drug Safety](https://pubmed.ncbi.nlm.nih.gov/39135518/) found global polypharmacy prevalence among adults aged 60 and older at **39.1%**. A separate [umbrella review in Archives of Gerontology and Geriatrics](https://pubmed.ncbi.nlm.nih.gov/38733922/) covering 295 studies and nearly 60 million participants across 41 countries found general population prevalence at **37%**, rising to **52% among inpatients** and **59% among frail elderly individuals**. Polypharmacy prevalence reaches 48% in China and 49% in India ([Nature Scientific Reports, 2023](https://www.nature.com/articles/s41598-023-45095-2)), and has been documented across Southeast Asia, including Indonesia. [StatPearls (2024)](https://www.ncbi.nlm.nih.gov/books/NBK519065/) adds that medication errors are **30% more likely** in patients on five or more drugs and **38% more likely** in those aged 75 and older.

The tools built to catch these interactions are failing patients in every country. They are static lookup tables with warning labels. They tell a clinician that Drug A and Drug B interact. They do not answer the questions that actually matter:

- **How dangerous** is this, for this specific patient, given their age, kidney function, and clinical history?
- **When** on the clinical timeline will the risk actually peak?
- **Why** does this interaction occur at the biochemical level?
- **What** should be done first, when a patient has six conflicting interactions at once?

The result is **alert fatigue**. Clinicians see so many identical, context-free warnings that studies show they override more than 90% of all drug interaction alerts. The tools designed to protect patients have become background noise, in every clinic, in every country.

No one has built a system that reasons about risk. Until now.

---

## What ARIA Does Differently

ARIA is not a drug interaction checker. It is a **clinical reasoning engine**: a hybrid AI agent system that understands context, mechanism, time, and patient phenotype.

### Eight Capabilities That Do Not Exist Anywhere Else

#### 1. Temporal Cascade Modeling
Drug interactions do not manifest instantly. They evolve. ARIA models the **timeline of risk**, predicting when an interaction will peak and when to intervene, not just whether it exists.

#### 2. Pharmacokinetic Mechanistic Reasoning
ARIA explains *why* an interaction is dangerous at the **molecular level**: CYP enzyme competition, renal clearance conflicts, protein binding displacement, gut microbiome interference. Gemini 2.5 Pro-powered reasoning, not heuristic lookup.

#### 3. Patient Phenotype Risk Multiplier
The same drug combination carries vastly different risk profiles across patients. ARIA calculates a **personalized risk score** adjusted for age, sex, CKD stage, hepatic function, smoking status, and more.

```
Warfarin + Aspirin on a healthy 35-year-old male    ->  4.2 / 10
Warfarin + Aspirin on a 72-year-old female, CKD 3   ->  9.1 / 10
```

#### 4. N-Drug Interaction Graph with Hub Identification
All existing tools check drugs pairwise. A patient on eight medications generates 28 pairwise checks, which is overwhelming noise. ARIA builds a full **interaction graph**, identifies **hub drugs** (the one medication causing 60% of conflicts), and detects **emergent three-drug interactions** that pairwise logic cannot see.

```
Example: Aspirin + Warfarin + Fish Oil
Each is individually manageable.
Combined, they create a triple anticoagulant effect.
No pairwise checker catches this.
```

#### 5. Evidence Grading with Confidence Scores
Every warning is tagged with an **evidence grade** (A through D) and a **confidence score** (0 to 100%), with auto-linked PubMed citations. Clinicians can triage by evidence quality rather than treating every alert as equally urgent.

#### 6. Cumulative Burden Scores
ARIA calculates aggregate clinical loads across all medications simultaneously: **anticholinergic burden**, **sedation load**, and **QT prolongation risk**. These are validated clinical metrics that no existing tool computes as agent output.

#### 7. Deprescribing Optimizer
ARIA produces a **prioritized, actionable deprescribing plan**: which drug to address first, what to substitute, what labs to monitor, and the expected risk reduction at each step. Not a warning. A plan.

#### 8. All of the Above, Integrated
These are not isolated features. ARIA's A2A agent orchestrates all of them into a single coherent clinical reasoning pipeline. From a raw medication list to a structured clinical report in one invocation.

#### 9. Exportable Clinical Reports
ARIA generates publication-ready clinical reports in multiple formats: **interactive 3D web view**, **downloadable HTML**, and **PDF export** (via browser print). Reports include risk interpretation with clinical context, per-interaction evidence citations with PubMed links, and a 3D patient body scan visualization. All timestamps use **WIB (Jakarta timezone)** for Southeast Asian clinical workflows.

#### 10. FHIR-Native Patient Context Ingestion
ARIA reads active medications directly from any FHIR R4-compliant EHR via the `fhir_patient_medications` MCP tool. When invoked within the Prompt Opinion platform, patient IDs and bearer tokens propagate automatically through the SHARP Extension Specs. No manual entry, no custom EHR integration. For standalone use, the public HAPI FHIR sandbox serves as the test endpoint.

```
Prompt Opinion sends patient context
  -> ARIA FHIR tool queries EHR
  -> MedicationRequest bundle
  -> ARIA analyzes interactions

Zero manual data entry. End-to-end in one agent call.
```

---

## Architecture

### System Overview

```mermaid
graph TD
    PO["🏥 Prompt Opinion Platform"]
    AGENT["🤖 ARIA A2A Agent\nPython / LangGraph\nCloud Run asia-southeast2"]
    MCP["⚙️ ARIA MCP Server\nRust\nCloud Run asia-southeast2"]
    LLM["🧠 Gemini 2.5 Pro\nVertex AI asia-southeast2"]
    OPENFDA["OpenFDA API"]
    RXNORM["RxNorm API (NIH)"]
    PUBMED["PubMed API (NCBI)"]
    DRUGBANK["DrugBank Open Data"]
    FRONTEND["💻 Vercel Frontend\nNext.js + React Three Fiber\n3D Visualization"]
    USER["👤 Clinician / User"]

    USER -->|"Medication list + patient context"| FRONTEND
    FRONTEND -->|"POST /api/analyze"| AGENT
    PO -->|"A2A Protocol"| AGENT
    AGENT -->|"MCP Protocol over HTTPS"| MCP
    MCP --> LLM
    MCP --> OPENFDA
    MCP --> RXNORM
    MCP --> PUBMED
    MCP --> DRUGBANK
    AGENT -->|"Structured clinical report"| FRONTEND
```

### Agent Reasoning Pipeline

```mermaid
flowchart LR
    A["📥 Intake\nParse medication list"] -->
    B["🔤 Normalize\nRxNorm mapping"] -->
    C["🕸️ Graph Build\nN-drug interaction graph"] -->
    D["👤 Phenotype Score\nRisk multipliers"] -->
    E["⏱️ Temporal Model\nCascade timeline"] -->
    F["📚 Evidence Grade\nPubMed citations"] -->
    G["💊 Deprescribing Plan\nPrioritized actions"] -->
    H["📄 Report\nStructured clinical output"]
```

### CI/CD Pipeline

```mermaid
flowchart TD
    PUSH["git push to main"]

    PUSH --> TEST["🧪 test.yml\nRust + Python + Next.js tests"]
    TEST -->|pass| MCP_DEPLOY
    TEST -->|pass| AGENT_DEPLOY
    TEST -->|pass| FE_DEPLOY

    MCP_DEPLOY["⚙️ deploy-mcp-server.yml\ncargo build\nDocker build\nArtifact Registry asia-southeast2\nCloud Run asia-southeast2"]

    AGENT_DEPLOY["🤖 deploy-agent.yml\nDocker build\nArtifact Registry asia-southeast2\nCloud Run asia-southeast2"]

    FE_DEPLOY["💻 deploy-frontend.yml\nVercel CLI build\nVercel production deploy"]
```

### Service-to-Service Communication

```mermaid
sequenceDiagram
    participant U as User / Clinician
    participant FE as Vercel Frontend
    participant AG as A2A Agent (Cloud Run asia-southeast2)
    participant MCP as MCP Server (Cloud Run asia-southeast2)
    participant EXT as Public APIs

    U->>FE: Submit medication list + patient context
    FE->>AG: POST /analyze (HTTPS)
    AG->>MCP: MCP tool calls (internal GCP network)
    MCP->>EXT: OpenFDA / RxNorm / PubMed queries
    EXT-->>MCP: Drug data + evidence
    MCP->>MCP: Gemini 2.5 Pro reasoning
    MCP-->>AG: Tool results
    AG->>AG: Orchestrate pipeline (LangGraph)
    AG-->>FE: Structured clinical report
    FE-->>U: 3D visualization + report
```

---

## Project Structure

```
ARIA/
|
|-- .github/
|   |-- workflows/
|   |   |-- deploy-mcp-server.yml       # CI/CD: Rust build and deploy to Cloud Run (asia-southeast2)
|   |   |-- deploy-agent.yml            # CI/CD: Python build and deploy to Cloud Run (asia-southeast2)
|   |   |-- deploy-frontend.yml         # CI/CD: Vercel deploy on push to main
|   |   |-- test.yml                    # CI: Run all tests on every PR
|   |-- PULL_REQUEST_TEMPLATE.md        # Standard PR description template
|
|-- mcp-server/                         # Rust MCP Server (Google Cloud Run)
|   |-- src/
|   |   |-- main.rs                     # Server entrypoint, MCP protocol handler
|   |   |-- tools/
|   |   |   |-- mod.rs                  # Tool registry
|   |   |   |-- check_interactions.rs   # Core interaction detection
|   |   |   |-- explain_mechanism.rs    # CYP pathway mechanistic reasoning (Gemini 2.5 Pro)
|   |   |   |-- score_risk.rs           # Patient phenotype risk multiplier
|   |   |   |-- suggest_alternatives.rs # Evidence-based substitution suggestions
|   |   |   |-- interaction_graph.rs    # N-drug graph with hub identification
|   |   |   |-- burden_scores.rs        # Anticholinergic, sedation, QT burden
|   |   |   |-- temporal_cascade.rs     # Timeline risk cascade modeling
|   |   |   |-- deprescribing_plan.rs   # Prioritized deprescribing optimizer
|   |   |   |-- fhir_patient_medications.rs # FHIR R4 medication ingestion (HAPI / partner EHR)
|   |   |   |-- generate_report.rs      # Structured clinical report output
|   |   |-- api/
|   |   |   |-- openfda.rs              # OpenFDA API client
|   |   |   |-- rxnorm.rs               # RxNorm NIH API client
|   |   |   |-- pubmed.rs               # PubMed evidence citation client
|   |   |   |-- drugbank.rs             # DrugBank Open Data client
|   |   |   |-- fhir.rs                 # FHIR R4 client (HAPI sandbox / partner EHR)
|   |   |   |-- gemini.rs               # Gemini 2.5 Pro client (Vertex AI + AI Studio dual-mode)
|   |   |-- models/
|   |   |   |-- drug.rs                 # Drug struct and normalization
|   |   |   |-- patient.rs              # PatientContext and phenotype fields
|   |   |   |-- interaction.rs          # Interaction report types
|   |   |   |-- risk.rs                 # RiskScore, BurdenScores, CascadeModel
|   |   |-- llm/
|   |       |-- mod.rs                  # LLM client abstraction layer
|   |       |-- reasoning.rs            # All Gemini 2.5 Pro prompt templates
|   |-- Cargo.toml
|   |-- Dockerfile                      # Multi-stage Rust build for Cloud Run
|   |-- .env.example
|
|-- agent/                              # Python A2A Agent (Google Cloud Run)
|   |-- src/
|   |   |-- main.py                     # Agent entrypoint, FastAPI + A2A handler
|   |   |-- pipeline/
|   |   |   |-- __init__.py
|   |   |   |-- graph.py                # LangGraph state machine definition
|   |   |   |-- intake.py               # Medication list and context parser
|   |   |   |-- normalize.py            # RxNorm drug normalization step
|   |   |   |-- graph_builder.py        # Interaction graph construction step
|   |   |   |-- phenotype_scorer.py     # Risk multiplier application step
|   |   |   |-- temporal_modeler.py     # Cascade timeline projection step
|   |   |   |-- evidence_grader.py      # PubMed evidence attachment step
|   |   |   |-- plan_generator.py       # Deprescribing plan generation step
|   |   |   |-- report_builder.py       # Final structured report assembly step
|   |   |-- mcp_client/
|   |   |   |-- client.py               # Async HTTP MCP client
|   |   |   |-- schema.py               # Pydantic models for all tool I/O
|   |   |-- synthetic/
|   |       |-- generator.py            # Synthetic patient data generator
|   |       |-- fixtures/
|   |           |-- patients.json       # 10 sample synthetic patient profiles
|   |           |-- medications.json    # 50 sample medication lists
|   |-- requirements.txt
|   |-- Dockerfile                      # Google Cloud Run container
|   |-- .env.example
|
|-- frontend/                           # Vercel Frontend (Next.js + React Three Fiber + Framer Motion)
|   |-- src/
|   |   |-- app/
|   |   |   |-- layout.tsx              # Root layout, fonts, global providers
|   |   |   |-- page.tsx                # Landing / hero page
|   |   |   |-- globals.css             # CSS variables, base styles, dark theme
|   |   |   |-- analyze/
|   |   |   |   |-- page.tsx            # Patient input and analysis page
|   |   |   |-- report/
|   |   |   |   |-- page.tsx            # Full clinical report with 3D viz, PDF/HTML export, risk interpretation
|   |   |   |-- about/
|   |   |   |   |-- page.tsx            # About page: problem, solution, capabilities, usage, credits
|   |   |   |-- api/
|   |   |       |-- analyze/
|   |   |           |-- route.ts        # Next.js API route: proxies to agent
|   |   |-- components/
|   |   |   |-- ui/                     # shadcn/ui base components
|   |   |   |-- layout/
|   |   |   |   |-- Navbar.tsx          # Top navigation with animated logo (Home, Analyze, Report, About)
|   |   |   |   |-- PageTransition.tsx  # Framer Motion page transitions
|   |   |   |-- 3d/
|   |   |   |   |-- Scene.tsx           # React Three Fiber Canvas wrapper
|   |   |   |   |-- HeroBackground.tsx  # Animated 3D hero background
|   |   |   |   |-- FloatingParticles.tsx    # Ambient molecule / particle field
|   |   |   |   |-- InteractionGraph3D.tsx   # Force-directed drug interaction graph with hub detection
|   |   |   |   |-- TemporalTimeline3D.tsx   # Animated 3D risk timeline with intervention windows
|   |   |   |   |-- PhenotypeRadar3D.tsx     # 3D radar chart with zoom/rotate, per-axis interpretation
|   |   |   |   |-- DeprescribingWaterfall.tsx # Risk reduction waterfall with priority ordering
|   |   |   |   |-- PatientAvatar3D.tsx      # 3D patient body with scan animation and auto-rotate
|   |   |   |-- effects/
|   |   |   |   |-- CustomCursor.tsx    # Global custom cursor with trail effect
|   |   |   |   |-- ParticleField.tsx   # Page-level ambient particles
|   |   |   |   |-- GridBackground.tsx  # Subtle animated grid lines
|   |   |   |   |-- DataStream.tsx      # Corner data stream / matrix effect
|   |   |   |-- forms/
|   |   |   |   |-- PatientForm.tsx     # Medication list and patient context
|   |   |   |   |-- DrugInput.tsx       # Single drug entry with autocomplete
|   |   |   |   |-- PatientContextForm.tsx  # Age, sex, CKD stage, comorbidities
|   |   |   |-- report/
|   |   |   |   |-- RiskReport.tsx      # Structured report: burden scores, interactions, deprescribing, citations
|   |   |   |   |-- InteractionCard.tsx # Single interaction detail card
|   |   |   |   |-- EvidenceBadge.tsx   # A/B/C/D evidence grade badge
|   |   |   |   |-- SeverityMeter.tsx   # Animated 0-10 risk meter
|   |   |   |   |-- DeprescribingStep.tsx # Single step in deprescribing plan
|   |   |   |-- ui/
|   |   |       |-- GlowCard.tsx        # Card with hover glow border
|   |   |       |-- GradientButton.tsx  # Button with animated gradient
|   |   |       |-- LoadingScreen.tsx   # Full-screen ARIA loader
|   |   |-- lib/
|   |       |-- api.ts                  # Typed frontend API client
|   |       |-- types.ts                # Shared TypeScript types
|   |       |-- theme.ts                # Color tokens, design system constants
|   |       |-- fonts.ts                # Typography configuration
|   |-- public/
|   |   |-- logo/
|   |       |-- favicon.ico
|   |-- next.config.ts
|   |-- tailwind.config.ts              # Custom dark theme, color tokens
|   |-- vercel.json                     # Vercel config with env var mappings
|   |-- tsconfig.json
|   |-- package.json
|
|-- docs/
|   |-- setup.md                        # Full local setup guide
|   |-- architecture.md                 # System architecture deep dive
|   |-- api-reference.md                # MCP tool API reference
|   |-- synthetic-data.md               # Synthetic data schema reference
|
|-- .gitignore                          # Rust, Python, Node, env files
|-- .env.example                        # Root env var reference
|-- docker-compose.yml                  # Local full-stack dev environment
|-- LICENSE                             # MIT License
|-- README.md
```

---

## LLM Configuration

ARIA supports two Gemini auth modes selected at runtime via the `LLM_MODE` environment variable:

| Mode | Auth Method | Use Case |
|------|------------|----------|
| `vertex_ai` (default) | GCP IAM + service account | Production with enterprise access control |
| `ai_studio` | Google AI Studio API key | Hackathon demos, lightweight external integrations |

Prompt logic is identical across both modes; only the HTTP endpoint and auth header change. The switch is one function in [`mcp-server/src/api/gemini.rs`](mcp-server/src/api/gemini.rs). Production deployments use `vertex_ai` by default; the Prompt Opinion marketplace integration uses `ai_studio` for the free-tier onboarding flow during connection verification.

```bash
# Production (default)
LLM_MODE=vertex_ai
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
VERTEXAI_LOCATION=asia-southeast2

# Hackathon / external platform integration
LLM_MODE=ai_studio
GOOGLE_AI_STUDIO_API_KEY=AIza...
```

---

## Stack

| Layer | Technology | Region |
|-------|-----------|--------|
| MCP Server | Rust | Google Cloud Run (`asia-southeast2`) |
| A2A Agent | Python + LangGraph | Google Cloud Run (`asia-southeast2`) |
| LLM Reasoning | Gemini 2.5 Pro (Vertex AI) | `asia-southeast2` |
| Container Registry | Google Artifact Registry | `asia-southeast2` |
| Frontend | Next.js 14 + React Three Fiber + Framer Motion | Vercel Edge Network |
| 3D Rendering | React Three Fiber + Drei + Postprocessing | Client-side |
| 3D Visualizations | Force-directed graph, temporal timeline, phenotype radar, deprescribing waterfall, patient body scan | Client-side |
| Report Export | PDF (browser print), HTML download, interactive web view | Client-side |
| UI Components | shadcn/ui + Tailwind CSS | Client-side |
| Timezone | Asia/Jakarta (WIB) | Client-side |
| Drug Normalization | RxNorm API (NIH) | External |
| Interaction Data | OpenFDA, DrugBank Open | External |
| Evidence Layer | PubMed API (NCBI) | External |
| Patient Context Ingestion | FHIR R4 (HAPI sandbox / partner EHR via SHARP) | External |
| Patient Data | 100% synthetic, no PHI | Local generation |

### MCP Tools Exposed

```rust
check_interactions(drugs: Vec<Drug>, context: PatientContext)         -> InteractionReport
explain_mechanism(drug_a: Drug, drug_b: Drug)                         -> MechanisticExplanation
score_risk(interaction: Interaction, phenotype: PatientPhenotype)     -> RiskScore
suggest_alternatives(drug: Drug, reason: String, ctx: PatientContext) -> Alternatives
build_interaction_graph(drugs: Vec<Drug>)                             -> InteractionGraph
compute_burden_scores(drugs: Vec<Drug>)                               -> BurdenScores
model_temporal_cascade(drugs: Vec<Drug>, timeline: Timeline)          -> CascadeModel
generate_deprescribing_plan(analysis: FullAnalysis)                   -> DeprescribingPlan
generate_report(analysis: FullAnalysis)                               -> ClinicalReport
fhir_patient_medications(patient_id: String, bearer: Option<String>)  -> FhirMedicationList
```

### Frontend Design System

```
Background:   #020817   deep navy black
Surface:      #0f172a   card backgrounds
Border:       #1e3a5f   subtle borders
Primary:      #06b6d4   cyan, main interactive color
Secondary:    #8b5cf6   purple, accent
Danger:       #ef4444   red, critical warnings
Warning:      #f59e0b   amber, moderate warnings
Success:      #10b981   green, safe interactions
Text:         #f1f5f9   primary text
Muted:        #64748b   secondary text

Fonts:
  Display:  Space Grotesk (headings, logo)
  Body:     Inter (paragraph, UI text)
  Mono:     JetBrains Mono (drug names, values, codes)
```

---

## Prompt Opinion Marketplace Integration

ARIA is published to the [Prompt Opinion Marketplace](https://app.promptopinion.ai) as part of the [Agents Assemble Hackathon](https://agents-assemble.devpost.com). The integration follows **Path A (MCP Server)** as defined in the competition rules.

### Integration Flow

```mermaid
sequenceDiagram
    participant PO as Prompt Opinion Platform
    participant ARIA_AGENT as ARIA Agent
    participant ARIA_MCP as ARIA MCP Server
    participant FHIR as FHIR Server (HAPI / Partner EHR)

    PO->>ARIA_AGENT: A2A invocation + SHARP headers (patient context, FHIR token)
    ARIA_AGENT->>ARIA_MCP: fhir_patient_medications(patient_id, bearer_token)
    ARIA_MCP->>FHIR: GET /MedicationRequest?patient={id}
    FHIR-->>ARIA_MCP: Active medications bundle
    ARIA_MCP->>ARIA_MCP: Run reasoning pipeline
    ARIA_MCP-->>ARIA_AGENT: Full clinical report
    ARIA_AGENT-->>PO: Structured output
```

### SHARP Extension Specs

Patient context (patient ID) and FHIR bearer tokens propagate through multi-agent call chains via Prompt Opinion's SHARP Extension headers. ARIA's FHIR tool accepts both the platform-provided token and a local fallback for standalone testing. See [`docs/sharp-integration.md`](docs/sharp-integration.md) for header names, token propagation rules, and fallback behavior.

### Marketplace Listing

Available on Prompt Opinion Marketplace: _[URL added after publishing]_

---

## Google Cloud Setup (`asia-southeast2`)

All backend services run on Google Cloud Run in the **`asia-southeast2`** region. This minimizes latency for Southeast Asian users and keeps data residency within the region.

### 1. Initial GCP Project Setup

```bash
gcloud init
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region asia-southeast2
gcloud config set artifacts/location asia-southeast2

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  aiplatform.googleapis.com
```

### 2. Create Artifact Registry (`asia-southeast2`)

```bash
gcloud artifacts repositories create aria-repo \
  --repository-format=docker \
  --location=asia-southeast2 \
  --description="ARIA container images"

gcloud auth configure-docker asia-southeast2-docker.pkg.dev
```

Your image URLs will follow this format:

```
asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-mcp-server:latest
asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-agent:latest
```

### 3. Create a Service Account for CI/CD

```bash
gcloud iam service-accounts create aria-cicd \
  --display-name="ARIA CI/CD Service Account"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.editor"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create gcp-sa-key.json \
  --iam-account=aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Copy the contents of `gcp-sa-key.json` into the `GCP_SA_KEY` GitHub Secret, then delete it locally:

```bash
rm gcp-sa-key.json
```

### 4. Store Secrets in GCP Secret Manager

```bash
echo -n "YOUR_OPENFDA_API_KEY" | \
  gcloud secrets create openfda-api-key --data-file=-

# Gemini 2.5 Pro runs via Vertex AI.
# No separate API key needed — access is controlled by IAM roles above.

gcloud secrets add-iam-policy-binding openfda-api-key \
  --member="serviceAccount:aria-cicd@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 5. Deploy MCP Server to Cloud Run (`asia-southeast2`)

```bash
docker build -t asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-mcp-server:latest ./mcp-server
docker push asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-mcp-server:latest

gcloud run deploy aria-mcp-server \
  --image asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-mcp-server:latest \
  --region asia-southeast2 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars LLM_MODE=vertex_ai,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,VERTEXAI_LOCATION=asia-southeast2,GEMINI_MODEL=gemini-2.5-pro,FHIR_BASE_URL=https://hapi.fhir.org/baseR4 \
  --set-secrets OPENFDA_API_KEY=openfda-api-key:latest
```

### 6. Deploy A2A Agent to Cloud Run (`asia-southeast2`)

```bash
docker build -t asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-agent:latest ./agent
docker push asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-agent:latest

MCP_SERVER_URL=$(gcloud run services describe aria-mcp-server \
  --region asia-southeast2 \
  --format='value(status.url)')

gcloud run deploy aria-agent \
  --image asia-southeast2-docker.pkg.dev/YOUR_PROJECT_ID/aria-repo/aria-agent:latest \
  --region asia-southeast2 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars MCP_SERVER_URL=$MCP_SERVER_URL,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,VERTEXAI_LOCATION=asia-southeast2,GEMINI_MODEL=gemini-2.5-pro
```

### 7. Service-to-Service Communication

The A2A Agent calls the MCP Server over HTTPS within the same GCP project. Traffic stays within Google's internal network and does not incur egress charges.

```
[A2A Agent: Cloud Run asia-southeast2]
          |
          | HTTPS (internal GCP network)
          v
[MCP Server: Cloud Run asia-southeast2]
```

To lock down the MCP Server so only the agent can call it (recommended for production):

```bash
gcloud run deploy aria-mcp-server \
  --image ... \
  --region asia-southeast2 \
  --no-allow-unauthenticated

gcloud run services add-iam-policy-binding aria-mcp-server \
  --region asia-southeast2 \
  --member="serviceAccount:aria-agent-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## CI/CD and Deployment

### GitHub Actions: MCP Server

```yaml
# .github/workflows/deploy-mcp-server.yml
name: Deploy MCP Server

on:
  push:
    branches: [main]
    paths: [mcp-server/**]

env:
  REGION: asia-southeast2
  IMAGE: asia-southeast2-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/aria-repo/aria-mcp-server

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker asia-southeast2-docker.pkg.dev

      - name: Build and push Docker image
        run: |
          docker build -t $IMAGE:${{ github.sha }} ./mcp-server
          docker push $IMAGE:${{ github.sha }}

      - name: Deploy to Cloud Run asia-southeast2
        run: |
          gcloud run deploy aria-mcp-server \
            --image $IMAGE:${{ github.sha }} \
            --region $REGION \
            --platform managed \
            --allow-unauthenticated \
            --memory 512Mi \
            --cpu 1 \
            --set-env-vars LLM_MODE=vertex_ai,GOOGLE_CLOUD_PROJECT=${{ secrets.GCP_PROJECT_ID }},VERTEXAI_LOCATION=asia-southeast2,GEMINI_MODEL=gemini-2.5-pro,FHIR_BASE_URL=https://hapi.fhir.org/baseR4 \
            --set-secrets OPENFDA_API_KEY=openfda-api-key:latest
```

### GitHub Actions: A2A Agent

```yaml
# .github/workflows/deploy-agent.yml
name: Deploy A2A Agent

on:
  push:
    branches: [main]
    paths: [agent/**]

env:
  REGION: asia-southeast2
  IMAGE: asia-southeast2-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/aria-repo/aria-agent

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: gcloud auth configure-docker asia-southeast2-docker.pkg.dev

      - name: Build and push Docker image
        run: |
          docker build -t $IMAGE:${{ github.sha }} ./agent
          docker push $IMAGE:${{ github.sha }}

      - name: Deploy to Cloud Run asia-southeast2
        run: |
          gcloud run deploy aria-agent \
            --image $IMAGE:${{ github.sha }} \
            --region $REGION \
            --platform managed \
            --allow-unauthenticated \
            --memory 1Gi \
            --cpu 1 \
            --set-env-vars MCP_SERVER_URL=${{ secrets.MCP_SERVER_URL }},GOOGLE_CLOUD_PROJECT=${{ secrets.GCP_PROJECT_ID }},VERTEXAI_LOCATION=asia-southeast2,GEMINI_MODEL=gemini-2.5-pro
```

### GitHub Actions: Frontend (Vercel)

```yaml
# .github/workflows/deploy-frontend.yml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths: [frontend/**]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm install -g vercel

      - name: Pull Vercel environment
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend

      - name: Build project
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend

      - name: Deploy to Vercel
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: frontend
```

### GitHub Actions: Tests

```yaml
# .github/workflows/test.yml
name: Tests

on:
  pull_request:
    branches: [main]

jobs:
  test-mcp-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test
        working-directory: mcp-server

  test-agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt && pytest
        working-directory: agent

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci && npm run build
        working-directory: frontend
```

### Vercel Configuration

```json
// frontend/vercel.json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "env": {
    "NEXT_PUBLIC_AGENT_URL": "@aria_agent_url"
  },
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "/api/:path*"
    }
  ]
}
```

### Connect Vercel to GitHub (One-Time Setup)

```bash
npm install -g vercel
vercel login

cd frontend
vercel link
vercel env add NEXT_PUBLIC_AGENT_URL production
```

To get your Vercel credentials for GitHub Secrets:

```bash
# Your VERCEL_TOKEN is at: https://vercel.com/account/tokens
cat frontend/.vercel/project.json
# { "orgId": "YOUR_ORG_ID", "projectId": "YOUR_PROJECT_ID" }
```

### Required GitHub Secrets

| Secret | Description | How to Get |
|--------|-------------|------------|
| `GCP_SA_KEY` | GCP service account JSON key | From step 3 in GCP setup above |
| `GCP_PROJECT_ID` | Your GCP project ID | `gcloud config get-value project` |
| `OPENFDA_API_KEY` | OpenFDA API key | [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication/) |
| `MCP_SERVER_URL` | Cloud Run URL for MCP Server | `gcloud run services describe aria-mcp-server --region asia-southeast2 --format='value(status.url)'` |
| `VERCEL_TOKEN` | Vercel personal access token | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Vercel organization ID | `cat frontend/.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Vercel project ID | `cat frontend/.vercel/project.json` |

> Gemini 2.5 Pro runs via Vertex AI. No separate API key is needed. Access is controlled by the service account IAM roles above.

---

## Getting Started (Local Development)

```bash
git clone https://github.com/wiqi-lee/ARIA
cd ARIA

cp .env.example .env
cp mcp-server/.env.example mcp-server/.env
cp agent/.env.example agent/.env
cp frontend/.env.example frontend/.env.local

docker-compose up
```

Or run each service individually:

```bash
# MCP Server (Rust)
cd mcp-server
cargo build --release
cargo run

# A2A Agent (Python)
cd agent
pip install -r requirements.txt
python src/main.py

# Frontend (Next.js)
cd frontend
npm install
npm run dev
```

Full setup documentation: [`/docs/setup.md`](docs/setup.md)

---

## Why This Matters

| Metric | Value | Source |
|--------|-------|--------|
| Global cost of medication errors annually | $42 billion USD | [WHO, 2024](https://www.who.int/publications/i/item/9789240088887) |
| Share of preventable medical harm that is medication-related | 50% | [WHO, 2022](https://www.who.int/news/item/16-09-2022-who-calls-for-urgent-action-by-countries-for-achieving-medication-without-harm) |
| Patients experiencing medication harm globally | 1 in 20 hospital admissions | [WHO, 2024](https://www.who.int/publications/i/item/9789240088887) |
| Global polypharmacy prevalence, general population | 37% | [Kim et al., Arch Gerontol Geriatr, 2024](https://pubmed.ncbi.nlm.nih.gov/38733922/) |
| Global polypharmacy prevalence, adults 60+ | 39.1% | [Wang et al., Pharmacoepidemiol Drug Saf, 2024](https://pubmed.ncbi.nlm.nih.gov/39135518/) |
| Polypharmacy among inpatients globally | 52% | [Kim et al., Arch Gerontol Geriatr, 2024](https://pubmed.ncbi.nlm.nih.gov/38733922/) |
| Polypharmacy prevalence among older adults in China | 48% | [Nature Scientific Reports, 2023](https://www.nature.com/articles/s41598-023-45095-2) |
| Polypharmacy prevalence among older adults in India | 49% | [Nature Scientific Reports, 2023](https://www.nature.com/articles/s41598-023-45095-2) |
| Polypharmacy prevalence among older adults in Ethiopia | 37% | [Nature Scientific Reports, 2023](https://www.nature.com/articles/s41598-023-45095-2) |
| Medication errors higher risk when on 5+ drugs | 30% higher incidence | [StatPearls, 2024](https://www.ncbi.nlm.nih.gov/books/NBK519065/) |
| Drug interaction alerts overridden by clinicians | Over 90% | Clinical literature |
| Impact of medication errors in LMICs vs. high-income countries | 2x higher healthy life years lost | [WHO, 2017](https://www.who.int/news/item/29-03-2017-who-launches-global-effort-to-halve-medication-related-errors-in-5-years) |

Alert fatigue is not a behavior problem. It is a tool design problem. ARIA is the fix, built for every health system, everywhere.

---

## Novelty Table

| Capability | Existing Tools | ARIA |
|-----------|---------------|------|
| Pairwise drug interaction lookup | Drugs.com, Epocrates, Medscape | Yes |
| Three-way and N-drug emergent interactions | None | Yes |
| Temporal cascade modeling | None | Yes |
| Mechanistic reasoning via CYP, renal, microbiome pathways | None as agent | Yes |
| Patient phenotype risk multiplier | None | Yes |
| Evidence grading with confidence score per alert | None | Yes |
| Cumulative burden scores as agent output | None | Yes |
| Prioritized deprescribing optimizer | None | Yes |
| 3D interactive clinical report with export (PDF/HTML) | None | Yes |
| 3D patient body scan visualization | None | Yes |
| Risk score interpretation with clinical context (0-10 scale) | None | Yes |

---

## Data and Privacy

ARIA uses exclusively public, de-identified data sources:

- [OpenFDA API](https://open.fda.gov/apis/) for FDA drug labels and adverse event reports
- [RxNorm API](https://www.nlm.nih.gov/research/umls/rxnorm/) for drug name normalization
- [DrugBank Open Data](https://go.drugbank.com/releases/latest#open-data) for pharmacology and CYP pathways
- [PubMed API](https://pubmed.ncbi.nlm.nih.gov/api/) for clinical evidence citations
- [HAPI FHIR public sandbox](https://hapi.fhir.org/baseR4) for medication ingestion testing (synthetic data only)
- Synthetic patient generator for all demo data

In production, the FHIR endpoint is replaced with the partner EHR's FHIR server, and bearer tokens are propagated by Prompt Opinion via the SHARP Extension Specs. Patient identifiers never leave the tenant's FHIR server. ARIA's pharmacology lookups operate on anonymized drug strings only.

**No real Protected Health Information (PHI) is used anywhere in this system.**

---

## Roadmap

- [x] Core MCP Server in Rust with pairwise and N-drug interactions
- [x] A2A Agent orchestration with full reasoning pipeline
- [x] Prompt Opinion Marketplace integration
- [x] 3D interactive clinical report with force-directed graph, temporal timeline, phenotype radar, deprescribing waterfall
- [x] PDF and HTML report export with clinical interpretation
- [x] 3D patient body scan visualization with auto-rotate and scan animation
- [x] Risk score interpretation with 0-10 scale (Low/Moderate/High/Critical) and clinical context descriptions
- [x] Jakarta (WIB) timezone support for Southeast Asian clinical workflows
- [x] About page with project overview, capabilities, and usage guide
- [x] FHIR R4 medication resource ingestion via `fhir_patient_medications` MCP tool
- [x] SHARP Extension Specs propagation for multi-agent FHIR context
- [ ] Pharmacogenomics layer with CYP genotype integration
- [ ] EHR plugin compatible with Epic and Cerner
- [ ] Real-time ICU polypharmacy monitoring dashboard

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Built By

**Wiqi Lee** — Data Scientist, AI/ML Researcher, Software Engineer

[![Twitter](https://img.shields.io/badge/Twitter-@wiqi__lee-1DA1F2?logo=twitter)](https://twitter.com/wiqi_lee)
[![GitHub](https://img.shields.io/badge/GitHub-wiqilee-181717?logo=github)](https://github.com/wiqilee)
[![Medium](https://img.shields.io/badge/Medium-Read_Articles-black?logo=medium)](https://medium.com/@YOUR_MEDIUM_HANDLE)
[![YouTube](https://img.shields.io/badge/Demo_Video-YouTube-red?logo=youtube)](https://youtube.com/YOUR_DEMO_LINK)

---

*Submitted to the [Agents Assemble: Healthcare AI Endgame Hackathon](https://agents-assemble.devpost.com)*
*Sponsored by Prompt Opinion (Darena Health)*

<div align="center">
<sub>Built with Rust · Python · LangGraph · Gemini 2.5 Pro · Google Cloud Run (asia-southeast2) · Vercel · React Three Fiber</sub>
</div>