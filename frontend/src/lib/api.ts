/**
 * ARIA Frontend API Client — typed HTTP calls to the agent.
 */

import type { AnalyzeRequest, AnalyzeResponse } from "./types";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8000";

class APIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

/**
 * Run a full polypharmacy analysis.
 */
export async function analyzePolypharmacy(
  request: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  const url = `${AGENT_URL}/analyze`;

  let lastError: Error | null = null;

  // Retry up to 2 times
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new APIError(
          `Analysis failed: ${resp.status} ${body}`,
          resp.status,
        );
      }

      return (await resp.json()) as AnalyzeResponse;
    } catch (err) {
      lastError = err as Error;
      if (attempt < 2) {
        // Wait 1s before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error("Analysis failed after retries");
}

/**
 * Check agent health.
 */
export async function checkHealth(): Promise<{
  status: string;
  mcp_server: string;
}> {
  const resp = await fetch(`${AGENT_URL}/health`);
  return resp.json();
}
