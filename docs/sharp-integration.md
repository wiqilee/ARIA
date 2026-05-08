# SHARP Integration Guide

This document describes how ARIA receives FHIR access context (patient ID,
bearer token, FHIR endpoint) from upstream agent hosts such as Prompt
Opinion, and how the same code path serves standalone use against the
public HAPI FHIR sandbox.

It is the reference for the SHARP Extension Specs section in the main
[README](../README.md).

> **Status (v0.1.0).** ARIA today implements **parameter-based** FHIR
> context propagation: patient ID and bearer token are passed as MCP
> tool arguments and as environment variables, not yet as HTTP headers.
> Full SHARP §3.2 header-based propagation
> (`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`) is on the
> roadmap — see [Roadmap to Full SHARP Headers](#roadmap-to-full-sharp-headers)
> at the end of this document. The current design is interoperable with
> Prompt Opinion in that Po can pass the same values as part of the A2A
> message payload, which ARIA forwards to the FHIR tool.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Context Propagation — Today](#context-propagation--today)
- [The FHIR Tool Contract](#the-fhir-tool-contract)
- [Fallback Behavior](#fallback-behavior)
- [Worked Examples](#worked-examples)
- [Security Considerations](#security-considerations)
- [Roadmap to Full SHARP Headers](#roadmap-to-full-sharp-headers)
- [References](#references)

---

## Architecture Overview

The flow when ARIA needs to read a patient's medication list from a real
FHIR server:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Prompt Opinion / A2A client                                         │
│  • Holds the patient's FHIR endpoint + access token (from SMART      │
│    launch context, or a manually configured tenant)                  │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ A2A v1.0 JSON-RPC POST /a2a/v1
                                 │   (token + patient_id carried in
                                 │    the message payload — see below)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ARIA A2A Agent (Python / FastAPI, Cloud Run)                        │
│  • Parses message parts                                              │
│  • Calls the LangGraph pipeline                                      │
│  • Pipeline calls MCP tools via MCPClient (JSON-RPC over HTTP)       │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ MCP tool call:
                                 │   fhir_patient_medications(
                                 │     patient_id, fhir_bearer_token)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ARIA MCP Server (Rust, Cloud Run)                                   │
│  • Resolves FHIR_BASE_URL from env                                   │
│  • Resolves patient_id from tool arg or FHIR_DEFAULT_PATIENT_ID env  │
│  • Adds Authorization: Bearer <token> when token is non-empty        │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ GET {FHIR_BASE_URL}/MedicationRequest
                                 │   ?patient={patient_id}&status=active
                                 │   Authorization: Bearer <token>
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  FHIR R4 Server (HAPI sandbox / partner EHR)                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Context Propagation — Today

ARIA v0.1.0 propagates FHIR context using two mechanisms.

### 1. Per-call: MCP tool arguments

The `fhir_patient_medications` tool accepts patient and token as
arguments on every invocation. From `mcp-server/src/tools/fhir_patient_medications.rs`:

```rust
pub struct FhirPatientMedicationsInput {
    /// Patient FHIR resource ID. Falls back to FHIR_DEFAULT_PATIENT_ID
    /// when empty.
    #[serde(default)]
    pub patient_id: String,

    /// Optional bearer token. When empty, no Authorization header is
    /// sent (works for the public HAPI sandbox; production endpoints
    /// require a token).
    #[serde(default)]
    pub fhir_bearer_token: String,
}
```

These fields are populated by the A2A Agent when the upstream caller
includes them in the A2A `message` payload. Today this looks like:

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "parts": [{
        "kind": "text",
        "text": "{
          \"medications\": [],
          \"patient\": { \"id\": \"erXuFYUfucBZaryVksYEcMg3\" },
          \"fhir\": {
            \"patient_id\": \"erXuFYUfucBZaryVksYEcMg3\",
            \"bearer_token\": \"<token from SMART launch>\"
          }
        }"
      }]
    }
  }
}
```

The agent's `_parse_message_content()` extracts `patient.id` /
`fhir.patient_id` / `fhir.bearer_token`, the LangGraph node calls
`MCPClient.call_tool("fhir_patient_medications", { patient_id, fhir_bearer_token })`,
and the MCP server uses them on the FHIR HTTP request.

### 2. Service-wide: environment variables

For deployments that always talk to a single FHIR endpoint (typical
hackathon / dev configuration), three env vars cover everything without
any per-call arguments:

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `FHIR_BASE_URL` | No | `https://hapi.fhir.org/baseR4` | FHIR R4 endpoint to query. Read once per request from the process environment. |
| `FHIR_DEFAULT_PATIENT_ID` | No | _(unset)_ | Patient ID used when the tool is called with an empty `patient_id`. If both are unset, the call fails with a clear error. |
| `MCP_SERVER_URL` | Yes | `http://localhost:8080` | Where the agent finds the MCP server. |

These are configured at deploy time on Cloud Run (see the
`deploy-mcp-server.yml` and `deploy-agent.yml` workflows in
`.github/workflows/`).

### What is **not** propagated today

- `X-FHIR-Server-URL` / `X-FHIR-Access-Token` / `X-Patient-ID` HTTP
  headers as defined by SHARP §3.2 are **not yet read** by either the
  agent or the MCP server. `FHIR_BASE_URL` is process-wide, not
  per-request.
- A multi-tenant deployment that routes one ARIA instance to multiple
  FHIR endpoints based on the inbound request requires the roadmap work
  in the last section of this document.

---

## The FHIR Tool Contract

Inputs and outputs of the `fhir_patient_medications` MCP tool:

**Input**

```json
{
  "patient_id":       "erXuFYUfucBZaryVksYEcMg3",
  "fhir_bearer_token": "eyJhbGciOiJSUzI1NiIs..."
}
```

Both fields are optional. Empty `patient_id` falls back to
`FHIR_DEFAULT_PATIENT_ID`; empty `fhir_bearer_token` causes the FHIR
request to be sent without `Authorization`.

**Output**

```json
{
  "patient_id":    "erXuFYUfucBZaryVksYEcMg3",
  "fhir_base_url": "https://hapi.fhir.org/baseR4",
  "total":         4,
  "medications": [
    {
      "rxnorm_code": "855332",
      "display_name": "Warfarin Sodium 5 MG Oral Tablet",
      "status":       "active",
      "dosage_text":  "Take 5 mg by mouth once daily"
    }
  ]
}
```

The FHIR query issued upstream is:

```
GET {FHIR_BASE_URL}/MedicationRequest?patient={patient_id}&status=active&_count=50
Accept: application/fhir+json
Authorization: Bearer {fhir_bearer_token}    # only when non-empty
```

---

## Fallback Behavior

ARIA is designed to degrade gracefully when context is missing, so
that judges, CI, and local devs can exercise the pipeline without a
full SMART launch.

The fallback ladder for the FHIR tool, in priority order:

1. **`patient_id` and `fhir_bearer_token` both supplied as tool args.**
   Production path. Used when the A2A caller forwards the values from
   their own SMART launch context.
2. **Tool args empty, but env has `FHIR_DEFAULT_PATIENT_ID`** and
   `FHIR_BASE_URL` points at a public sandbox.
   The tool calls the sandbox without `Authorization` for the default
   patient. This is what hackathon judges hit by default.
3. **Tool args empty, no `FHIR_DEFAULT_PATIENT_ID`.**
   The tool returns an explicit error (`"patient_id not provided and
   FHIR_DEFAULT_PATIENT_ID unset"`), which the pipeline surfaces as a
   non-fatal warning. The rest of the pipeline still runs against any
   `medications` array passed inline by the caller.

The most common reviewer flow does **not** exercise FHIR at all: it
posts a plain medication list to `/analyze` (see Example B below) and
the FHIR tool is never invoked.

---

## Worked Examples

### Example A — A2A call with FHIR context (today's path)

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "message/send",
    "params": {
      "message": {
        "parts": [{
          "kind": "text",
          "text": "{\"fhir\":{\"patient_id\":\"example-patient-1\",\"bearer_token\":\"\"}}"
        }]
      }
    }
  }'
```

ARIA's FHIR tool issues
`GET https://hapi.fhir.org/baseR4/MedicationRequest?patient=example-patient-1&status=active`,
parses the bundle, and feeds the medications into the pipeline.

### Example B — Standalone API call (no FHIR, inline meds)

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "medications": ["warfarin", "aspirin", "ibuprofen", "atorvastatin"],
    "patient":     {"age": 78, "sex": "male", "ckd_stage": 3}
  }'
```

No FHIR call is made. ARIA runs the pipeline directly on the inline
medication list. This is the path most reviewers and judges use.

### Example C — Local dev against the HAPI sandbox

```bash
export FHIR_BASE_URL=https://hapi.fhir.org/baseR4
export FHIR_DEFAULT_PATIENT_ID=example-patient-1
export MCP_SERVER_URL=http://localhost:8080

# Start MCP server (Rust) and Agent (Python) locally, then call the
# FHIR tool directly via the MCP JSON-RPC endpoint:
curl -s -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "fhir_patient_medications",
      "arguments": {}
    }
  }'
```

Both `patient_id` and `fhir_bearer_token` are empty, so the tool falls
back to `FHIR_DEFAULT_PATIENT_ID` and calls the public sandbox without
`Authorization`.

---

## Security Considerations

- **TLS only.** Cloud Run terminates HTTPS at the edge, and the MCP
  server only accepts traffic from the agent over HTTPS in production.
- **No token logging.** The Rust MCP server does not log the value of
  `fhir_bearer_token`. The Python agent logs the presence of the field
  but not its content.
- **No token persistence.** Tokens live only in the memory of the
  request that brought them in. There is no database, no on-disk
  cache, and no `.env` write-back.
- **Synthetic data only in this submission.** All testing is against
  the public HAPI FHIR sandbox, which contains synthetic patient
  records. No real PHI is used, in line with the hackathon's safety
  compliance requirements.
- **Pharmacology lookups are anonymized.** ARIA's drug-interaction,
  RxNorm, and reasoning queries operate on drug names and codes only.
  Patient identifiers never leave the FHIR server's response into any
  external lookup.
- **Token scope is the upstream caller's responsibility.** ARIA assumes
  the bearer token (when supplied) is scoped at minimum for
  `MedicationRequest.read`. If the token is over-scoped, that is a
  SMART launch configuration issue on the caller's side.

---

## Roadmap to Full SHARP Headers

The reference SHARP-on-FHIR MCP implementation built for this
hackathon describes a richer, header-based context model where the
agent host forwards three HTTP headers on every call:

| Header | Purpose |
|---|---|
| `X-FHIR-Server-URL` | Per-request FHIR endpoint (overrides `FHIR_BASE_URL`) |
| `X-FHIR-Access-Token` | Per-request bearer token |
| `X-Patient-ID` | Per-request patient ID |

This unlocks **multi-tenant** deployments where a single ARIA instance
can serve callers pointing at different FHIR servers (Epic, Cerner,
HAPI, etc.) without redeploying.

The work needed in ARIA to support this:

1. **Agent — middleware.** Add a FastAPI dependency in
   `agent/src/main.py` that pulls `X-FHIR-Server-URL`,
   `X-FHIR-Access-Token`, `X-Patient-ID` off the inbound request and
   stashes them in a `ContextVar` for the duration of the call.
2. **Agent — MCPClient.** Forward those values either as additional
   tool arguments (`fhir_server_url`, `fhir_bearer_token`,
   `patient_id`) or as outbound HTTP headers on the JSON-RPC POST
   to the MCP server.
3. **MCP server — input struct.** Extend `FhirPatientMedicationsInput`
   with an optional `fhir_server_url: Option<String>` and prefer it
   over the `FHIR_BASE_URL` env var when present.
4. **Agent card.** Advertise
   `capabilities.experimental.fhir_context_required = true` so
   SHARP-aware clients know to forward the headers automatically.

These changes are non-breaking — the env-var and tool-arg paths above
remain valid fallbacks. The work is tracked in the project issue
tracker as the "Full SHARP §3.2 header propagation" milestone.

---

## References

- **SHARP-on-FHIR reference implementation** (built for the same
  hackathon, vendor-neutral header-based context model):
  https://github.com/TerminallyLazy/sharp-on-fhir-mcp
- **A2A v1.0 protocol announcement:**
  https://a2a-protocol.org/latest/announcing-1.0/
- **SMART App Launch v2.2.0** (`Authorization: Bearer` shape, scopes):
  https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html
- **HL7 FHIR R4 RESTful API** (request/response shape, MIME types):
  https://www.hl7.org/fhir/http.html

For questions or to report a SHARP integration bug against ARIA, open
an issue at https://github.com/wiqilee/ARIA/issues with the label
`sharp`.
