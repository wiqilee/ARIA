"use client";

import { useEffect, useState } from "react";
import { motion, useSpring } from "framer-motion";
import { getSeverityColor, getSeverityLabel } from "@/lib/severity";

interface SeverityMeterProps {
  value: number; // 0-10
  label?: string;
  size?: "sm" | "md" | "lg";
  /**
   * When true, render the auto-computed severity label (LOW/MODERATE/HIGH/CRITICAL)
   * next to the numeric score. Defaults to true so the bar and its label are
   * always in sync — no more "9.4 / 10 ... MODERATE" mismatches.
   */
  showSeverityLabel?: boolean;
}

export function SeverityMeter({
  value,
  label,
  size = "md",
  showSeverityLabel = true,
}: SeverityMeterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const springValue = useSpring(0, { stiffness: 60, damping: 15 });

  useEffect(() => {
    springValue.set(value);
  }, [value, springValue]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (v) => {
      setDisplayValue(v);
    });
    return unsubscribe;
  }, [springValue]);

  const color = getSeverityColor(value);
  const severityLabel = getSeverityLabel(value);
  const percentage = (displayValue / 10) * 100;

  const sizes = {
    sm: { height: "h-2", text: "text-lg", container: "w-24" },
    md: { height: "h-3", text: "text-3xl", container: "w-full" },
    lg: { height: "h-4", text: "text-5xl", container: "w-full" },
  };

  const s = sizes[size];

  return (
    <div className={s.container}>
      {/* Numeric display */}
      <div className="flex items-baseline gap-2 mb-2">
        <motion.span
          className={`font-display font-bold ${s.text}`}
          style={{ color }}
        >
          {displayValue.toFixed(1)}
        </motion.span>
        <span className="text-text-muted text-sm font-mono">/ 10</span>
        {showSeverityLabel && (
          <span
            className="ml-2 text-xs font-bold tracking-wider uppercase font-mono"
            style={{ color }}
          >
            {severityLabel}
          </span>
        )}
      </div>

      {label && (
        <div className="text-text-muted text-xs mb-2">{label}</div>
      )}

      {/* Bar */}
      <div
        className={`w-full ${s.height} rounded-full overflow-hidden`}
        style={{ backgroundColor: "rgba(30, 58, 95, 0.5)" }}
      >
        <motion.div
          className={`${s.height} rounded-full`}
          style={{
            width: `${percentage}%`,
            backgroundColor: color,
            boxShadow: `0 0 12px ${color}40`,
          }}
          initial={{ width: "0%" }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </div>

      {/* Scale markers */}
      <div className="flex justify-between mt-1">
        {[0, 2, 4, 6, 8, 10].map((mark) => (
          <span key={mark} className="text-text-muted/40 text-[10px] font-mono">
            {mark}
          </span>
        ))}
      </div>
    </div>
  );
}
