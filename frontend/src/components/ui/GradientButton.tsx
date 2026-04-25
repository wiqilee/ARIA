"use client";

import { motion } from "framer-motion";

interface GradientButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  type?: "button" | "submit";
}

const VARIANTS = {
  primary: {
    gradient: "linear-gradient(135deg, var(--primary), var(--teal))",
    hoverShadow: "rgba(0, 229, 255, 0.25)",
  },
  secondary: {
    gradient: "linear-gradient(135deg, var(--secondary), var(--primary))",
    hoverShadow: "rgba(124, 77, 255, 0.25)",
  },
  danger: {
    gradient: "linear-gradient(135deg, var(--danger), var(--warning))",
    hoverShadow: "rgba(255, 23, 68, 0.25)",
  },
};

const SIZES = {
  sm: "px-4 py-2 text-xs",
  md: "px-6 py-3 text-sm",
  lg: "px-8 py-4 text-sm",
};

export function GradientButton({
  children,
  onClick,
  disabled = false,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
}: GradientButtonProps) {
  const v = VARIANTS[variant];
  const s = SIZES[size];

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { scale: 1.02 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      className={`rounded-xl font-display font-semibold transition-all duration-200 ${s} ${
        disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-95"
      } ${className}`}
      style={{
        background: disabled
          ? "var(--surface)"
          : v.gradient,
        color: disabled ? "var(--text-muted)" : "var(--background)",
        border: disabled ? "1px solid var(--border)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.boxShadow = `0 4px 24px ${v.hoverShadow}`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {children}
    </motion.button>
  );
}
