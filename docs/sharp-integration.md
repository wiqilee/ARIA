# SHARP Integration Guide

This document describes how ARIA receives FHIR access context (patient ID, bearer token, and FHIR endpoint) from upstream A2A clients such as the Prompt Opinion platform, and how the same code path serves standalone use against the public HAPI FHIR sandbox.

It is the reference for the SHARP Extension Specs section in the main [README](../README.md).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [SHARP Headers](#sharp-headers)
- [Propagation Flow](#propagation-flow)
- [The FHIR Tool Contract](#the-fhir-tool-contract)
- [Fallback Behavior](#fallback-behavior)
- [Worked Examples](#worked-examples)
- [Security Considerations](#security-considerations)
- [Compatibility Matrix](#compatibility-matrix)
- [References](#references)

## Architecture Overview

When ARIA needs to read a patient's medication list from a real FHIR server, three pieces of context have to travel from the upstream agent host all the way to the FHIR endpoint:

1. The FHIR base URL to query, such as Epic, Cerner, MEDITECH, the HAPI sandbox, or any other R4 endpoint.
2. The patient resource ID in scope.
3. A bearer token authorized for that patient.

Per SHARP §3.2, the MCP server never runs an OAuth dance itself. The agent host obtains the token (typically through a SMART on FHIR launch) and forwards it on every downstream call as plain HTTP headers. ARIA reads those headers, uses them to query FHIR, and discards them when the request scope ends. A single ARIA deployment therefore works against any FHIR R4 endpoint without vendor specific code or per EHR configuration.

```
+------------------------------------------------------------------+
|  Prompt Opinion / A2A client                                     |
|  Holds the patient's FHIR endpoint and access token from the     |
|  active SMART launch context.                                    |
+--------------------------------+---------------------------------+
                                 |
                                 |  POST /a2a/v1
                                 |  X-FHIR-Server-URL:   ...
                                 |  X-FHIR-Access-Token: ...
                                 |  X-Patient-ID:        ...
                                 v
+------------------------------------------------------------------+
|  ARIA A2A Agent (Python, FastAPI on Cloud Run)                   |
|  SHARP middleware extracts the three headers and merges them     |
|  into the request payload, then runs the LangGraph pipeline.     |
+--------------------------------+---------------------------------+
                                 |
                                 |  MCP tools/call
                                 |  fhir_patient_medications(
                                 |    patient_id, fhir_bearer_token,
                                 |    fhir_server_url)
                                 v
+------------------------------------------------------------------+
|  ARIA MCP Server (Rust on Cloud Run)                             |
|  Resolves the FHIR base URL (header value > env var > sandbox),  |
|  builds the request, and adds Authorization: Bearer <token>      |
|  when a token is present.                                        |
+--------------------------------+---------------------------------+
                                 |
                                 |  GET /MedicationRequest
                                 |    ?patient={id}&status=active
                                 |  Authorization: Bearer <token>
                                 v
+------------------------------------------------------------------+
|  FHIR R4 Server (HAPI sandbox or partner EHR)                    |
+------------------------------------------------------------------+
```

## SHARP Headers

ARIA's A2A endpoint accepts the standard SHARP headers on every call into `/a2a/v1` and `/analyze`. The names match the reference SHARP on FHIR MCP implementation built for the same Prompt Opinion hackathon, so any client targeting that ecosystem is plug compatible with ARIA without modification.

| Header | Required | Purpose | Example |
|---|---|---|---|
| `X-FHIR-Server-URL` | Optional | Base URL of the FHIR R4 endpoint to query. When present, it overrides the `FHIR_BASE_URL` environment variable for the lifetime of the request. | `https://hapi.fhir.org/baseR4` |
| `X-FHIR-Access-Token` | Optional | Bearer token authorized for the patient in scope. Sent as the raw token. ARIA strips a leading `Bearer ` if present, then prepends it once when calling FHIR, so callers can send either form. | `eyJhbGciOiJSUzI1NiIs...` |
| `X-Patient-ID` | Optional | FHIR `Patient.id` of the record in scope. When omitted, ARIA falls back to the `patient.id` field in the A2A message payload, then to the `FHIR_DEFAULT_PATIENT_ID` environment variable. | `erXuFYUfucBZaryVksYEcMg3` |

All three headers are optional because ARIA also serves callers that do not run a SMART launch, such as the `/analyze` REST endpoint and local development against the HAPI sandbox. The fallback ladder below describes how missing values are resolved.

## Propagation Flow

### 1. Inbound: Prompt Opinion to ARIA Agent

When the Prompt Opinion orchestrator routes a user request to ARIA, it attaches the patient's SHARP headers to the A2A JSON RPC POST:

```
POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1
Content-Type:        application/json
X-FHIR-Server-URL:   https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
X-FHIR-Access-Token: eyJhbGciOiJSUzI1NiIs...
X-Patient-ID:        erXuFYUfucBZaryVksYEcMg3

{ "jsonrpc": "2.0", "method": "message/send", ... }
```

The `_extract_sharp_context()` middleware in `agent/src/main.py` reads the three headers from the inbound request and stores them in a request scoped dict. `_merge_sharp_into_payload()` then folds the values into the message payload, where SHARP header values take precedence over any matching fields in the payload itself.

### 2. Agent to MCP Server

After the merge, the LangGraph pipeline invokes the FHIR tool through `MCPClient.fhir_patient_medications(...)`, which forwards the values as MCP tool arguments:

```python
await mcp_client.fhir_patient_medications(
    patient_id   = ctx["patient_id"],     # from X-Patient-ID
    bearer_token = ctx["bearer_token"],   # from X-FHIR-Access-Token
    server_url   = ctx["server_url"],     # from X-FHIR-Server-URL
)
```

### 3. MCP Server to FHIR Server

The Rust MCP tool resolves the effective FHIR base URL with the priority `tool arg > FHIR_BASE_URL env var > public HAPI sandbox`, then issues:

```
GET {base_url}/MedicationRequest?patient={patient_id}&status=active&_count=50
Accept:        application/fhir+json
Authorization: Bearer {fhir_bearer_token}
```

The `Authorization` header is added only when the token is non empty. ARIA strips a single leading `Bearer ` from the token if present, then prepends it exactly once, so `Authorization: Bearer Bearer <token>` is impossible.

### 4. Lifetime

- Headers are read on every request and never cached across requests.
- They are never persisted to disk, database, or logs. Only the presence of each header is logged, never the value itself.
- They are never forwarded to any third party service other than the FHIR endpoint identified by `X-FHIR-Server-URL` (or `FHIR_BASE_URL` as the fallback).

## The FHIR Tool Contract

The MCP tool `fhir_patient_medications` accepts the following input shape, defined in `mcp-server/src/tools/fhir_patient_medications.rs`:

```rust
pub struct FhirPatientMedicationsInput {
    /// Patient FHIR resource ID. Falls back to FHIR_DEFAULT_PATIENT_ID
    /// when empty. Sourced from X-Patient-ID at the agent layer.
    #[serde(default)]
    pub patient_id: String,

    /// Optional bearer token. Sourced from X-FHIR-Access-Token. When
    /// empty, no Authorization header is sent.
    #[serde(default)]
    pub fhir_bearer_token: String,

    /// Optional per-request FHIR base URL. Sourced from X-FHIR-Server-URL.
    /// When empty, falls back to FHIR_BASE_URL.
    #[serde(default)]
    pub fhir_server_url: String,
}
```

A successful response looks like this:

```json
{
  "patient_id":     "erXuFYUfucBZaryVksYEcMg3",
  "fhir_base_url":  "https://hapi.fhir.org/baseR4",
  "total":          4,
  "medications": [
    {
      "rxnorm_code":  "855332",
      "display_name": "Warfarin Sodium 5 MG Oral Tablet",
      "status":       "active",
      "dosage_text":  "Take 5 mg by mouth once daily"
    }
  ]
}
```

## Fallback Behavior

ARIA degrades gracefully when SHARP context is missing, so that judges, CI pipelines, and local developers can exercise the pipeline without a full SMART launch.

The fallback ladder for the FHIR endpoint, in priority order:

1. `X-FHIR-Server-URL` header on the inbound A2A request.
2. The `FHIR_BASE_URL` environment variable on the MCP server.
3. The default `https://hapi.fhir.org/baseR4` baked into the MCP server.

The fallback ladder for patient identification:

1. `X-Patient-ID` header on the inbound A2A request.
2. The `patient.id` field in the A2A message payload.
3. The `FHIR_DEFAULT_PATIENT_ID` environment variable on the MCP server.
4. An explicit error if none of the above are set.

The fallback ladder for authorization:

1. `X-FHIR-Access-Token` header on the inbound A2A request.
2. The `fhir.bearer_token` field in the A2A message payload.
3. No `Authorization` header is sent. The HAPI public sandbox accepts unauthenticated reads against synthetic data, which is what most reviewers and judges hit by default.

The most common reviewer flow does not exercise FHIR at all. It posts a plain medication list to `/analyze` (see Example B below) and the FHIR tool is never invoked.

## Worked Examples

### Example A: Prompt Opinion to production ARIA with SHARP headers

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1 \
  -H "Content-Type:        application/json" \
  -H "X-FHIR-Server-URL:   https://hapi.fhir.org/baseR4" \
  -H "X-Patient-ID:        example-patient-1" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "message/send",
    "params": {
      "message": {
        "parts": [{ "kind": "text", "text": "{}" }]
      }
    }
  }'
```

ARIA reads the headers, calls the HAPI sandbox for `MedicationRequest?patient=example-patient-1&status=active`, runs the pipeline against the returned active medications, and returns a markdown clinical report.

### Example B: Standalone API call without SHARP

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "medications": ["warfarin", "aspirin", "ibuprofen", "atorvastatin"],
    "patient":     {"age": 78, "sex": "male", "ckd_stage": 3}
  }'
```

No FHIR call is made. ARIA runs the pipeline directly on the inline medication list. This is the path most reviewers and judges use when evaluating the submission.

### Example C: Local development against the HAPI sandbox

```bash
export FHIR_BASE_URL=https://hapi.fhir.org/baseR4
export FHIR_DEFAULT_PATIENT_ID=example-patient-1
export MCP_SERVER_URL=http://localhost:8080

# After starting the MCP server (Rust) and Agent (Python) locally:
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

Both `patient_id` and `fhir_bearer_token` are empty, so the tool falls back to `FHIR_DEFAULT_PATIENT_ID` and calls the public sandbox without an `Authorization` header.

## Security Considerations

ARIA is built around a small set of security invariants that hold regardless of which propagation path the caller uses.

TLS is mandatory. Cloud Run terminates HTTPS at the edge, and the MCP server only accepts traffic from the agent over HTTPS in production. Bearer tokens never travel over plain HTTP.

Tokens are never logged. Both the Python agent and the Rust MCP server log only the presence of `X-FHIR-Access-Token`, never its value. Cloud Run log retention in the `aria-2026-ai` project is configured accordingly.

Tokens are never persisted. They live in the memory of the request that brought them in, and they are dropped when the request scope ends. There is no database, no on disk cache, and no environment write back.

Patient identifiers never leave the tenant's FHIR server. ARIA's pharmacology lookups (drug names, RxNorm codes, mechanism queries) operate on anonymized drug strings only. No patient identifier is sent to RxNorm, DrugBank, PubMed, or any other external service.

Token scope is the upstream caller's responsibility. ARIA assumes the bearer token, when supplied, is scoped at minimum for `MedicationRequest.read`. If the token is over scoped, that is a SMART launch configuration concern on the caller's side, not an ARIA concern.

No OAuth dance happens on the server. Per SHARP §3.2, the MCP server never runs an OAuth flow itself. This is what makes a single ARIA deployment vendor neutral across Epic, Cerner, MEDITECH, athenahealth, HAPI, and any other R4 endpoint.

This submission uses only synthetic data. All testing is against the public HAPI FHIR sandbox, which contains synthetic patient records. No real Protected Health Information is used anywhere in the system, in line with the hackathon's safety compliance requirements.

## Compatibility Matrix

| Client | SHARP headers | Notes |
|---|---|---|
| Prompt Opinion (production with SMART launch) | Yes | Headers are populated automatically from the user's active SMART launch context. |
| Prompt Opinion (testing without SMART) | Optional | The platform can be configured to forward a static dev token. Otherwise ARIA falls back to inline `medications` from the message payload. |
| `curl` or `httpie` for manual judge testing | Optional | Most judges use the inline `/analyze` path (Example B). |
| `sharp-on-fhir-mcp` reference clients | Compatible | ARIA accepts the same header names, so clients targeting that server work against ARIA without modification. |
| Generic A2A v1.0 client | Optional | When the client does not supply SHARP headers, ARIA returns whatever the inline pipeline can produce from the message payload. |

## References

- SHARP on FHIR reference implementation built for the same hackathon: https://github.com/TerminallyLazy/sharp-on-fhir-mcp
- A2A v1.0 protocol announcement: https://a2a-protocol.org/latest/announcing-1.0/
- SMART App Launch v2.2.0, including the `Authorization: Bearer` shape and scope semantics: https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html
- HL7 FHIR R4 RESTful API, including request and response shape: https://www.hl7.org/fhir/http.html