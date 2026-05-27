/**
 * Severity classification — single source of truth.
 *
 * IMPORTANT: this is the ONLY place the score-to-label mapping lives in the
 * frontend. Do not duplicate these thresholds anywhere else. The Rust MCP
 * server `score_risk.rs` mirrors this exact mapping so that all consumers
 * (Vercel UI, A2A agent, Prompt Opinion) report identical labels for the
 * same numeric score.
 *
 * Thresholds (inclusive lower bound, exclusive upper bound except for the top):
 *   0.0 – 2.0   → LOW
 *   2.0 – 5.0   → MODERATE
 *   5.0 – 8.5   → HIGH
 *   8.5 – 10.0  → CRITICAL
 */

export type SeverityLabel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export function getSeverityLabel(score: number): SeverityLabel {
  if (!Number.isFinite(score)) return "LOW";
  const s = Math.max(0, Math.min(10, score));
  if (s >= 8.5) return "CRITICAL";
  if (s >= 5.0) return "HIGH";
  if (s >= 2.0) return "MODERATE";
  return "LOW";
}

export function getSeverityColor(score: number): string {
  const label = getSeverityLabel(score);
  switch (label) {
    case "CRITICAL":
      return "#ff0040"; // bright red
    case "HIGH":
      return "#ef4444"; // red
    case "MODERATE":
      return "#f59e0b"; // amber
    case "LOW":
      return "#10b981"; // green
  }
}
