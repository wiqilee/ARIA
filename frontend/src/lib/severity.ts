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

/** Clamp any input score into the valid [0, 10] range. Out-of-range values
 *  (NaN, negatives, scores >10 emitted by a buggy upstream tool) are
 *  silently brought back into the band so the UI never displays "15.3/10"
 *  or "-2.5/10". */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(10, score));
}

export function getSeverityLabel(score: number): SeverityLabel {
  const s = clampScore(score);
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

/** Translucent background color suitable for highlight cards / pill chips. */
export function getSeverityBgColor(score: number): string {
  const label = getSeverityLabel(score);
  switch (label) {
    case "CRITICAL":
      return "rgba(255, 0, 64, 0.10)";
    case "HIGH":
      return "rgba(239, 68, 68, 0.10)";
    case "MODERATE":
      return "rgba(245, 158, 11, 0.10)";
    case "LOW":
      return "rgba(16, 185, 129, 0.10)";
  }
}

/** Human-friendly clinical interpretation for the "Overall Risk Assessment"
 *  banner. Matches the wording used in the HTML/PDF export, but always
 *  derived from the *numeric* score — never from an LLM-provided label. */
export function getSeverityInterpretation(score: number): string {
  switch (getSeverityLabel(score)) {
    case "CRITICAL":
      return "Immediate intervention required. High probability of severe adverse drug events without prompt action.";
    case "HIGH":
      return "Significant clinical concern. Active intervention, deprescribing, or substitution strongly advised.";
    case "MODERATE":
      return "Enhanced monitoring recommended. Consider dose adjustments or alternative therapies if risk factors change.";
    case "LOW":
      return "Minimal clinical concern. Standard monitoring protocols are adequate.";
  }
}

/** The canonical Score Scale Reference used by the right-rail card on the
 *  Report page. Exactly four bands — one per severity label — so the
 *  highlighted row, the big numeric score, and the interpretation banner
 *  always agree. This replaces the previous 5-band "0-2 / 3-4 / 5-6 / 7-8
 *  / 9-10" scale, which silently disagreed with the README thresholds. */
export const SCORE_SCALE_REFERENCE: ReadonlyArray<{
  range: string;
  min: number;
  max: number;
  label: SeverityLabel;
  color: string;
  desc: string;
}> = [
  {
    range: "0.0 – 2.0",
    min: 0.0,
    max: 2.0,
    label: "LOW",
    color: "#10b981",
    desc: "Minimal risk. Routine monitoring sufficient. No immediate intervention needed.",
  },
  {
    range: "2.0 – 5.0",
    min: 2.0,
    max: 5.0,
    label: "MODERATE",
    color: "#f59e0b",
    desc: "Enhanced monitoring recommended. Consider dose adjustments or alternative therapies if risk factors change.",
  },
  {
    range: "5.0 – 8.5",
    min: 5.0,
    max: 8.5,
    label: "HIGH",
    color: "#ef4444",
    desc: "Significant danger. Active intervention, deprescribing, or substitution strongly advised.",
  },
  {
    range: "8.5 – 10.0",
    min: 8.5,
    max: 10.0,
    label: "CRITICAL",
    color: "#ff0040",
    desc: "Immediate action required. High probability of severe adverse events without prompt change.",
  },
];

/** Convert a string label (low / moderate / high / critical, any casing) to
 *  a numeric midpoint of its band. Used as a fallback when the only thing
 *  we have is a label (e.g. legacy LLM response field). Prefer feeding the
 *  numeric score directly whenever possible. */
export function scoreFromLabel(label: string | undefined | null): number {
  switch ((label ?? "").toUpperCase()) {
    case "CRITICAL":
      return 9.25; // midpoint of 8.5–10
    case "HIGH":
      return 6.75; // midpoint of 5–8.5
    case "MODERATE":
      return 3.5; // midpoint of 2–5
    case "LOW":
      return 1.0; // midpoint of 0–2
    default:
      return 3.5;
  }
}
