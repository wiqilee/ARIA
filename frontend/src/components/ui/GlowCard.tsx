"use client";

import { motion } from "framer-motion";

interface GlowCardProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  onClick?: () => void;
}

export function GlowCard({
  children,
  className = "",
  glowColor = "rgba(0, 229, 255, 0.25)",
  onClick,
}: GlowCardProps) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl p-6 transition-all duration-300 ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "var(--border-glow)";
        el.style.boxShadow = `0 0 20px ${glowColor}, 0 0 60px ${glowColor.replace("0.25", "0.05")}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "var(--border)";
        el.style.boxShadow = "none";
      }}
    >
      {children}
    </motion.div>
  );
}
