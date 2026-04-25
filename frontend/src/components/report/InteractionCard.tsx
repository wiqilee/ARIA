"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EvidenceBadge } from "./EvidenceBadge";
import { SeverityMeter } from "./SeverityMeter";
import type { Interaction, RiskScore } from "@/lib/types";

const SEVERITY_COLORS: Record<string, string> = {
  low: "#10b981",
  moderate: "#f59e0b",
  high: "#ef4444",
  critical: "#ff0040",
};

interface InteractionCardProps {
  interaction: Interaction;
  riskScore?: RiskScore;
  index: number;
}

export function InteractionCard({
  interaction,
  riskScore,
  index,
}: InteractionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = SEVERITY_COLORS[interaction.severity] || "#64748b";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      className="rounded-xl bg-surface/60 border overflow-hidden transition-all duration-300 hover:-translate-y-0.5"
      style={{
        borderColor: expanded ? `${color}40` : "var(--border, #1e3a5f)",
        boxShadow: expanded ? `0 0 20px ${color}15` : "none",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 text-left flex items-start gap-4"
      >
        {/* Severity indicator */}
        <div
          className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}60` }}
        />

        <div className="flex-1 min-w-0">
          {/* Drug names */}
          <div className="flex flex-wrap gap-2 mb-2">
            {interaction.drugs.map((drug) => (
              <span
                key={drug}
                className="font-mono text-sm text-text-primary bg-background/50 px-2 py-0.5 rounded"
              >
                {drug}
              </span>
            ))}
          </div>

          {/* Description */}
          <p className="text-text-secondary text-sm leading-relaxed line-clamp-2">
            {interaction.description}
          </p>

          {/* Badges row */}
          <div className="flex items-center gap-3 mt-3">
            <span
              className="text-xs font-semibold uppercase px-2 py-0.5 rounded"
              style={{
                color,
                backgroundColor: `${color}15`,
              }}
            >
              {interaction.severity}
            </span>

            <span className="text-text-muted text-xs">
              {interaction.interaction_type}
            </span>

            {interaction.evidence_grade && (
              <EvidenceBadge
                grade={interaction.evidence_grade}
                confidence={interaction.confidence_score}
                compact
              />
            )}
          </div>
        </div>

        {/* Risk score */}
        {riskScore && (
          <div className="flex-shrink-0 w-16">
            <SeverityMeter value={riskScore.adjusted_score} size="sm" />
          </div>
        )}

        {/* Expand chevron */}
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          className="text-text-muted text-sm mt-1"
        >
          ▾
        </motion.span>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-0 border-t border-border/50 space-y-4">
              {/* Mechanism */}
              {interaction.mechanism && (
                <div className="pt-4">
                  <h4 className="font-display font-semibold text-xs uppercase tracking-wider text-text-muted mb-2">
                    Mechanism
                  </h4>
                  <p className="text-text-secondary text-sm">
                    {interaction.mechanism}
                  </p>
                </div>
              )}

              {/* Clinical significance */}
              {interaction.clinical_significance && (
                <div>
                  <h4 className="font-display font-semibold text-xs uppercase tracking-wider text-text-muted mb-2">
                    Clinical Significance
                  </h4>
                  <p className="text-text-secondary text-sm">
                    {interaction.clinical_significance}
                  </p>
                </div>
              )}

              {/* Risk factors */}
              {riskScore && riskScore.risk_factors.length > 0 && (
                <div>
                  <h4 className="font-display font-semibold text-xs uppercase tracking-wider text-text-muted mb-2">
                    Patient Risk Factors
                  </h4>
                  <div className="space-y-1">
                    {riskScore.risk_factors.map((rf, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-text-secondary">
                          {rf.factor}
                        </span>
                        <span className="font-mono text-warning text-xs">
                          ×{rf.multiplier.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PubMed links */}
              {interaction.pubmed_ids.length > 0 && (
                <div>
                  <h4 className="font-display font-semibold text-xs uppercase tracking-wider text-text-muted mb-2">
                    Evidence
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {interaction.pubmed_ids.map((pmid) => (
                      <a
                        key={pmid}
                        href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary hover:text-primary/80 underline underline-offset-2"
                      >
                        PMID:{pmid}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
