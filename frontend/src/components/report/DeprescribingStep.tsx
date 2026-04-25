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
      className="flex gap-4 p-4 rounded-xl bg-surface/40 border border-border glow-border"
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
        <div className="w-px flex-1 mt-2 bg-border/50" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm text-text-primary font-semibold">
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
          <div className="text-sm text-text-secondary mb-1">
            Substitute with:{" "}
            <span className="font-mono text-primary">{step.substitute}</span>
          </div>
        )}

        <p className="text-text-muted text-xs leading-relaxed mb-2">
          {step.rationale}
        </p>

        {/* Monitoring */}
        {step.monitoring.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {step.monitoring.map((m, i) => (
              <span
                key={i}
                className="text-[10px] font-mono text-text-muted bg-background/60 px-2 py-0.5 rounded"
              >
                {m}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-success font-mono">
            -{step.expected_risk_reduction.toFixed(0)}% risk
          </span>
          <span className="text-text-muted">{step.timeline}</span>
        </div>
      </div>
    </motion.div>
  );
}
