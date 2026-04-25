"use client";

import { motion } from "framer-motion";
import type { EvidenceGrade } from "@/lib/types";

const GRADE_CONFIG: Record<
  EvidenceGrade,
  { color: string; bg: string; label: string }
> = {
  A: { color: "#10b981", bg: "rgba(16, 185, 129, 0.1)", label: "Strong" },
  B: { color: "#06b6d4", bg: "rgba(6, 182, 212, 0.1)", label: "Moderate" },
  C: { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.1)", label: "Limited" },
  D: { color: "#64748b", bg: "rgba(100, 116, 139, 0.1)", label: "Theoretical" },
};

interface EvidenceBadgeProps {
  grade: EvidenceGrade;
  confidence?: number;
  compact?: boolean;
}

export function EvidenceBadge({
  grade,
  confidence,
  compact = false,
}: EvidenceBadgeProps) {
  const config = GRADE_CONFIG[grade];

  return (
    <motion.div
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="inline-flex items-center gap-1.5"
      style={{ perspective: "600px" }}
    >
      <span
        className="inline-flex items-center justify-center rounded-md font-display font-bold text-xs px-2 py-1"
        style={{
          color: config.color,
          backgroundColor: config.bg,
          border: `1px solid ${config.color}30`,
        }}
      >
        {grade}
      </span>

      {!compact && (
        <span className="text-text-muted text-xs">{config.label}</span>
      )}

      {confidence !== undefined && (
        <span className="font-mono text-xs" style={{ color: config.color }}>
          {confidence.toFixed(0)}%
        </span>
      )}
    </motion.div>
  );
}
