"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { InteractionCard } from "./InteractionCard";
import { DeprescribingStep } from "./DeprescribingStep";
import type { AnalyzeResponse } from "@/lib/types";

interface RiskReportProps {
  data: AnalyzeResponse;
}

const BURDEN_LEVEL_COLORS: Record<string, string> = {
  low: "var(--success)",
  moderate: "var(--warning)",
  high: "var(--danger)",
  critical: "#ff0040",
};

const BURDEN_EXPLANATIONS: Record<string, Record<string, string>> = {
  anticholinergic: {
    low: "Minimal anticholinergic effects expected.",
    moderate: "May cause dry mouth, constipation, or mild confusion — monitor cognitive function.",
    high: "Significant anticholinergic load — risk of delirium, falls, and cognitive decline. Deprescribing review strongly recommended.",
  },
  sedation: {
    low: "Low sedation risk with current regimen.",
    moderate: "Additive sedation possible — caution with driving and operating machinery.",
    high: "High sedation load — significant fall risk and respiratory depression concern, especially in elderly patients.",
  },
  qt: {
    low: "Low QT prolongation risk.",
    moderate: "Moderate QT risk — consider baseline ECG and electrolyte monitoring.",
    high: "Significant QT prolongation risk — ECG monitoring required. Avoid additional QT-prolonging agents.",
  },
};

// Placeholder strings the upstream agent sometimes emits when it defers
// the real summary to the full report. We treat these as "no summary" so
// the section is either hidden or filled with a smarter fallback.
const SUMMARY_PLACEHOLDERS = [
  "see full report below",
  "see full report",
  "see report below",
  "see below",
  "n/a",
  "none",
  "tbd",
];

function isPlaceholderSummary(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return true;
  if (t.length < 30) {
    // very short text is almost always a placeholder, not a real summary
    return SUMMARY_PLACEHOLDERS.some((p) => t.includes(p));
  }
  return false;
}

// Build a one-paragraph fallback summary from the structured data we do have,
// so the Interaction Summary card is always meaningful instead of saying
// "See full report below".
function buildFallbackSummary(
  interactions: any[],
  criticalFindings: string[],
): string {
  if (interactions.length === 0 && criticalFindings.length === 0) return "";

  const sevCount: Record<string, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const ix of interactions) {
    const s = (ix.severity || "").toLowerCase();
    if (s in sevCount) sevCount[s]++;
  }

  const parts: string[] = [];
  parts.push(`${interactions.length} drug-drug interaction${interactions.length === 1 ? "" : "s"} detected`);

  const bits: string[] = [];
  if (sevCount.critical) bits.push(`${sevCount.critical} critical`);
  if (sevCount.high) bits.push(`${sevCount.high} high`);
  if (sevCount.moderate) bits.push(`${sevCount.moderate} moderate`);
  if (sevCount.low) bits.push(`${sevCount.low} low`);
  if (bits.length) parts.push(`(${bits.join(", ")})`);

  if (criticalFindings.length) {
    parts.push(`— ${criticalFindings.length} critical finding${criticalFindings.length === 1 ? "" : "s"} flagged`);
  }

  return parts.join(" ") + ". See detailed breakdown below.";
}

export function RiskReport({ data }: RiskReportProps) {
  const { report, deprescribing_plan, raw_interactions } = data;
  const [showRawReport, setShowRawReport] = useState(false);

  if (!report) {
    return (
      <div
        className="text-center py-16"
        style={{ color: "#6b7f9e" }}
      >
        No report data available.
      </div>
    );
  }

  const interactions = raw_interactions?.interactions ?? [];
  const criticalFindings = Array.isArray(report.critical_findings)
    ? report.critical_findings
    : [];
  const burdenScores = report.burden_scores || null;
  const riskScores = Array.isArray(report.risk_scores)
    ? report.risk_scores
    : [];
  const evidenceCitations = Array.isArray(report.evidence_citations)
    ? report.evidence_citations
    : [];

  // Resolve the interaction summary: use the agent's own text when it's
  // meaningful, otherwise synthesise one from the structured findings.
  const rawSummary = (report.interaction_summary || "").trim();
  const interactionSummary = useMemo(() => {
    if (rawSummary && !isPlaceholderSummary(rawSummary)) return rawSummary;
    return buildFallbackSummary(interactions, criticalFindings);
  }, [rawSummary, interactions, criticalFindings]);

  return (
    <div className="space-y-5">
      {/* Critical Findings */}
      {criticalFindings.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl p-5"
          style={{
            background: "rgba(255, 23, 68, 0.04)",
            border: "1px solid rgba(255, 23, 68, 0.15)",
            transition: "all 0.4s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(255, 23, 68, 0.3)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(255, 23, 68, 0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255, 23, 68, 0.15)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-3"
            style={{ color: "var(--danger)" }}
          >
            ⚠ Critical Findings ({criticalFindings.length})
          </h3>
          <div className="space-y-2">
            {criticalFindings.map((f: string, i: number) => (
              <div
                key={i}
                className="text-sm flex gap-2 leading-relaxed"
                style={{ color: "#d0daea" }}
              >
                <span style={{ color: "var(--danger)" }} className="shrink-0 mt-0.5">
                  ●
                </span>
                {f}
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* Interaction Summary */}
      {interactionSummary && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-panel p-5"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.22)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.08)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.07)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={{ transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-2"
            style={{ color: "#8a9bba" }}
          >
            Interaction Summary
          </h3>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "#d0daea" }}
          >
            {interactionSummary}
          </p>
        </motion.section>
      )}

      {/* Cumulative Burden Scores */}
      {burdenScores && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-5"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.22)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.08)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.07)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={{ transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-4"
            style={{ color: "#8a9bba" }}
          >
            Cumulative Burden Scores
          </h3>
          {/* `items-stretch` forces every card in the grid to share the row
              height, so the borders align on top AND bottom regardless of
              how much copy lives inside each card. */}
          <div className="grid sm:grid-cols-3 gap-3 items-stretch">
            {burdenScores.anticholinergic_burden && (
              <BurdenCard
                label="Anticholinergic"
                detail={burdenScores.anticholinergic_burden}
                type="anticholinergic"
              />
            )}
            {burdenScores.sedation_load && (
              <BurdenCard
                label="Sedation"
                detail={burdenScores.sedation_load}
                type="sedation"
              />
            )}
            {burdenScores.qt_prolongation_risk && (
              <BurdenCard
                label="QT Prolongation"
                detail={burdenScores.qt_prolongation_risk}
                type="qt"
              />
            )}
          </div>
          {burdenScores.total_burden_summary && (
            <p
              className="text-xs mt-3 leading-relaxed"
              style={{ color: "#8a9bba" }}
            >
              {burdenScores.total_burden_summary}
            </p>
          )}
        </motion.section>
      )}

      {/* Detected Interactions */}
      {interactions.length > 0 && (
        <section>
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-4"
            style={{ color: "#8a9bba" }}
          >
            Detected Interactions ({interactions.length})
          </h3>
          <div className="space-y-3">
            {interactions.map((interaction: any, i: number) => (
              <InteractionCard
                key={interaction.id || i}
                interaction={interaction}
                riskScore={riskScores.find(
                  (rs: any) => rs.interaction_id === interaction.id,
                )}
                index={i}
              />
            ))}
          </div>
        </section>
      )}

      {/* Per-Interaction Risk Scores */}
      {riskScores.length > 0 && interactions.length === 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-5"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.22)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.08)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.07)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={{ transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-3"
            style={{ color: "#8a9bba" }}
          >
            Risk Scores
          </h3>
          <div className="space-y-3">
            {riskScores.map((rs: any, i: number) => (
              <div
                key={i}
                className="p-3 rounded-lg"
                style={{
                  background: "rgba(3, 11, 26, 0.5)",
                  border: "1px solid var(--border)",
                  transition: "all 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,229,255,0.18)";
                  e.currentTarget.style.boxShadow = "0 0 16px rgba(0,229,255,0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-sm font-mono"
                    style={{ color: "#d0daea" }}
                  >
                    {(rs.drugs ?? []).join(" + ")}
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span
                      className="text-lg font-bold font-mono"
                      style={{
                        color:
                          rs.adjusted_score > 7
                            ? "var(--danger)"
                            : rs.adjusted_score > 4
                              ? "var(--warning)"
                              : "var(--primary)",
                      }}
                    >
                      {rs.adjusted_score?.toFixed(1) ?? "—"}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "#6b7f9e" }}
                    >
                      /10
                    </span>
                  </div>
                </div>
                {rs.base_score !== rs.adjusted_score && (
                  <p className="text-[10px]" style={{ color: "#7a8ba8" }}>
                    Base score: {rs.base_score?.toFixed(1)} → Adjusted for patient phenotype: {rs.adjusted_score?.toFixed(1)}
                  </p>
                )}
                {rs.reasoning && (
                  <p
                    className="text-xs mt-1 leading-relaxed"
                    style={{ color: "#94a8c8" }}
                  >
                    {rs.reasoning}
                  </p>
                )}
                {rs.risk_factors && rs.risk_factors.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rs.risk_factors.map((rf: any, j: number) => (
                      <span
                        key={j}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          color: rf.multiplier > 1.5 ? "var(--danger)" : "var(--warning)",
                          background:
                            rf.multiplier > 1.5
                              ? "rgba(255, 23, 68, 0.08)"
                              : "rgba(255, 171, 0, 0.08)",
                          border: `1px solid ${rf.multiplier > 1.5 ? "rgba(255, 23, 68, 0.15)" : "rgba(255, 171, 0, 0.15)"}`,
                        }}
                        title={rf.explanation}
                      >
                        {rf.factor} ×{rf.multiplier?.toFixed(1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* Deprescribing Plan */}
      {deprescribing_plan &&
        Array.isArray(deprescribing_plan.steps) &&
        deprescribing_plan.steps.length > 0 && (
          <section>
            <h3
              className="font-display font-semibold text-xs uppercase tracking-wider mb-4"
              style={{ color: "#8a9bba" }}
            >
              Deprescribing Plan
            </h3>
            {deprescribing_plan.summary && (
              <p
                className="text-sm mb-3 leading-relaxed"
                style={{ color: "#94a8c8" }}
              >
                {deprescribing_plan.summary}
              </p>
            )}
            <div className="space-y-3">
              {deprescribing_plan.steps.map((step: any, i: number) => (
                <DeprescribingStep key={i} step={step} index={i} />
              ))}
            </div>

            {/* Total expected risk reduction — promoted from a floating
                line into a proper banner card so it visually anchors the
                deprescribing plan. */}
            <div
              className="mt-4 p-4 rounded-lg flex items-center justify-between gap-4"
              style={{
                background: "rgba(0, 230, 118, 0.06)",
                border: "1px solid rgba(0, 230, 118, 0.18)",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 230, 118, 0.35)";
                e.currentTarget.style.boxShadow = "0 0 18px rgba(0, 230, 118, 0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 230, 118, 0.18)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div
                className="text-[11px] uppercase tracking-wider"
                style={{ color: "#7a8ba8", fontFamily: "var(--font-mono)" }}
              >
                Total expected risk reduction
              </div>
              <div
                className="text-2xl font-bold font-mono"
                style={{ color: "var(--success)" }}
              >
                −
                {(
                  deprescribing_plan.total_expected_risk_reduction || 0
                ).toFixed(0)}
                %
              </div>
            </div>

            {deprescribing_plan.warnings &&
              deprescribing_plan.warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {deprescribing_plan.warnings.map((w: string, i: number) => (
                    <p
                      key={i}
                      className="text-xs"
                      style={{ color: "var(--warning)" }}
                    >
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}
          </section>
        )}

      {/* Evidence Citations */}
      {evidenceCitations.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-5"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.22)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.08)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.07)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={{ transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <h3
            className="font-display font-semibold text-xs uppercase tracking-wider mb-3"
            style={{ color: "#8a9bba" }}
          >
            Evidence Citations ({evidenceCitations.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {evidenceCitations.map((c: string, i: number) => {
              const isPubMed = /^\d{7,8}$/.test(c.trim()) || c.toLowerCase().includes("pubmed");
              const pubmedId = c.match(/\d{7,8}/)?.[0];

              return isPubMed && pubmedId ? (
                <a
                  key={i}
                  href={`https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2 py-1 rounded transition-all duration-200"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--primary)",
                    background: "var(--primary-dim)",
                    border: "1px solid rgba(0, 229, 255, 0.1)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.3)";
                    e.currentTarget.style.boxShadow = "0 0 12px rgba(0, 229, 255, 0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.1)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  title={`Open PubMed ${pubmedId}`}
                >
                  📎 PMID:{pubmedId}
                </a>
              ) : (
                <span
                  key={i}
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--primary)",
                    background: "var(--primary-dim)",
                    border: "1px solid rgba(0, 229, 255, 0.1)",
                  }}
                >
                  📎 {c}
                </span>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* Full Report Text — now collapsible.
          The agent often returns a pretty-printed JSON dump here, which is
          informative for debugging but ugly inline. Hidden by default. */}
      {report.report_text && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-5"
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.22)";
            e.currentTarget.style.boxShadow = "0 0 20px rgba(0, 229, 255, 0.08)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.07)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "translateY(0)";
          }}
          style={{ transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <h3
              className="font-display font-semibold text-xs uppercase tracking-wider"
              style={{ color: "#8a9bba" }}
            >
              Full Report
            </h3>
            <button
              type="button"
              onClick={() => setShowRawReport((v) => !v)}
              className="text-[11px] px-2.5 py-1 rounded transition-all duration-200"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--primary)",
                background: "var(--primary-dim)",
                border: "1px solid rgba(0, 229, 255, 0.18)",
                cursor: "pointer",
                letterSpacing: "1px",
                textTransform: "uppercase",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.4)";
                e.currentTarget.style.boxShadow = "0 0 12px rgba(0, 229, 255, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.18)";
                e.currentTarget.style.boxShadow = "none";
              }}
              aria-expanded={showRawReport}
            >
              {showRawReport ? "▾ Hide raw" : "▸ Show raw"}
            </button>
          </div>

          {!showRawReport && (
            <p
              className="text-xs leading-relaxed"
              style={{ color: "#7a8ba8" }}
            >
              Raw report payload from the agent ({report.report_text.length.toLocaleString()} characters). Hidden by default for readability — expand to inspect.
            </p>
          )}

          {showRawReport && (
            <pre
              className="text-[11px] leading-relaxed whitespace-pre-wrap overflow-x-auto rounded-md p-3"
              style={{
                color: "#c4d0e4",
                background: "rgba(3, 11, 26, 0.6)",
                border: "1px solid rgba(0, 229, 255, 0.07)",
                fontFamily: "var(--font-mono)",
                maxHeight: "480px",
                overflowY: "auto",
              }}
            >
              {report.report_text}
            </pre>
          )}
        </motion.section>
      )}

      {/* Disclaimer — readable color */}
      <div
        className="text-center text-[11px] pt-4 pb-2 leading-relaxed"
        style={{ color: "#7a8ba8" }}
      >
        This report is generated by an AI clinical reasoning engine for informational purposes only.
        All findings should be reviewed by a qualified healthcare professional.
      </div>
    </div>
  );
}

// ── Burden Card with hover animation ────────────────────────

function BurdenCard({
  label,
  detail,
  type,
}: {
  label: string;
  detail: any;
  type: "anticholinergic" | "sedation" | "qt";
}) {
  const riskLevel = (detail?.risk_level || "low").toLowerCase();
  const color = BURDEN_LEVEL_COLORS[riskLevel] || "#6b7f9e";

  const interpretation =
    detail?.clinical_implication ||
    BURDEN_EXPLANATIONS[type]?.[riskLevel] ||
    "No additional information available.";

  const contributors = Array.isArray(detail?.per_drug) ? detail.per_drug : [];

  return (
    // `h-full flex flex-col` lets the card fill the grid row height the
    // parent enforces with `items-stretch`. The contributor list is pinned
    // to the bottom with `mt-auto` so all three cards share the same baseline.
    <div
      className="p-4 rounded-lg h-full flex flex-col"
      style={{
        background: "rgba(3, 11, 26, 0.5)",
        border: `1px solid ${riskLevel === "high" || riskLevel === "critical" ? "rgba(255, 23, 68, 0.15)" : "var(--border)"}`,
        transition: "all 0.3s ease",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = `${color}44`;
        el.style.boxShadow = `0 0 16px ${color}15`;
        el.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = riskLevel === "high" || riskLevel === "critical" ? "rgba(255, 23, 68, 0.15)" : "var(--border)";
        el.style.boxShadow = "none";
        el.style.transform = "translateY(0)";
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider mb-2"
        style={{ color: "#7a8ba8" }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="font-display font-bold text-2xl"
          style={{ color }}
        >
          {(detail?.total_score ?? 0).toFixed(1)}
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color }}
        >
          {riskLevel}
        </span>
      </div>
      {/* Mini risk bar */}
      <div
        className="h-1 rounded-full overflow-hidden my-2"
        style={{ background: "rgba(15, 23, 42, 0.8)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min((detail?.total_score ?? 0) * 10, 100)}%`,
            background: color,
          }}
        />
      </div>
      <p
        className="text-[11px] leading-snug"
        style={{ color: "#8a9bba" }}
      >
        {interpretation}
      </p>
      {/* Top contributors — pinned to the bottom so cards align */}
      {contributors.length > 0 && (
        <div className="mt-auto pt-2 space-y-0.5">
          {contributors.slice(0, 3).map((c: any, i: number) => (
            <div
              key={i}
              className="flex items-center justify-between text-[10px]"
            >
              <span style={{ color: "#94a8c8" }}>{c.drug_name}</span>
              <span
                className="font-mono"
                style={{ color }}
              >
                +{c.contribution?.toFixed(1) ?? "?"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
