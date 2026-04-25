/**
 * ARIA Design System — Color tokens, spacing, and design constants.
 */

export const colors = {
  background: "#020817",
  surface: "#0f172a",
  surfaceHover: "#162033",
  border: "#1e3a5f",
  borderHover: "#2d5a8a",

  primary: "#06b6d4",
  primaryDim: "#0891b2",
  primaryGlow: "rgba(6, 182, 212, 0.3)",

  secondary: "#8b5cf6",
  secondaryDim: "#7c3aed",
  secondaryGlow: "rgba(139, 92, 246, 0.3)",

  danger: "#ef4444",
  dangerDim: "#dc2626",
  dangerGlow: "rgba(239, 68, 68, 0.3)",

  warning: "#f59e0b",
  warningDim: "#d97706",

  success: "#10b981",
  successDim: "#059669",

  text: "#f1f5f9",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
} as const;

export const severityColors = {
  low: colors.success,
  moderate: colors.warning,
  high: colors.danger,
  critical: "#ff0040",
} as const;

export const evidenceGradeColors = {
  A: colors.success,
  B: colors.primary,
  C: colors.warning,
  D: colors.textMuted,
} as const;

export const gradients = {
  primaryToSecondary: "linear-gradient(135deg, #06b6d4, #8b5cf6)",
  dangerToWarning: "linear-gradient(135deg, #ef4444, #f59e0b)",
  surfaceCard: "linear-gradient(135deg, #0f172a, #1a2744)",
  heroGlow: "radial-gradient(ellipse at center, rgba(6, 182, 212, 0.15), transparent 70%)",
} as const;

export const shadows = {
  glow: {
    primary: "0 0 20px rgba(6, 182, 212, 0.2), 0 0 60px rgba(6, 182, 212, 0.1)",
    secondary: "0 0 20px rgba(139, 92, 246, 0.2), 0 0 60px rgba(139, 92, 246, 0.1)",
    danger: "0 0 20px rgba(239, 68, 68, 0.2), 0 0 60px rgba(239, 68, 68, 0.1)",
  },
  card: "0 4px 24px rgba(0, 0, 0, 0.4)",
  cardHover: "0 8px 32px rgba(0, 0, 0, 0.6)",
} as const;

export const spacing = {
  page: "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8",
  section: "py-16 sm:py-24",
} as const;
