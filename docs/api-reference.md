# ARIA — MCP Tool API Reference

All tools are exposed via the MCP (Model Context Protocol) over HTTP transport. The MCP Server runs on port 8080 by default.

---

## Transport

- **Protocol:** MCP over HTTP (JSON-RPC 2.0)
- **Endpoint:** `POST /mcp`
- **Content-Type:** `application/json`

---

## Tools

### `check_interactions`

Detect pairwise and N-drug interactions from a medication list.

**Input:**
```json
{
  "drugs": [
    { "name": "warfarin", "rxcui": "11289" },
    { "name": "aspirin", "rxcui": "1191" }
  ],
  "patient_context": {
    "age": 72,
    "sex": "female",
    "ckd_stage": 3
  }
}
```

**Output:** `InteractionReport` — list of detected interactions with severity, type, and affected drugs.

---

### `explain_mechanism`

Provide mechanistic reasoning for a specific drug interaction (CYP enzymes, renal clearance, protein binding, etc.).

**Input:**
```json
{
  "drug_a": { "name": "warfarin", "rxcui": "11289" },
  "drug_b": { "name": "aspirin", "rxcui": "1191" }
}
```

**Output:** `MechanisticExplanation` — pathway details, enzyme involvement, clinical significance.

---

### `score_risk`

Calculate a personalized risk score (0–10) adjusted for patient phenotype.

**Input:**
```json
{
  "interaction": { "drug_a": "warfarin", "drug_b": "aspirin", "type": "pharmacodynamic" },
  "phenotype": {
    "age": 72,
    "sex": "female",
    "weight_kg": 65,
    "ckd_stage": 3,
    "hepatic_impairment": false,
    "smoking": false
  }
}
```

**Output:** `RiskScore` — numeric score, risk factors applied, reasoning.

---

### `suggest_alternatives`

Suggest evidence-based drug substitutions to reduce interaction risk.

**Input:**
```json
{
  "drug": { "name": "aspirin", "rxcui": "1191" },
  "reason": "triple anticoagulant risk with warfarin and fish oil",
  "patient_context": { "age": 72, "ckd_stage": 3 }
}
```

**Output:** `Alternatives` — ranked substitution options with trade-off analysis.

---

### `build_interaction_graph`

Construct an N-drug interaction graph with hub drug identification and emergent multi-drug interaction detection.

**Input:**
```json
{
  "drugs": [
    { "name": "warfarin", "rxcui": "11289" },
    { "name": "aspirin", "rxcui": "1191" },
    { "name": "omeprazole", "rxcui": "7646" },
    { "name": "fish oil" }
  ]
}
```

**Output:** `InteractionGraph` — nodes, edges, hub drugs, cluster analysis, emergent interactions.

---

### `compute_burden_scores`

Calculate cumulative clinical burden scores across all medications.

**Input:**
```json
{
  "drugs": [
    { "name": "diphenhydramine" },
    { "name": "oxybutynin" },
    { "name": "amitriptyline" }
  ]
}
```

**Output:** `BurdenScores` — anticholinergic burden, sedation load, QT prolongation risk, with per-drug contributions.

---

### `model_temporal_cascade`

Model the timeline of risk emergence for drug interactions.

**Input:**
```json
{
  "drugs": [
    { "name": "warfarin" },
    { "name": "fluconazole" }
  ],
  "timeline": {
    "start_date": "2025-01-01",
    "duration_days": 14
  }
}
```

**Output:** `CascadeModel` — daily risk projections, peak risk timing, intervention windows.

---

### `generate_deprescribing_plan`

Produce a prioritized deprescribing plan with expected risk reduction per step.

**Input:** `FullAnalysis` — the combined output from all previous tools.

**Output:** `DeprescribingPlan` — ordered steps, each with target drug, action, substitution, monitoring plan, and expected risk delta.

---

### `generate_report`

Assemble all analysis results into a structured clinical report.

**Input:** `FullAnalysis` — the combined output from all previous tools.

**Output:** `ClinicalReport` — formatted report with all sections, suitable for clinical review.

---

## Health Check

```
GET /health
```

Returns `200 OK` with `{"status": "healthy"}`.
