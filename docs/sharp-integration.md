# SHARP Integration Guide

This document describes how ARIA receives FHIR access context (FHIR endpoint, patient ID, and bearer token) from upstream A2A clients such as the Prompt Opinion platform, and how the same code path serves standalone use against the public HAPI FHIR sandbox.

ARIA accepts FHIR context through **two complementary channels**:

1. **A2A Extension payload** (camelCase JSON), defined by Prompt Opinion's official A2A FHIR Context schema at [`https://app.promptopinion.ai/schemas/a2a/v1/fhir-context`](https://app.promptopinion.ai/schemas/a2a/v1/fhir-context). This is what Prompt Opinion uses natively.
2. **SHARP HTTP headers** (`X-FHIR-Server-URL`, `X-FHIR-Access-Token`, `X-Patient-ID`), as advertised in ARIA's agent card under `capabilities.experimental.sharpExtensions`. This is the convention used by the [`sharp-on-fhir-mcp`](https://github.com/TerminallyLazy/sharp-on-fhir-mcp) reference implementation, so any client targeting that server is plug compatible with ARIA.

Both channels resolve to the same internal context object before ARIA invokes the FHIR tool, so the rest of the pipeline does not care which channel the caller used.

This document is the reference for the SHARP Extension Specs section in the main [README](../README.md).

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Channel 1: A2A Extension Payload (Prompt Opinion native)](#channel-1-a2a-extension-payload-prompt-opinion-native)
- [Channel 2: SHARP HTTP Headers](#channel-2-sharp-http-headers)
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
3. A bearer token authorized for that patient, optionally with a refresh token for offline access.

Per SHARP §3.2, the MCP server never runs an OAuth dance itself. The agent host obtains the token (typically through a SMART on FHIR launch) and forwards it on every downstream call, either as the A2A Extension payload or as plain HTTP headers. ARIA reads the values, uses them to query FHIR, and discards them when the request scope ends. A single ARIA deployment therefore works against any FHIR R4 endpoint without vendor specific code or per EHR configuration.

```
+------------------------------------------------------------------+
|  Prompt Opinion / A2A client                                     |
|  Holds the patient's FHIR endpoint and access token from the     |
|  active SMART launch context.                                    |
+--------------------------------+---------------------------------+
                                 |
                                 |  POST /a2a/v1
                                 |
                                 |  Channel 1 (PO native): JSON extension
                                 |    { "extensions": {
                                 |        "https://app.promptopinion.ai/
                                 |         schemas/a2a/v1/fhir-context": {
                                 |          "fhirUrl":   "...",
                                 |          "fhirToken": "...",
                                 |          "patientId": "..."
                                 |        }
                                 |    } }
                                 |
                                 |  Channel 2 (SHARP): HTTP headers
                                 |    X-FHIR-Server-URL:   ...
                                 |    X-FHIR-Access-Token: ...
                                 |    X-Patient-ID:        ...
                                 v
+------------------------------------------------------------------+
|  ARIA A2A Agent (Python, FastAPI on Cloud Run)                   |
|  SHARP middleware extracts context from either channel and       |
|  merges it into the request payload, then runs the LangGraph     |
|  pipeline.                                                       |
+--------------------------------+---------------------------------+
                                 |
                                 |  MCP tools/call
                                 |  fhir_patient_medications(
                                 |    patient_id, fhir_bearer_token,
                                 |    fhir_server_url)
                                 v
+------------------------------------------------------------------+
|  ARIA MCP Server (Rust on Cloud Run)                             |
|  Resolves the FHIR base URL (extension/header > env var > HAPI), |
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

## Channel 1: A2A Extension Payload (Prompt Opinion native)

Prompt Opinion routes FHIR context through the A2A v1.0 extension mechanism, using the published schema:

- **Schema URL:** [`https://app.promptopinion.ai/schemas/a2a/v1/fhir-context`](https://app.promptopinion.ai/schemas/a2a/v1/fhir-context)
- **Title:** `A2AFhirCtxPayloadModel`
- **JSON Schema draft:** `draft-04`

ARIA declares this extension as a supported (optional) extension on its agent card, so the platform knows it can be propagated. The extension entry in the agent card looks like this:

```json
{
  "uri": "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context",
  "description": "FHIR context allowing the agent to query a FHIR server securely",
  "required": false
}
```

### Schema Fields

The A2A FHIR Context payload accepts the following fields, copied verbatim from the schema:

| Field | Required | Type | Description |
|---|---|---|---|
| `fhirUrl` | **Yes** | string (`minLength: 1`) | The URL of the FHIR server to query. |
| `fhirToken` | No | string \| null | An optional bearer token allowing authorized access to the FHIR URL. |
| `fhirRefreshToken` | No | string \| null | An optional refresh token if the user authorized offline access. |
| `fhirRefreshTokenUrl` | No | string \| null | An optional URL where the refresh token can be exchanged for a new access token if the user authorized offline access. |
| `patientId` | No | string \| null | An optional scoped patient ID. *If the patient ID exists as a `patient` claim in the bearer token, it will take priority over this property.* |

`additionalProperties` is `false`, so any field not listed above is rejected by the schema validator.

### How ARIA Reads the Extension

The Python A2A handler (`agent/src/main.py`) inspects the inbound message's `extensions` map for the `https://app.promptopinion.ai/schemas/a2a/v1/fhir-context` key. When present, the values are merged into the request scoped context dict using these mappings:

| Extension field | Internal context key |
|---|---|
| `fhirUrl` | `server_url` |
| `fhirToken` | `bearer_token` |
| `fhirRefreshToken` | `refresh_token` |
| `fhirRefreshTokenUrl` | `refresh_token_url` |
| `patientId` | `patient_id` |

If the bearer token contains a `patient` claim (per SMART App Launch v2), ARIA prefers the claim value over the `patientId` field, matching the schema's stated precedence.

### Example A2A Message with FHIR Context Extension

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "message/send",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "m1",
      "parts": [
        { "text": "Analyze active medications for this patient" }
      ],
      "extensions": {
        "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context": {
          "fhirUrl":             "https://hapi.fhir.org/baseR4",
          "fhirToken":           "eyJhbGciOiJSUzI1NiIs...",
          "patientId":           "example-patient-1",
          "fhirRefreshToken":    "eyJhbGciOiJSUzI1NiIs...",
          "fhirRefreshTokenUrl": "https://auth.example.org/oauth2/token"
        }
      }
    }
  }
}
```

The example above uses the A2A v1.0 ProtoJSON wire format (`ROLE_USER` role enum, flat parts without a `kind` discriminator). The endpoint also accepts the legacy v0.3 shape (`"role": "user"`, `"kind": "message"` on the message, `"kind": "text"` on each part) for backward compatibility with clients that have not migrated yet.

## Channel 2: SHARP HTTP Headers

For compatibility with the [`sharp-on-fhir-mcp`](https://github.com/TerminallyLazy/sharp-on-fhir-mcp) reference server and any client that already targets that ecosystem, ARIA also accepts the same context as plain HTTP headers on every call into `/a2a/v1` and `/analyze`. ARIA's agent card advertises support under `capabilities.experimental.sharpExtensions`:

```json
{
  "experimental": {
    "sharpExtensions": {
      "supported": true,
      "headers": ["X-FHIR-Server-URL", "X-FHIR-Access-Token", "X-Patient-ID"],
      "specReference": "https://github.com/TerminallyLazy/sharp-on-fhir-mcp"
    }
  }
}
```

| Header | Required | Purpose | Example |
|---|---|---|---|
| `X-FHIR-Server-URL` | Optional | Base URL of the FHIR R4 endpoint to query. When present, it overrides the `FHIR_BASE_URL` environment variable for the lifetime of the request. | `https://hapi.fhir.org/baseR4` |
| `X-FHIR-Access-Token` | Optional | Bearer token authorized for the patient in scope. Sent as the raw token. ARIA strips a leading `Bearer ` if present, then prepends it once when calling FHIR, so callers can send either form. | `eyJhbGciOiJSUzI1NiIs...` |
| `X-Patient-ID` | Optional | FHIR `Patient.id` of the record in scope. When omitted, ARIA falls back to the `patient` claim in the token, then the `patientId` extension field, then `FHIR_DEFAULT_PATIENT_ID`. | `erXuFYUfucBZaryVksYEcMg3` |

All three headers are optional because ARIA also serves callers that do not run a SMART launch, such as the `/analyze` REST endpoint and local development against the HAPI sandbox. The fallback ladder below describes how missing values are resolved.

### Channel Precedence

When both channels are populated on the same request (for example, a misconfigured proxy that injects both), ARIA applies a deterministic precedence:

1. **A2A Extension payload** values take priority. The schema is the authoritative contract on the Prompt Opinion platform.
2. **SHARP headers** fill in any field the extension did not provide.
3. **Environment defaults** (`FHIR_BASE_URL`, `FHIR_DEFAULT_PATIENT_ID`) fill in anything still missing.

This means a Prompt Opinion call with a fully populated extension is unaffected by stray headers, and a sharp-on-fhir-mcp client without the extension still works as expected.

## Propagation Flow

### 1. Inbound: Prompt Opinion to ARIA Agent

When the Prompt Opinion orchestrator routes a user request to ARIA, it attaches the patient's FHIR context as an A2A extension on the message:

```
POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "message/send",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "m1",
      "extensions": {
        "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context": {
          "fhirUrl":   "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
          "fhirToken": "eyJhbGciOiJSUzI1NiIs...",
          "patientId": "erXuFYUfucBZaryVksYEcMg3"
        }
      },
      "parts": [{ "text": "{}" }]
    }
  }
}
```

The `_extract_fhir_context()` middleware in `agent/src/main.py` reads both channels (extension first, then headers) and stores the resolved values in a request scoped dict. `_merge_fhir_into_payload()` then folds the values into the message payload.

### 2. Inbound: SHARP Client to ARIA Agent

When the caller is a `sharp-on-fhir-mcp` style client, the same context arrives as headers:

```
POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1
Content-Type:        application/json
X-FHIR-Server-URL:   https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
X-FHIR-Access-Token: eyJhbGciOiJSUzI1NiIs...
X-Patient-ID:        erXuFYUfucBZaryVksYEcMg3

{ "jsonrpc": "2.0", "method": "message/send", ... }
```

After the merge step, the downstream pipeline cannot tell which channel was used, which is the whole point.

### 3. Agent to MCP Server

The LangGraph pipeline invokes the FHIR tool through `MCPClient.fhir_patient_medications(...)`, forwarding the resolved values as MCP tool arguments:

```python
await mcp_client.fhir_patient_medications(
    patient_id   = ctx["patient_id"],     # from patientId or X-Patient-ID
    bearer_token = ctx["bearer_token"],   # from fhirToken or X-FHIR-Access-Token
    server_url   = ctx["server_url"],     # from fhirUrl or X-FHIR-Server-URL
)
```

### 4. MCP Server to FHIR Server

The Rust MCP tool resolves the effective FHIR base URL with the priority `tool arg > FHIR_BASE_URL env var > public HAPI sandbox`, then issues:

```
GET {base_url}/MedicationRequest?patient={patient_id}&status=active&_count=50
Accept:        application/fhir+json
Authorization: Bearer {fhir_bearer_token}
```

The `Authorization` header is added only when the token is non empty. ARIA strips a single leading `Bearer ` from the token if present, then prepends it exactly once, so `Authorization: Bearer Bearer <token>` is impossible.

### 5. Lifetime

- Extension fields and headers are read on every request and never cached across requests.
- They are never persisted to disk, database, or logs. Only the presence of each value is logged, never the value itself.
- They are never forwarded to any third party service other than the FHIR endpoint identified by `fhirUrl` (or `X-FHIR-Server-URL`, or `FHIR_BASE_URL` as the fallback).

## The FHIR Tool Contract

The MCP tool `fhir_patient_medications` accepts the following input shape, defined in `mcp-server/src/tools/fhir_patient_medications.rs`:

```rust
pub struct FhirPatientMedicationsInput {
    /// Patient FHIR resource ID. Falls back to FHIR_DEFAULT_PATIENT_ID
    /// when empty. Sourced from patientId or X-Patient-ID at the agent layer.
    #[serde(default)]
    pub patient_id: String,

    /// Optional bearer token. Sourced from fhirToken or X-FHIR-Access-Token.
    /// When empty, no Authorization header is sent.
    #[serde(default)]
    pub fhir_bearer_token: String,

    /// Optional per-request FHIR base URL. Sourced from fhirUrl or
    /// X-FHIR-Server-URL. When empty, falls back to FHIR_BASE_URL.
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

ARIA degrades gracefully when FHIR context is missing, so that judges, CI pipelines, and local developers can exercise the pipeline without a full SMART launch.

The fallback ladder for the **FHIR endpoint**, in priority order:

1. `fhirUrl` field in the A2A extension payload.
2. `X-FHIR-Server-URL` header on the inbound A2A request.
3. The `FHIR_BASE_URL` environment variable on the MCP server.
4. The default `https://hapi.fhir.org/baseR4` baked into the MCP server.

The fallback ladder for **patient identification**:

1. `patient` claim inside the bearer token, when present (per SMART App Launch v2 and the schema's stated precedence).
2. `patientId` field in the A2A extension payload.
3. `X-Patient-ID` header on the inbound A2A request.
4. The `FHIR_DEFAULT_PATIENT_ID` environment variable on the MCP server.
5. An explicit error if none of the above are set.

The fallback ladder for **authorization**:

1. `fhirToken` field in the A2A extension payload.
2. `X-FHIR-Access-Token` header on the inbound A2A request.
3. No `Authorization` header is sent. The HAPI public sandbox accepts unauthenticated reads against synthetic data, which is what most reviewers and judges hit by default.

The fallback ladder for **token refresh** (when the access token expires mid-pipeline):

1. `fhirRefreshToken` plus `fhirRefreshTokenUrl` from the A2A extension payload, when both are present, are used to obtain a new access token via OAuth 2.0 refresh grant.
2. Otherwise, the request fails with a `401` and the upstream caller is expected to retry with a fresh access token. ARIA does not store refresh tokens beyond the request scope.

The most common reviewer flow does not exercise FHIR at all. It posts a plain medication list to `/analyze` (see Example C below) and the FHIR tool is never invoked.

## Worked Examples

### Example A: Prompt Opinion to production ARIA via A2A Extension

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "message/send",
    "params": {
      "message": {
        "role": "ROLE_USER",
        "messageId": "m1",
        "parts": [{ "text": "{}" }],
        "extensions": {
          "https://app.promptopinion.ai/schemas/a2a/v1/fhir-context": {
            "fhirUrl":   "https://hapi.fhir.org/baseR4",
            "patientId": "example-patient-1"
          }
        }
      }
    }
  }'
```

ARIA reads the extension, calls the HAPI sandbox for `MedicationRequest?patient=example-patient-1&status=active`, runs the pipeline against the returned active medications, and returns a structured clinical report.

### Example B: SHARP-style client to ARIA via HTTP headers

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/a2a/v1 \
  -H "Content-Type:        application/json" \
  -H "X-FHIR-Server-URL:   https://hapi.fhir.org/baseR4" \
  -H "X-Patient-ID:        example-patient-1" \
  -d '{
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "message/send",
    "params": { "message": { "role": "ROLE_USER", "messageId": "m1", "parts": [{ "text": "{}" }] } }
  }'
```

Identical behavior to Example A, just sourced from headers. The `sharp-on-fhir-mcp` reference server uses this exact shape.

### Example C: Standalone API call without any FHIR context

```bash
curl -s -X POST https://aria-a2a-agent-233281205053.asia-southeast2.run.app/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "medications": ["warfarin", "aspirin", "ibuprofen", "atorvastatin"],
    "patient":     {"age": 78, "sex": "male", "ckd_stage": 3}
  }'
```

No FHIR call is made. ARIA runs the pipeline directly on the inline medication list. This is the path most reviewers and judges use when evaluating the submission.

### Example D: Local development against the HAPI sandbox

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

ARIA is built around a small set of security invariants that hold regardless of which channel the caller uses.

**TLS is mandatory.** Cloud Run terminates HTTPS at the edge, and the MCP server only accepts traffic from the agent over HTTPS in production. Bearer tokens never travel over plain HTTP.

**Tokens are never logged.** Both the Python agent and the Rust MCP server log only the presence of `fhirToken` / `X-FHIR-Access-Token`, never its value. The same applies to refresh tokens. Cloud Run log retention in the `aria-2026-ai` project is configured accordingly.

**Tokens are never persisted.** They live in the memory of the request that brought them in, and they are dropped when the request scope ends. There is no database, no on disk cache, and no environment write back. Refresh tokens are likewise scope-limited: ARIA may exchange a refresh token for a new access token within the same request, but the refresh token itself is never stored.

**Patient identifiers never leave the tenant's FHIR server.** ARIA's pharmacology lookups (drug names, RxNorm codes, mechanism queries) operate on anonymized drug strings only. No patient identifier is sent to RxNorm, DrugBank, PubMed, or any other external service.

**Token scope is the upstream caller's responsibility.** ARIA assumes the bearer token, when supplied, is scoped at minimum for `MedicationRequest.read`. If the token is over scoped, that is a SMART launch configuration concern on the caller's side, not an ARIA concern.

**Patient claim in token takes priority over patientId field.** This matches the official Prompt Opinion schema and prevents a caller from supplying a `patientId` field that does not match the patient the token was actually issued for.

**No OAuth dance happens on the server.** Per SHARP §3.2, the MCP server never runs an OAuth flow itself, except for an in-request refresh token exchange when both `fhirRefreshToken` and `fhirRefreshTokenUrl` are supplied. This is what makes a single ARIA deployment vendor neutral across Epic, Cerner, MEDITECH, athenahealth, HAPI, and any other R4 endpoint.

**This submission uses only synthetic data.** All testing is against the public HAPI FHIR sandbox, which contains synthetic patient records. No real Protected Health Information is used anywhere in the system, in line with the hackathon's safety compliance requirements.

## Compatibility Matrix

| Client | Channel used | Notes |
|---|---|---|
| Prompt Opinion (production with SMART launch) | A2A Extension | Extension is populated automatically from the user's active SMART launch context. Refresh token is included when offline access was authorized. |
| Prompt Opinion (testing without SMART) | A2A Extension or none | The platform can be configured to forward a static dev token in the extension. Otherwise ARIA falls back to the inline `medications` field in the message payload. |
| `sharp-on-fhir-mcp` reference clients | SHARP headers | ARIA accepts the same header names as the reference server, so existing clients work without modification. |
| Generic A2A v1.0 client | Either, or none | A v1.0 client can populate the extension if it knows about the schema URI; otherwise ARIA returns whatever the inline pipeline can produce from the message payload. |
| `curl` or `httpie` for manual judge testing | Usually none | Most judges use the inline `/analyze` path (Example C). Examples A and B above show how to exercise both context channels manually. |

## References

- Prompt Opinion A2A FHIR Context schema: https://app.promptopinion.ai/schemas/a2a/v1/fhir-context
- SHARP on FHIR MCP reference implementation built for the same hackathon: https://github.com/TerminallyLazy/sharp-on-fhir-mcp
- A2A v1.0 protocol announcement: https://a2a-protocol.org/latest/announcing-1.0/
- SMART App Launch v2.2.0, including the `Authorization: Bearer` shape, the `patient` claim, and offline access semantics: https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html
- HL7 FHIR R4 RESTful API, including request and response shape: https://www.hl7.org/fhir/http.html