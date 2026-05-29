"use client";

import { motion } from "framer-motion";
import type { DeprescribingStep as DeprescribingStepType } from "@/lib/types";

const ACTION_STYLES: Record<string, { color: string; bg: string; icon: string }> = {
  discontinue: { color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", icon: "⛔" },
  reduce: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.1)", icon: "↓" },
  substitute: { color: "#06b6d4", bg: "rgba(6, 182, 212, 0.1)", icon: "↔" },
};

interface DeprescribingStepProps {
  step: DeprescribingStepType;
  index: number;
}

export function DeprescribingStep({ step, index }: DeprescribingStepProps) {
  const style = ACTION_STYLES[step.action] || ACTION_STYLES.substitute;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="flex gap-4 p-4 rounded-xl transition-all"
      style={{
        // Each card gets a visible, action-tinted border + a strong colored
        // left edge so aspirin / digoxin / omeprazole are obviously
        // separate blocks instead of bleeding into one another. Previously
        // the card used `bg-surface/40 border-border` which rendered the
        // border at ~#1e3a5f against a near-black bg — effectively
        // invisible.
        background: "rgba(15, 23, 42, 0.55)",
        border: `1px solid ${style.color}40`,
        borderLeft: `3px solid ${style.color}`,
        boxShadow: `0 0 0 1px ${style.color}10`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${style.color}80`;
        e.currentTarget.style.boxShadow = `0 0 14px ${style.color}22`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = `${style.color}40`;
        e.currentTarget.style.boxShadow = `0 0 0 1px ${style.color}10`;
      }}
    >
      {/* Priority number */}
      <div className="flex-shrink-0 flex flex-col items-center">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm"
          style={{ color: style.color, backgroundColor: style.bg }}
        >
          {step.priority}
        </div>
        {/* Vertical connector line */}
        <div className="w-px flex-1 mt-2" style={{ background: "rgba(30, 58, 95, 0.6)" }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-mono text-sm font-semibold" style={{ color: "#f1f5f9" }}>
            {step.drug}
          </span>
          <span
            className="text-xs font-semibold uppercase px-2 py-0.5 rounded"
            style={{ color: style.color, backgroundColor: style.bg }}
          >
            {style.icon} {step.action}
          </span>
        </div>

        {step.substitute && (
          <div className="text-sm mb-1.5" style={{ color: "#cbd5e1" }}>
            Substitute with:{" "}
            <span className="font-mono" style={{ color: "#7dd3fc" }}>
              {step.substitute}
            </span>
          </div>
        )}

        {/* Rationale — bumped from `text-text-muted` (≈ #64748b slate-500)
            to slate-300 so the clinical reasoning is actually legible on
            the dark navy bg. */}
        <p className="text-xs leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
          {step.rationale}
        </p>

        {/* Monitoring chips — same readability bump. */}
        {step.monitoring.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {step.monitoring.map((m, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-2 py-0.5 rounded"
                style={{
                  color: "#a8b8d0",
                  background: "rgba(2, 8, 23, 0.6)",
                  border: "1px solid rgba(30, 58, 95, 0.6)",
                }}
              >
                {m}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 text-xs">
          <span className="font-mono font-bold" style={{ color: "#10b981" }}>
            −{step.expected_risk_reduction.toFixed(0)}% risk
          </span>
          <span style={{ color: "#94a3b8" }}>{step.timeline}</span>
        </div>
      </div>
    </motion.div>
  );
}
