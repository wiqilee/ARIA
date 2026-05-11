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
  const [hovered, setHovered] = useState(false);
  const color = SEVERITY_COLORS[interaction.severity] || "#64748b";

  // Derive a few colour shades from the severity colour so every visual
  // accent (left bar, badge, pill, glow) stays in the same family.
  const glow = `${color}33`;
  const tintBg = `${color}0c`;
  const tintBorder = `${color}33`;
  const tintBorderStrong = `${color}66`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative rounded-xl overflow-hidden"
      style={{
        background: "rgba(8, 20, 37, 0.6)",
        border: `1px solid ${expanded || hovered ? tintBorderStrong : "rgba(0, 229, 255, 0.07)"}`,
        boxShadow:
          expanded || hovered
            ? `0 0 24px ${glow}, 0 8px 24px rgba(0, 0, 0, 0.25)`
            : "none",
        transform: hovered && !expanded ? "translateY(-2px)" : "translateY(0)",
        transition:
          "border-color 0.4s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Severity accent bar — a 3px stripe down the left edge that
          instantly signals priority. Critical/high cards now visually
          shout from across the report; low cards stay quiet. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "3px",
          background: `linear-gradient(180deg, ${color} 0%, ${color}66 100%)`,
          boxShadow: hovered || expanded ? `0 0 12px ${color}80` : "none",
          transition: "box-shadow 0.4s ease",
        }}
      />

      {/* Header — the entire row is the click target. */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `Collapse details for ${interaction.drugs.join(" and ")}`
            : `Expand details for ${interaction.drugs.join(" and ")}`
        }
        className="w-full p-5 pl-6 text-left flex items-start gap-4 cursor-pointer"
        style={{ background: "transparent" }}
      >
        {/* Severity dot — pulses subtly on hover so the user sees the
            card is interactive without us shouting about it. */}
        <motion.div
          animate={
            hovered
              ? { scale: [1, 1.15, 1], boxShadow: [`0 0 8px ${color}`, `0 0 14px ${color}`, `0 0 8px ${color}`] }
              : { scale: 1, boxShadow: `0 0 8px ${color}60` }
          }
          transition={{ duration: 1.6, repeat: hovered ? Infinity : 0, ease: "easeInOut" }}
          className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
          style={{ backgroundColor: color }}
        />

        <div className="flex-1 min-w-0">
          {/* Drug names */}
          <div className="flex flex-wrap gap-2 mb-2">
            {interaction.drugs.map((drug) => (
              <span
                key={drug}
                className="font-mono text-sm px-2 py-0.5 rounded"
                style={{
                  color: "#eaf0fa",
                  background: "rgba(2, 8, 23, 0.7)",
                  border: "1px solid rgba(0, 229, 255, 0.08)",
                }}
              >
                {drug}
              </span>
            ))}
          </div>

          {/* Description */}
          <p
            className="text-sm leading-relaxed line-clamp-2"
            style={{ color: "#c4d0e4" }}
          >
            {interaction.description}
          </p>

          {/* Badges row */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span
              className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 rounded"
              style={{
                color,
                background: tintBg,
                border: `1px solid ${tintBorder}`,
                letterSpacing: "0.12em",
              }}
            >
              {interaction.severity}
            </span>

            <span
              className="text-[11px]"
              style={{
                color: "#7a8ba8",
                fontFamily: "var(--font-mono, ui-monospace)",
              }}
            >
              {interaction.interaction_type}
            </span>

            {interaction.evidence_grade && (
              <EvidenceBadge
                grade={interaction.evidence_grade}
                confidence={interaction.confidence_score}
                compact
              />
            )}

            {/* Hover-revealed hint — the secondary affordance. It only
                fades in on hover so it doesn't add clutter in the resting
                state. Combined with the always-visible "Details" pill on
                the right, the user gets two clear cues that the card is
                interactive. */}
            <AnimatePresence>
              {hovered && !expanded && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.25 }}
                  className="text-[10px] ml-auto hidden md:inline"
                  style={{
                    color: `${color}cc`,
                    fontFamily: "var(--font-mono, ui-monospace)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Click to see mechanism, evidence &amp; risk factors →
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Risk score */}
        {riskScore && (
          <div className="flex-shrink-0 w-16">
            <SeverityMeter value={riskScore.adjusted_score} size="sm" />
          </div>
        )}

        {/* "Details" pill — always-visible affordance.
            This is the primary cue that the card expands. Severity-coloured
            so it reads as part of the card's identity. Animates rotation +
            label change between collapsed/expanded states. */}
        <motion.div
          animate={{
            backgroundColor: hovered || expanded ? tintBg : "rgba(2, 8, 23, 0.5)",
            borderColor: hovered || expanded ? tintBorderStrong : "rgba(0, 229, 255, 0.12)",
          }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-md mt-0.5"
          style={{
            border: "1px solid",
            fontFamily: "var(--font-mono, ui-monospace)",
          }}
        >
          <span
            className="text-[10px] uppercase tracking-widest hidden sm:inline"
            style={{
              color: hovered || expanded ? color : "#7a8ba8",
              transition: "color 0.3s ease",
              letterSpacing: "0.14em",
            }}
          >
            {expanded ? "Hide" : "Details"}
          </span>
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.3 }}
            className="text-xs"
            style={{
              color: hovered || expanded ? color : "#7a8ba8",
              transition: "color 0.3s ease",
            }}
          >
            ▾
          </motion.span>
        </motion.div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {/* Section divider — gradient line that matches severity colour
                so the expanded panel feels visually connected to the header. */}
            <div
              style={{
                height: "1px",
                background: `linear-gradient(90deg, transparent 0%, ${color}55 20%, ${color}55 80%, transparent 100%)`,
                margin: "0 1.25rem",
              }}
            />

            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
              }}
              className="px-5 pl-6 pb-5 pt-5 space-y-5"
            >
              {/* Mechanism */}
              {interaction.mechanism && (
                <DetailSection title="Mechanism" accent={color}>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "#d0daea" }}
                  >
                    {interaction.mechanism}
                  </p>
                </DetailSection>
              )}

              {/* Clinical significance */}
              {interaction.clinical_significance && (
                <DetailSection title="Clinical Significance" accent={color}>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "#d0daea" }}
                  >
                    {interaction.clinical_significance}
                  </p>
                </DetailSection>
              )}

              {/* Risk factors */}
              {riskScore && riskScore.risk_factors.length > 0 && (
                <DetailSection title="Patient Risk Factors" accent={color}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {riskScore.risk_factors.map((rf, i) => {
                      const isAmplifier = rf.multiplier > 1.0;
                      const rfColor =
                        rf.multiplier > 1.5
                          ? "#ef4444"
                          : isAmplifier
                            ? "#f59e0b"
                            : "#10b981";
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-md"
                          style={{
                            background: `${rfColor}0c`,
                            border: `1px solid ${rfColor}26`,
                            transition:
                              "background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = `${rfColor}1c`;
                            e.currentTarget.style.borderColor = `${rfColor}55`;
                            e.currentTarget.style.boxShadow = `0 0 12px ${rfColor}26`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = `${rfColor}0c`;
                            e.currentTarget.style.borderColor = `${rfColor}26`;
                            e.currentTarget.style.boxShadow = "none";
                          }}
                          title={
                            rf.explanation ||
                            `${rf.factor} multiplies risk by ${rf.multiplier.toFixed(1)}×`
                          }
                        >
                          <span
                            className="text-xs truncate"
                            style={{ color: "#c4d0e4" }}
                          >
                            {rf.factor}
                          </span>
                          <span
                            className="font-mono text-[11px] font-bold flex-shrink-0"
                            style={{ color: rfColor }}
                          >
                            ×{rf.multiplier.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </DetailSection>
              )}

              {/* PubMed links */}
              {interaction.pubmed_ids.length > 0 && (
                <DetailSection title="Evidence" accent={color}>
                  <div className="flex flex-wrap gap-2">
                    {interaction.pubmed_ids.map((pmid) => (
                      <a
                        key={pmid}
                        href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[11px] px-2.5 py-1 rounded transition-all duration-200"
                        style={{
                          color: "var(--primary, #06b6d4)",
                          background: "rgba(0, 229, 255, 0.06)",
                          border: "1px solid rgba(0, 229, 255, 0.15)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor =
                            "rgba(0, 229, 255, 0.45)";
                          e.currentTarget.style.boxShadow =
                            "0 0 14px rgba(0, 229, 255, 0.2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor =
                            "rgba(0, 229, 255, 0.15)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        📎 PMID:{pmid}
                      </a>
                    ))}
                  </div>
                </DetailSection>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Section block with accent line + animated stagger ──────────
   Used inside the expanded panel. The accent line replaces the
   plain uppercase headers with something more deliberate — a
   short coloured tick + label + thin gradient rule across the
   width, so each section feels like a deliberate "chapter".
*/
function DetailSection({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span
          aria-hidden
          style={{
            width: "10px",
            height: "2px",
            background: accent,
            borderRadius: "1px",
            boxShadow: `0 0 6px ${accent}80`,
          }}
        />
        <h4
          className="font-display font-semibold text-[10px] uppercase"
          style={{
            color: "#8a9bba",
            letterSpacing: "0.18em",
          }}
        >
          {title}
        </h4>
        <span
          aria-hidden
          className="flex-1"
          style={{
            height: "1px",
            background: `linear-gradient(90deg, ${accent}33 0%, transparent 100%)`,
          }}
        />
      </div>
      {children}
    </motion.div>
  );
}
