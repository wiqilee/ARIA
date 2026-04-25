//app/page.tsx
"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Copy,
  Download,
  FileText,
  Sparkles,
  Trash2,
  Wand2,
  Play,
  Loader2,
  GalleryHorizontal,
  TriangleAlert,
  ShieldCheck,
  Timer,
  ListChecks,
  Lightbulb,
  Zap,
  Star,
  Info,
  FilePlus,
  X,
  Plus,
  RotateCcw,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GroundsDrawer } from "@/components/ui/GroundsDrawer";

// Gemini Critic Panel
import { GeminiCriticPanel } from "@/components/compare/GeminiCriticPanel";

// 3D Decision Landscape Visualization
import { DecisionLandscape } from "@/components/visualizations/DecisionLandscape";

// Template Picker for quick-start decision templates
import { TemplatePicker } from "@/components/TemplatePicker";
import type { DecisionTemplate } from "@/lib/templates";

// Voice Input for multimodal support
import { VoiceInputInline } from "@/components/VoiceInput";

// Google Export Modal
import { GoogleExportModal } from "@/components/GoogleExport";

import { analyzeDecision } from "@/lib/analysis";
import type { DecisionInput } from "@/lib/analysis/types";
import { toReportHTML } from "@/lib/report/html";
import type { 
  ProviderCompareRow, 
  ReportExtras, 
  ReportTooltip, 
  GeminiCriticResult,
  SentimentAnalysisData,
  ConclusionData,
  RelatedResearchData,
  RadarChartData,
  ThemeInfo,
  StressTestReportData
} from "@/lib/report/html";

import { appendEvent, clearLedger, loadLedger } from "@/lib/ledger/storage";
import type { LedgerEvent } from "@/lib/ledger/types";

// Gallery
import { saveReport, listReports } from "@/lib/gallery/storage";
import type { StoredReport } from "@/lib/gallery/types";

type Tone = "good" | "info" | "warn" | "bad" | "neutral";

/* ---------------- utilities ---------------- */

function uid() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Inputs can become unreadable in light mode if global styles are too dark-centric.
 * These “hard” classes guarantee:
 * - Light: white-ish bg + dark text
 * - Dark: deep bg + light text
 */
function inputBaseClass(extra?: string) {
  return cx(
    "w-full",
    "rounded-2xl border-2",
    // Light: black text, visible border
    "border-slate-300 bg-white text-black placeholder:text-slate-500",
    "focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30",
    // Dark: visible white border
    "dark:border-white/40 dark:bg-[#0b0c14]/55 dark:text-white/90 dark:placeholder:text-white/40",
    "dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30",
    "transition-all duration-150",
    extra
  );
}

function textareaBaseClass(extra?: string) {
  return cx(
    "w-full",
    "rounded-2xl border-2",
    // Light: black text, visible border
    "border-slate-300 bg-white text-black placeholder:text-slate-500",
    "focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30",
    // Dark: visible white border
    "dark:border-white/40 dark:bg-[#0b0c14]/55 dark:text-white/90 dark:placeholder:text-white/40",
    "dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30",
    "transition-all duration-150",
    extra
  );
}

/** “i” bubble indicator (requested) - use near every HoverTip trigger so users know it’s interactive. */
function InfoDot({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-4 w-4 items-center justify-center rounded-full",
        "border border-slate-200 bg-white/80 text-[10px] font-semibold text-slate-700",
        "dark:border-white/15 dark:bg-white/10 dark:text-white/70",
        className
      )}
      aria-hidden="true"
      title="Info"
    >
      i
    </span>
  );
}

/* ---------------- Skeleton Shimmer Components ---------------- */

/** Skeleton shimmer effect for loading states */
function Skeleton({ className, variant = "default" }: { className?: string; variant?: "default" | "text" | "circular" | "card" }) {
  const baseClass = "relative overflow-hidden bg-slate-200 dark:bg-white/10";
  
  const variants = {
    default: "rounded-lg",
    text: "rounded h-4",
    circular: "rounded-full",
    card: "rounded-2xl",
  };

  return (
    <div className={cx(baseClass, variants[variant], className)}>
      <div 
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/20 dark:via-white/10 to-transparent"
      />
    </div>
  );
}

/** Skeleton card for loading decision signals */
function SkeletonSignals() {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="w-10 h-10" />
        <div className="flex-1 space-y-2">
          <Skeleton variant="text" className="w-3/4" />
          <Skeleton variant="text" className="w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

/** Skeleton for provider compare results */
function SkeletonCompare() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-white/10">
          <Skeleton variant="circular" className="w-8 h-8" />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" className="w-1/3" />
            <Skeleton variant="text" className="w-full" />
            <Skeleton variant="text" className="w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for content sections */
function SkeletonContent({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton 
          key={i} 
          variant="text" 
          className={cx("h-4", i === lines - 1 ? "w-2/3" : "w-full")} 
        />
      ))}
    </div>
  );
}

/* ---------------- Enhanced Micro-Interactions ---------------- */

/** Animated number counter for scores */
function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);
  
  useEffect(() => {
    const startValue = previousValue.current;
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + (value - startValue) * eased);
      
      setDisplayValue(current);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        previousValue.current = value;
      }
    };
    
    requestAnimationFrame(animate);
  }, [value, duration]);
  
  return <span>{displayValue}</span>;
}

/** Pulse indicator for live/active states */
function PulseIndicator({ color = "emerald", size = "sm" }: { color?: "emerald" | "cyan" | "amber" | "red"; size?: "sm" | "md" | "lg" }) {
  const colors = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  };
  
  const sizes = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4",
  };
  
  return (
    <span className="relative inline-flex">
      <span className={cx("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", colors[color], sizes[size])} />
      <span className={cx("relative inline-flex rounded-full", colors[color], sizes[size])} />
    </span>
  );
}

/** Success checkmark animation */
function SuccessCheck({ show }: { show: boolean }) {
  if (!show) return null;
  
  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500"
    >
      <motion.svg
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="w-3 h-3 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
      >
        <motion.path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </motion.svg>
    </motion.div>
  );
}

function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ✅ Helper to render markdown-like formatted text with bold headers and emojis
// Provider color mapping for bullet colors
const PROVIDER_BULLET_COLORS: Record<string, string> = {
  google: "text-cyan-500 dark:text-cyan-400",
  openai: "text-emerald-500 dark:text-emerald-400",
  groq: "text-orange-500 dark:text-orange-400",
  openrouter: "text-purple-500 dark:text-purple-400",
};

// ✅ All valid section headers (with or without emoji)
const SECTION_HEADERS = [
  "BEST OPTION",
  "RATIONALE", 
  "TOP RISKS",
  "ASSUMPTIONS TO VALIDATE",
  "HALF-LIFE",
  "HALF LIFE",
  "BLIND SPOTS",
  "NEXT ACTIONS",
];

function isValidHeader(text: string): boolean {
  const upper = text.toUpperCase().replace(/^[🏆🧩⚠️🧱⏳🕳️✅]\s*/, "").trim();
  return SECTION_HEADERS.some(h => upper === h || upper.startsWith(h + ":"));
}

function FormattedCompareText({ text, providerId }: { text: string; providerId?: string }) {
  if (!text || text === "(empty)") {
    return <div className="mt-2 text-[12px] text-black/50 dark:text-white/40 italic">(empty)</div>;
  }

  const bulletColor = providerId ? (PROVIDER_BULLET_COLORS[providerId] || "text-emerald-500 dark:text-emerald-400") : "text-emerald-500 dark:text-emerald-400";
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;
  
  // ✅ Track seen bullets to filter duplicates
  const seenBullets = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Empty line = spacing
    if (!trimmed) {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    // ✅ Header detection - multiple patterns
    // Pattern 1: ## 🏆 BEST OPTION
    // Pattern 2: 🏆 BEST OPTION  
    // Pattern 3: BEST OPTION (plain)
    // Pattern 4: HALF-LIFE (plain, no emoji)
    const isHeader = 
      trimmed.startsWith("## ") || 
      /^[🏆🧩⚠️🧱⏳🕳️✅]\s+[A-Z]/.test(trimmed) ||
      isValidHeader(trimmed);
    
    if (isHeader) {
      const headerText = trimmed.startsWith("## ") ? trimmed.slice(3) : trimmed;
      elements.push(
        <div key={key++} className="mt-3 first:mt-0 mb-1 text-[13px] font-bold text-black dark:text-white/95">
          {headerText}
        </div>
      );
      // Reset seen bullets for new section
      seenBullets.clear();
      continue;
    }

    // Bullet line: - content
    if (trimmed.startsWith("- ")) {
      const bulletText = trimmed.slice(2);
      
      // ✅ Skip duplicate/repetitive bullets
      const bulletKey = bulletText.toLowerCase().trim();
      if (bulletKey.length > 20 && seenBullets.has(bulletKey)) {
        continue; // Skip duplicate
      }
      
      // ✅ Skip generic placeholder bullets
      if (bulletKey.includes("define a quick test") || 
          bulletKey.includes("to be determined") ||
          bulletKey === "validation:" ||
          bulletKey === "trigger:" ||
          bulletKey === "question:") {
        continue; // Skip placeholder
      }
      
      seenBullets.add(bulletKey);
      
      elements.push(
        <div key={key++} className="flex items-start gap-2 text-[12px] text-black/80 dark:text-white/70 leading-relaxed pl-1 font-mono">
          <span className={`${bulletColor} mt-0.5 flex-shrink-0`}>•</span>
          <span>{bulletText}</span>
        </div>
      );
      continue;
    }

    // Regular text (also mono for API output consistency)
    elements.push(
      <div key={key++} className="text-[12px] text-black/75 dark:text-white/65 leading-relaxed font-mono">
        {trimmed}
      </div>
    );
  }

  return <div className="mt-2 space-y-0.5">{elements}</div>;
}

async function fetchPDFBytes(html: string, filename: string) {
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, filename }),
  });

  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    alert(msg?.error ?? msg?.message ?? "PDF export failed.");
    return null;
  }

  return new Uint8Array(await res.arrayBuffer());
}

const FadeIn: React.FC<{ children: React.ReactNode; delay?: number; className?: string }> = ({
  children,
  delay = 0,
  className,
}) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={reduce ? false : { opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
};

/* ---------------- Stepper Sidebar Component ---------------- */

type StepId = "theme" | "input" | "critic" | "compare" | "sentiment" | "stress" | "export";

interface Step {
  id: StepId;
  label: string;
  shortLabel: string;
  emoji: string;
  description: string;
}

const STEPS: Step[] = [
  { id: "theme", label: "Theme", shortLabel: "Theme", emoji: "🎨", description: "Select decision context" },
  { id: "input", label: "Input", shortLabel: "Input", emoji: "📝", description: "Enter decision details" },
  { id: "critic", label: "Gemini Critic", shortLabel: "Critic", emoji: "🤖", description: "Get AI feedback" },
  { id: "compare", label: "Provider Compare", shortLabel: "Compare", emoji: "⚖️", description: "Compare AI outputs" },
  { id: "sentiment", label: "Sentiment Analysis", shortLabel: "Sentiment", emoji: "💭", description: "Analyze sentiment" },
  { id: "stress", label: "Deep Reasoner", shortLabel: "Stress", emoji: "🔬", description: "Adversarial stress test" },
  { id: "export", label: "Export Report", shortLabel: "Export", emoji: "📤", description: "Generate HTML/PDF" },
];

function StepperSidebar({ 
  activeStep, 
  onStepClick,
  isVisible,
  isMinimized,
  onClose,
  onToggleMinimize,
  completedSteps = [],
}: { 
  activeStep: StepId; 
  onStepClick: (step: StepId) => void;
  isVisible: boolean;
  isMinimized: boolean;
  onClose: () => void;
  onToggleMinimize: () => void;
  completedSteps?: StepId[];
}) {
  const reduce = useReducedMotion();
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 0 });
  const [size, setSize] = useState({ width: 220, height: 380 });
  const [hoveredStep, setHoveredStep] = useState<StepId | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; initialW: number; initialH: number } | null>(null);
  
  // Calculate progress percentage
  const progressPercent = Math.round((completedSteps.length / STEPS.length) * 100);
  
  // Calculate center Y on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      setPosition({ x: 16, y: window.innerHeight / 2 - 200 });
    }
  }, []);

  // Drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
  };

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialW: size.width,
      initialH: size.height,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.initialX + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 300, dragRef.current.initialY + dy)),
        });
      }
      if (isResizing && resizeRef.current) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        setSize({
          width: Math.max(180, Math.min(350, resizeRef.current.initialW + dx)),
          height: Math.max(280, Math.min(550, resizeRef.current.initialH + dy)),
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      dragRef.current = null;
      resizeRef.current = null;
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing]);

  if (!isVisible) return null;
  
  return (
    <>
      {/* Desktop Sidebar - Draggable & Resizable */}
      <div 
        className={cx(
          "hidden lg:flex flex-col fixed z-40",
          "rounded-2xl border border-white/10 backdrop-blur-xl",
          "bg-gradient-to-b from-white/10 to-white/5",
          "shadow-[0_8px_32px_rgba(0,0,0,0.3)]",
          "transition-colors duration-300 ease-out",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
        style={{ 
          left: position.x, 
          top: position.y,
          width: isMinimized ? 56 : size.width,
          minHeight: isMinimized ? 'auto' : size.height,
          userSelect: (isDragging || isResizing) ? 'none' : 'auto',
        }}
        onMouseDown={handleMouseDown}
      >
        {/* Animated border gradient */}
        <div className="absolute -inset-[1px] rounded-2xl overflow-hidden pointer-events-none">
          <motion.div 
            className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 via-violet-500/30 to-rose-500/30"
            animate={{ 
              backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
            }}
            transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
            style={{ backgroundSize: "200% 200%" }}
          />
        </div>
        
        {/* Inner content */}
        <div className={cx(
          "relative rounded-2xl bg-[#0b0c14]/85 backdrop-blur-xl overflow-hidden flex flex-col",
          isMinimized ? "p-2" : "p-3"
        )}
        style={{ minHeight: isMinimized ? 'auto' : size.height - 2 }}
        >
          {/* Header with controls */}
          <div className={cx(
            "flex items-center gap-2 mb-2",
            isMinimized ? "justify-center" : "justify-between px-1"
          )}>
            {!isMinimized && (
              <div className="text-[11px] font-bold text-white/80 uppercase tracking-wider">
                Workflow
              </div>
            )}
            <div className="flex items-center gap-1">
              {/* Minimize button */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleMinimize(); }}
                className="w-5 h-5 rounded-md bg-white/10 hover:bg-yellow-500/30 flex items-center justify-center transition-colors"
              >
                <span className="text-[10px] text-white/70">{isMinimized ? "▶" : "◀"}</span>
              </button>
              {/* Close button */}
              {!isMinimized && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(); }}
                  className="w-5 h-5 rounded-md bg-white/10 hover:bg-rose-500/30 flex items-center justify-center transition-colors"
                >
                  <X className="w-3 h-3 text-white/70" />
                </button>
              )}
            </div>
          </div>
          
          {/* Progress bar */}
          {!isMinimized && (
            <div className="mb-3 px-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-white/60">Progress</span>
                <motion.span 
                  className="text-[10px] font-bold"
                  animate={{ 
                    color: progressPercent === 100 
                      ? ["#34d399", "#10b981", "#34d399"]
                      : ["#06b6d4", "#8b5cf6", "#ec4899", "#06b6d4"],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                >
                  {progressPercent}%
                </motion.span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div 
                  className="h-full rounded-full"
                  style={{
                    width: `${progressPercent}%`,
                    backgroundImage: progressPercent === 100 
                      ? "linear-gradient(90deg, #34d399, #10b981)"
                      : "linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899)",
                    backgroundSize: "200% 100%",
                    backgroundRepeat: "no-repeat",
                  }}
                  animate={{ 
                    backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>
          )}
          
          {/* Steps */}
          <div className="flex flex-col gap-1 flex-1 overflow-y-auto">
            {STEPS.map((step, idx) => {
              const isActive = step.id === activeStep;
              const isCompleted = completedSteps.includes(step.id);
              const isHovered = hoveredStep === step.id;
              
              return (
                <button
                  key={step.id}
                  onClick={(e) => { e.stopPropagation(); onStepClick(step.id); }}
                  onMouseEnter={() => setHoveredStep(step.id)}
                  onMouseLeave={() => setHoveredStep(null)}
                  className={cx(
                    "relative flex items-center gap-2 rounded-xl transition-all duration-200",
                    isMinimized ? "p-2 justify-center" : "px-3 py-2",
                    isActive 
                      ? "bg-gradient-to-r from-cyan-500/25 to-violet-500/25 border border-cyan-400/40" 
                      : isCompleted
                        ? "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/20"
                        : "hover:bg-white/10 border border-transparent",
                    "group"
                  )}
                >
                  {/* Animated glow effect for active */}
                  {isActive && !reduce && (
                    <motion.div
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: "linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(139,92,246,0.15) 50%, rgba(236,72,153,0.15) 100%)",
                        backgroundSize: "200% 200%",
                      }}
                      animate={{ 
                        backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
                      }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    />
                  )}
                  
                  {/* Step number badge */}
                  <div className={cx(
                    "relative flex items-center justify-center w-6 h-6 rounded-lg text-[10px] font-bold transition-all shrink-0",
                    isActive 
                      ? "bg-gradient-to-br from-cyan-400 to-violet-500 text-white shadow-lg shadow-cyan-500/30" 
                      : isCompleted
                        ? "bg-emerald-500/25 text-emerald-400 border border-emerald-400/40"
                        : "bg-white/10 text-white/50 group-hover:text-white/80 group-hover:bg-white/15"
                  )}>
                    {isCompleted ? "✓" : idx + 1}
                  </div>
                  
                  {/* Label with emoji */}
                  {!isMinimized && (
                    <div className="relative flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-[13px] shrink-0">{step.emoji}</span>
                      <span className={cx(
                        "text-[11px] transition-all duration-200",
                        isActive 
                          ? "text-white font-bold" 
                          : isCompleted 
                            ? "text-emerald-400 font-medium" 
                            : isHovered
                              ? "text-white font-bold"
                              : "text-white/70 font-medium group-hover:text-white/90"
                      )}>
                        {step.label}
                      </span>
                    </div>
                  )}
                  
                  {/* Tooltip for minimized */}
                  {isMinimized && (
                    <div className="absolute left-full ml-2 px-3 py-1.5 rounded-lg bg-[#0b0c14] border border-white/15 text-[11px] text-white/90 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                      <span className="mr-1.5">{step.emoji}</span>
                      {step.label}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          
          {/* Footer with drag hint */}
          {!isMinimized && (
            <div className="mt-2 pt-2 border-t border-white/10 text-center">
              <span className="text-[9px] text-white/50">Drag to move · Click step to navigate</span>
            </div>
          )}
          
          {/* Resize handle */}
          {!isMinimized && (
            <div 
              className="resize-handle absolute bottom-1 right-1 w-4 h-4 cursor-se-resize opacity-40 hover:opacity-70 transition-opacity"
              onMouseDown={handleResizeStart}
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-full h-full text-white/50">
                <path d="M22 22L12 22M22 22L22 12M22 22L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          )}
        </div>
      </div>
      
      {/* Mobile Bottom Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 backdrop-blur-xl bg-[#0b0c14]/95 px-2 py-2 safe-area-inset-bottom">
        <div className="flex items-center justify-around gap-1 max-w-lg mx-auto">
          {STEPS.map((step, idx) => {
            const isActive = step.id === activeStep;
            const isCompleted = completedSteps.includes(step.id);
            
            return (
              <button
                key={step.id}
                onClick={() => onStepClick(step.id)}
                className={cx(
                  "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all",
                  isActive 
                    ? "bg-gradient-to-t from-cyan-500/25 to-violet-500/25" 
                    : "hover:bg-white/5"
                )}
              >
                <div className={cx(
                  "flex items-center justify-center w-6 h-6 rounded-lg text-[12px]",
                  isActive 
                    ? "bg-gradient-to-br from-cyan-400 to-violet-400 shadow-lg shadow-cyan-500/25" 
                    : isCompleted
                      ? "bg-emerald-500/20"
                      : ""
                )}>
                  {isCompleted ? <span className="text-emerald-400 text-[10px] font-bold">✓</span> : <span>{step.emoji}</span>}
                </div>
                <span className={cx(
                  "text-[9px]",
                  isActive ? "text-white font-bold" : isCompleted ? "text-emerald-400 font-medium" : "text-white/40 font-medium"
                )}>
                  {step.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ---------------- Provider theming (emoji + per-provider animated glow + animated dot + border) ---------------- */

type ProviderId = "openai" | "groq" | "google" | "openrouter";

function providerMeta(id: ProviderId) {
  switch (id) {
    case "google":
      // Google: Multi-color (Google brand colors) - Blue/Red/Yellow/Green
      return {
        emoji: "✨",
        name: "Google",
        glow:
          "from-blue-400/25 via-red-400/15 to-yellow-400/15 dark:from-blue-400/20 dark:via-red-400/12 dark:to-yellow-400/12",
        ring: "ring-blue-400/30",
        dot: "bg-blue-500 dark:bg-blue-400",
        dotGlow: "shadow-[0_0_8px_rgba(59,130,246,0.6)] dark:shadow-[0_0_8px_rgba(96,165,250,0.5)]",
        borderColor: "border-blue-400/40 dark:border-blue-400/30",
      };
    case "groq":
      // Groq: Purple/Violet (fast, lightning)
      return {
        emoji: "⚡",
        name: "Groq",
        glow:
          "from-violet-400/20 via-purple-400/15 to-fuchsia-400/12 dark:from-violet-400/20 dark:via-purple-400/12 dark:to-fuchsia-400/10",
        ring: "ring-violet-400/30",
        dot: "bg-violet-500 dark:bg-violet-400",
        dotGlow: "shadow-[0_0_8px_rgba(139,92,246,0.6)] dark:shadow-[0_0_8px_rgba(167,139,250,0.5)]",
        borderColor: "border-violet-400/40 dark:border-violet-400/30",
      };
    case "openrouter":
      // OpenRouter: Amber/Orange (warm, routing)
      return {
        emoji: "🧭",
        name: "OpenRouter",
        glow:
          "from-amber-400/20 via-orange-400/15 to-yellow-400/12 dark:from-amber-400/18 dark:via-orange-400/12 dark:to-yellow-400/10",
        ring: "ring-amber-400/35",
        dot: "bg-amber-500 dark:bg-amber-400",
        dotGlow: "shadow-[0_0_8px_rgba(245,158,11,0.6)] dark:shadow-[0_0_8px_rgba(251,191,36,0.5)]",
        borderColor: "border-amber-400/40 dark:border-amber-400/30",
      };
    case "openai":
    default:
      // OpenAI: Green/Teal (their brand color)
      return {
        emoji: "🧠",
        name: "OpenAI",
        glow:
          "from-emerald-400/20 via-teal-400/15 to-cyan-400/12 dark:from-emerald-400/18 dark:via-teal-400/12 dark:to-cyan-400/10",
        ring: "ring-emerald-400/30",
        dot: "bg-emerald-500 dark:bg-emerald-400",
        dotGlow: "shadow-[0_0_8px_rgba(16,185,129,0.6)] dark:shadow-[0_0_8px_rgba(52,211,153,0.5)]",
        borderColor: "border-emerald-400/40 dark:border-emerald-400/30",
      };
  }
}

/* ---------------- “Premium UI” helpers ---------------- */

/**
 * Premium animated header treatment
 * - Uses distinct gradients for light vs dark (no reused "white wash" in dark)
 * - Dark shimmer is reduced to avoid fog
 */
function PageCardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const reduce = useReducedMotion();

  return (
    <div className="relative px-6 pt-6 pb-5 border-b border-slate-200 dark:border-white/[0.06] overflow-hidden">
      {/* premium backdrop (LIGHT) */}
      <motion.div
        className="pointer-events-none absolute inset-0 dark:hidden"
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? false : { opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background:
            "radial-gradient(circle at 18% 28%, rgba(34,211,238,.14), transparent 55%), radial-gradient(circle at 72% 18%, rgba(167,139,250,.14), transparent 55%), linear-gradient(180deg, rgba(255,255,255,.55), transparent 72%)",
        }}
      />

      {/* premium backdrop (DARK) - no big white overlay */}
      <motion.div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? false : { opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background:
            "radial-gradient(circle at 18% 28%, rgba(34,211,238,.10), transparent 58%), radial-gradient(circle at 72% 18%, rgba(167,139,250,.10), transparent 60%), linear-gradient(180deg, rgba(11,12,20,.78), rgba(11,12,20,.24) 70%, transparent 92%)",
        }}
      />

      {/* shimmer sweep (LIGHT) */}
      <motion.div
        className="pointer-events-none absolute -inset-y-10 -left-1/2 w-[220%] dark:hidden"
        initial={reduce ? false : { opacity: 0, x: "-18%" }}
        animate={reduce ? false : { opacity: 1, x: "18%" }}
        transition={{
          duration: 1.1,
          ease: [0.22, 1, 0.36, 1],
          repeat: reduce ? 0 : Infinity,
          repeatType: "mirror",
          repeatDelay: 1.2,
        }}
        style={{
          background:
            "linear-gradient(110deg, transparent, rgba(255,255,255,.40), rgba(34,211,238,.18), transparent)",
          transform: "rotate(-7deg)",
        }}
      />

      {/* shimmer sweep (DARK) - reduced opacity + narrower highlight */}
      <motion.div
        className="pointer-events-none absolute -inset-y-10 -left-1/2 w-[220%] hidden dark:block"
        initial={reduce ? false : { opacity: 0, x: "-18%" }}
        animate={reduce ? false : { opacity: 1, x: "18%" }}
        transition={{
          duration: 1.25,
          ease: [0.22, 1, 0.36, 1],
          repeat: reduce ? 0 : Infinity,
          repeatType: "mirror",
          repeatDelay: 1.6,
        }}
        style={{
          background:
            "linear-gradient(110deg, transparent, rgba(255,255,255,.10), rgba(34,211,238,.10), transparent)",
          transform: "rotate(-7deg)",
          opacity: 0.08,
        }}
      />

      {/* subtle accent line - thin and elegant */}
      <div
        className="pointer-events-none absolute left-6 right-6 top-0 h-[1px]"
        style={{
          background: "linear-gradient(90deg, rgba(148,163,184,0.3), rgba(148,163,184,0.15), rgba(148,163,184,0.3))",
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <motion.div
            className="text-[14px] font-semibold text-black dark:text-white tracking-[0.01em]"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={reduce ? false : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {title}
          </motion.div>

          {subtitle ? (
            <motion.div
              className="mt-1 text-[12px] text-slate-600 dark:text-white/75"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={reduce ? false : { opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              {subtitle}
            </motion.div>
          ) : null}
        </div>

        {right ? (
          <motion.div
            className="shrink-0"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={reduce ? false : { opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            {right}
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Unified premium button/glow
 */
function btnFx(extra = "") {
  return [
    "relative overflow-hidden isolate",
    "text-black dark:text-white",  // Ensure black text in light mode
    "transition-[transform,background,box-shadow,border-color,opacity] duration-150",
    "hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99]",
    "ring-1 ring-black/10 hover:ring-black/15 dark:ring-white/10 dark:hover:ring-white/15",
    "hover:shadow-[inset_0_0_0_1px_rgba(34,197,94,.18),inset_0_0_18px_rgba(34,197,94,.08),0_0_0_1px_rgba(0,0,0,.04)]",
    "dark:hover:shadow-[inset_0_0_0_1px_rgba(34,197,94,.22),inset_0_0_18px_rgba(34,197,94,.08),0_0_0_1px_rgba(255,255,255,.04)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/35",
    "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:opacity-0 hover:after:opacity-100 after:transition-opacity after:duration-150",
    "after:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,.18),transparent)]",
    "after:translate-x-[-35%] hover:after:translate-x-[35%] after:transition-transform after:duration-500",
    extra,
  ].join(" ");
}

// Smaller/compact button style for copy/pin/use buttons
function btnFxSmall(extra = "") {
  return [
    "relative overflow-hidden isolate",
    "h-7 px-2 text-[11px]",
    "transition-[transform,background,box-shadow,border-color,opacity] duration-150",
    "hover:-translate-y-[0.5px] active:translate-y-0 active:scale-[0.99]",
    "ring-1 ring-black/10 hover:ring-black/15 dark:ring-white/10 dark:hover:ring-white/15",
    "hover:shadow-[inset_0_0_0_1px_rgba(34,197,94,.18),inset_0_0_12px_rgba(34,197,94,.06)]",
    "dark:hover:shadow-[inset_0_0_0_1px_rgba(34,197,94,.22),inset_0_0_12px_rgba(34,197,94,.06)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/35",
    extra,
  ].join(" ");
}

/* ---------------- About (Hackathon-ready, compact + expandable) ---------------- */

function AboutGrounds() {
  const reduce = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const pills = [
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "11 Theme Templates + Recommendations",
      body: "Pre-built decision frameworks across Technology, Healthcare, Finance, Legal, and more with actionable recommendations.",
    },
    {
      icon: <ListChecks className="h-4 w-4" />,
      title: "Decision Landscape Visualization",
      body: "6-metric health dashboard: Readiness, Coverage, Evidence, Confidence, Actionable, and Risk Management scores.",
    },
    {
      icon: <FileText className="h-4 w-4" />,
      title: "Professional PDF & HTML Reports",
      body: "Export decision briefs with sentiment analysis, Monte Carlo simulations, and provider comparisons.",
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      title: "Gemini 3 Critic + Multi-Provider Compare",
      body: "AI-powered analysis with structured critique and cross-provider validation for decision-grade output.",
    },
    {
      icon: <ShieldCheck className="h-4 w-4" />,
      title: "Deep Reasoner Stress Test",
      body: "Adversarial AI analysis that attacks your assumptions, finds hidden dependencies, and stress-tests robustness.",
    },
  ] as const;

  const toggleLabel = expanded ? "Hide details" : "Show details";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={reduce ? false : { opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Stronger border (requested) + subtle ring for crispness */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-300 dark:border-emerald-400/25 bg-slate-50 dark:bg-[#0b0c14]/55 p-4 md:p-5">
        {/* backdrop (LIGHT) */}
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl dark:hidden"
          style={{
            background:
              "radial-gradient(circle at 18% 28%, rgba(34,211,238,.16), transparent 58%), radial-gradient(circle at 70% 30%, rgba(167,139,250,.16), transparent 60%), radial-gradient(circle at 40% 100%, rgba(52,211,153,.12), transparent 55%)",
          }}
        />

        {/* backdrop (DARK) - reduced white/bright highlights */}
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl hidden dark:block"
          style={{
            background:
              "radial-gradient(circle at 16% 24%, rgba(34,211,238,.10), transparent 62%), radial-gradient(circle at 72% 30%, rgba(167,139,250,.10), transparent 66%), radial-gradient(circle at 44% 110%, rgba(52,211,153,.07), transparent 62%), linear-gradient(180deg, rgba(11,12,20,.65), rgba(11,12,20,.25) 70%, transparent 92%)",
          }}
        />

        {/* shimmer sweep (LIGHT) */}
        <motion.div
          className="pointer-events-none absolute -inset-y-10 -left-1/2 w-[220%] dark:hidden"
          initial={reduce ? false : { opacity: 0, x: "-18%" }}
          animate={reduce ? false : { opacity: 1, x: "18%" }}
          transition={{
            duration: 1.15,
            ease: [0.22, 1, 0.36, 1],
            repeat: reduce ? 0 : Infinity,
            repeatType: "mirror",
            repeatDelay: 1.1,
          }}
          style={{
            background:
              "linear-gradient(110deg, transparent, rgba(255,255,255,.45), rgba(34,211,238,.18), transparent)",
            transform: "rotate(-8deg)",
          }}
        />

        {/* shimmer sweep (DARK) - reduce opacity + narrow highlight */}
        <motion.div
          className="pointer-events-none absolute -inset-y-10 -left-1/2 w-[220%] hidden dark:block"
          initial={reduce ? false : { opacity: 0, x: "-18%" }}
          animate={reduce ? false : { opacity: 1, x: "18%" }}
          transition={{
            duration: 1.4,
            ease: [0.22, 1, 0.36, 1],
            repeat: reduce ? 0 : Infinity,
            repeatType: "mirror",
            repeatDelay: 1.9,
          }}
          style={{
            background:
              "linear-gradient(110deg, transparent, rgba(255,255,255,.10), rgba(34,211,238,.10), transparent)",
            transform: "rotate(-8deg)",
            opacity: 0.08,
          }}
        />

        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 dark:border-emerald-400/25 bg-white/75 dark:bg-[#0b0c14]/60 px-3 py-1.5">
                <Info className="h-4 w-4 text-black dark:text-white/70" />
                <div className="text-[12px] font-semibold text-black dark:text-white/85 tracking-[0.01em]">
                  Why this is decision-grade
                </div>
              </div>

              {/* Hero explanation - higher prominence */}
              <motion.div
                className="mt-3 text-[14px] md:text-[15px] font-medium text-slate-800 dark:text-white/90 leading-relaxed max-w-[74ch]"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={reduce ? false : { opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
              >
                Grounds turns messy inputs into a shareable, decision-grade brief.
              </motion.div>

              {/* Secondary explanation - lighter visual weight */}
              <motion.div
                className="mt-1.5 text-[12px] text-slate-600 dark:text-white/55 max-w-[74ch]"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={reduce ? false : { opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.07, ease: [0.22, 1, 0.36, 1] }}
              >
                Backed by explainable signals, a local evidence ledger, and HTML/PDF artifacts.
              </motion.div>

              <motion.div
                className="mt-2 text-[12px] text-black/70 dark:text-white/50 max-w-[74ch]"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={reduce ? false : { opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.09, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="text-violet-600 dark:text-violet-300 font-semibold">Gemini 3</span> powers the{" "}
                <span className="text-black/80 dark:text-white/65">Critic pass</span>,{" "}
                <span className="text-black/80 dark:text-white/65">Provider Compare</span>, and{" "}
                <span className="text-black/80 dark:text-white/65">Deep Reasoner</span>.
              </motion.div>

              {/* Summary cards - tighter spacing */}
              <div className="mt-2.5 grid gap-1.5 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 dark:border-white/15 bg-white/60 dark:bg-[#0b0c14]/50 px-2.5 py-1.5">
                  <div className="text-[10px] text-black/60 dark:text-white/45">Output</div>
                  <div className="text-[11px] text-black dark:text-white/75 font-medium">
                    HTML + PDF, review-ready
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-white/15 bg-white/60 dark:bg-[#0b0c14]/50 px-2.5 py-1.5">
                  <div className="text-[10px] text-black/60 dark:text-white/45">Trust</div>
                  <div className="text-[11px] text-black dark:text-white/75 font-medium">
                    Deterministic scoring
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-white/15 bg-white/60 dark:bg-[#0b0c14]/50 px-2.5 py-1.5">
                  <div className="text-[10px] text-black/60 dark:text-white/45">Trail</div>
                  <div className="text-[11px] text-black dark:text-white/75 font-medium">
                    Local-first ledger
                  </div>
                </div>
              </div>
            </div>

            {/* Right badges - primary/secondary hierarchy */}
            <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0">
              {/* Primary badge - Decision grade */}
              <Chip label="Decision grade" tone={"good" as any} />
              
              {/* Secondary badges - subtle styling */}
              <div className="flex flex-col items-end gap-1 opacity-60">
                <Chip label="Reproducible" tone={"neutral" as any} />
                <Chip label="Local first" tone={"neutral" as any} />
              </div>

              <Button
                variant="secondary"
                onClick={() => setExpanded((v) => !v)}
                className={btnFx("h-auto rounded-2xl px-4 py-2 mt-1")}
                title={toggleLabel}
              >
                <Sparkles className="h-4 w-4" />
                <span className="text-[14px] font-medium leading-snug">{toggleLabel}</span>
              </Button>
            </div>
          </div>

          {/* Quick flow - tighter */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-black/60 dark:text-white/45">
            <div className="rounded-xl border border-slate-200 dark:border-white/15 bg-white/60 dark:bg-[#0b0c14]/50 px-2.5 py-1.5">
              Quick flow: <span className="text-black/80 dark:text-white/60 font-semibold">Compare</span> →{" "}
              <span className="text-black/80 dark:text-white/60 font-semibold">Process</span> →{" "}
              <span className="text-black/80 dark:text-white/60 font-semibold">Review & Download</span>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-white/15 bg-white/60 dark:bg-[#0b0c14]/50 px-2.5 py-1.5">
              Transparency: <span className="text-black/80 dark:text-white/60 font-semibold">explainable score</span> + <span className="text-black/80 dark:text-white/60 font-semibold">exportable ledger</span>.
            </div>

            <div className="sm:hidden">
              <Button
                variant="secondary"
                onClick={() => setExpanded((v) => !v)}
                className={btnFx("h-auto rounded-xl px-3.5 py-2")}
                title={toggleLabel}
              >
                <Sparkles className="h-4 w-4" />
                <span className="text-[14px] font-medium leading-snug">{toggleLabel}</span>
              </Button>
            </div>
          </div>

          {/* Expanded details with improved animation */}
          <motion.div
            initial={false}
            animate={{
              height: expanded ? "auto" : 0,
              opacity: expanded ? 1 : 0,
              y: expanded ? 0 : -5,
            }}
            transition={{
              height: { duration: 0.15, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.15, ease: [0.4, 0, 0.2, 1] },
              y: { duration: 0.15, ease: [0.4, 0, 0.2, 1] },
            }}
            className="overflow-hidden"
          >
            <div className="pt-3">
              <div className="grid gap-2 md:grid-cols-2">
                {pills.map((p, idx) => (
                  <motion.div
                    key={idx}
                    className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white/65 dark:bg-[#0b0c14]/50 p-2.5"
                    whileHover={reduce ? undefined : { y: -1 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-150"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(34,211,238,.08), rgba(167,139,250,.06), rgba(52,211,153,.04))",
                      }}
                    />
                    <div className="relative flex items-start gap-2.5">
                      <div className="mt-[1px] text-slate-600 dark:text-white/65">{p.icon}</div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-black dark:text-white/85">{p.title}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500 dark:text-white/60 leading-relaxed">{p.body}</div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Hover tooltip via portal (anti-clipping).
 * ✅ All tooltips include an "ℹ️" emoji in the title.
 * ✅ Also: all tooltip triggers should show the in-app “i” bubble indicator (requested).
 */
const HoverTip: React.FC<{
  title: string;
  lines: string[];
  className?: string;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
}> = ({ title, lines, className, align = "center", children }) => {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const el = anchorRef.current;
    if (!el) return;

    const update = () => {
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.top, width: r.width, height: r.height });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const tip =
    open && pos
      ? createPortal(
          (() => {
            // Smart positioning: if tooltip would overflow top of viewport, show below instead
            const estimatedHeight = Math.min(lines.length * 22 + 50, 320);
            const showBelow = pos.top - estimatedHeight < 8;
            return (
            <div
              className="pointer-events-none fixed z-[9999]"
              style={{
                top: showBelow ? pos.top + pos.height + 8 : pos.top,
                left:
                  align === "right"
                    ? pos.left + pos.width
                    : align === "left"
                    ? pos.left
                    : pos.left + pos.width / 2,
                transform: showBelow
                  ? (align === "right"
                    ? "translate(-100%, 0)"
                    : align === "left"
                    ? "translate(0, 0)"
                    : "translate(-50%, 0)")
                  : (align === "right"
                    ? "translate(-100%, -10px)"
                    : align === "left"
                    ? "translate(0, -10px)"
                    : "translate(-50%, -10px)"),
              }}
            >
              <div
                className={[
                  "opacity-0 translate-y-2 scale-[0.98]",
                  "data-[open=true]:opacity-100 data-[open=true]:translate-y-0 data-[open=true]:scale-100",
                  "transition-[opacity,transform] duration-200 ease-out",
                ].join(" ")}
                data-open={open ? "true" : "false"}
              >
                <div
                  className={[
                    "relative w-[min(360px,calc(100vw-24px))] rounded-2xl p-3",
                    "bg-white text-slate-900 border border-slate-200",
                    "dark:bg-[#0b0c14] dark:text-white dark:border-white/30",
                    "shadow-[0_22px_70px_rgba(0,0,0,.22),0_0_0_1px_rgba(0,0,0,.06)]",
                    "dark:shadow-[0_22px_70px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.08)]",
                    "overflow-hidden",
                  ].join(" ")}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-amber-300/15" />

                  <div className="pointer-events-none absolute inset-0 opacity-100">
                    <div
                      className={[
                        "absolute -inset-y-6 -left-1/2 w-[220%]",
                        "bg-[linear-gradient(110deg,transparent,rgba(255,255,255,.55),rgba(251,191,36,.18),transparent)]",
                        "dark:bg-[linear-gradient(110deg,transparent,rgba(255,255,255,.08),rgba(251,191,36,.08),transparent)]",
                        "rotate-[-8deg]",
                        "translate-x-[-18%]",
                        "transition-transform duration-700 ease-out",
                      ].join(" ")}
                      style={{ opacity: 0.85 }}
                    />
                  </div>

                  <div className="relative">
                    <div className="text-[12px] font-semibold">
                      <span className="mr-2">ℹ️</span>
                      <span>{title}</span>
                    </div>

                    <div className="mt-2 space-y-1 max-h-[260px] overflow-y-auto scrollbar-thin">
                      {lines.length ? (
                        lines.slice(0, 12).map((l, i) => {
                        const trimmed = l.trim();
                        // No bullet for: empty lines, headers ending with ":", lines already starting with bullet
                        if (!trimmed) return <div key={i} className="h-1" />;
                        const isHeader = trimmed.endsWith(":");
                        const hasBullet = trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*");
                        return (
                          <div key={i} className="text-[11px] text-black dark:text-white/70 leading-relaxed">
                            {isHeader || hasBullet ? trimmed : `• ${trimmed}`}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-[11px] text-black/70 dark:text-white/55">-</div>
                    )}
                  </div>
                </div>

                <div
                  className={[
                    "pointer-events-none absolute left-1/2 -translate-x-1/2",
                    showBelow ? "bottom-full -mb-[1px]" : "top-full",
                    "h-2 w-2 rotate-45",
                    "bg-white border-r border-b border-slate-200",
                    "dark:bg-[#0b0c14] dark:border-white/30",
                  ].join(" ")}
                />
              </div>
            </div>
          </div>
            );
          })(),
          document.body
        )
      : null;

  return (
    <span
      ref={anchorRef}
      className={["relative inline-flex", className ?? ""].join(" ")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {tip}
    </span>
  );
};

/**
 * Input field wrapper with separated focus and typing states:
 * - Focus state (click/tab): single green border on the input (handled via CSS)
 * - Typing state: animated glow on the wrapper/layout only (no border on input)
 */
const Field: React.FC<{
  label: string;
  emoji: string;
  help: string;
  typing?: boolean;  // renamed from active - only for typing animation on layout
  grow?: boolean;
  children: React.ReactNode;
  onVoiceInput?: (text: string) => void; // Optional voice input callback
}> = ({ label, emoji, help, typing = false, grow = false, children, onVoiceInput }) => {
  return (
    <motion.div
      className={["w-full", grow ? "flex flex-col flex-1 min-h-0" : "", "space-y-1.5"].join(" ")}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[12px] text-black dark:text-white/60 flex items-center gap-1.5">
          <span>{emoji}</span>
          <span className="text-black dark:text-white/90 font-medium">{label}</span>
          {onVoiceInput && (
            <VoiceInputInline 
              onTranscript={onVoiceInput}
              className="ml-1"
            />
          )}
        </div>
        <div className="text-[11px] text-slate-600 dark:text-white/40">{help}</div>
      </div>

      {/* Wrapper with typing animation - NO border here, just glow effect */}
      <div className={["relative w-full", grow ? "flex-1 min-h-0" : ""].join(" ")}>
        {/* Typing indicator: subtle animated glow on LAYOUT only (not input border) */}
        <motion.div
          className="pointer-events-none absolute -inset-1 rounded-[20px] overflow-hidden"
          initial={false}
          animate={{ opacity: typing ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ zIndex: 0 }}
        >
          {/* Soft gradient glow */}
          <div 
            className="absolute inset-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(52,211,153,0.12) 0%, transparent 70%)",
            }}
          />
          {/* Animated shimmer sweep */}
          {typing && (
            <motion.div
              className="absolute inset-0"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
              style={{
                background: "linear-gradient(90deg, transparent 30%, rgba(52,211,153,0.08) 50%, transparent 70%)",
              }}
            />
          )}
        </motion.div>
        
        {/* Children (input/textarea) - focus border handled via CSS on input itself */}
        <div className={["relative w-full", grow ? "h-full" : ""].join(" ")} style={{ zIndex: 1 }}>
          {children}
        </div>
      </div>
    </motion.div>
  );
};

const GlowWrap: React.FC<{ active?: boolean; children: React.ReactNode; className?: string }> = ({
  active = false,
  children,
  className,
}) => {
  return (
    <div className={["relative w-full", className ?? ""].join(" ")}>
      {/* Typing indicator: subtle animated glow on wrapper only (no border) */}
      <motion.div
        className="pointer-events-none absolute -inset-1 rounded-[20px] overflow-hidden"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        style={{ zIndex: 0 }}
      >
        {/* Soft gradient glow */}
        <div 
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at center, rgba(52,211,153,0.12) 0%, transparent 70%)",
          }}
        />
        {/* Animated shimmer sweep */}
        {active && (
          <motion.div
            className="absolute inset-0"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
            style={{
              background: "linear-gradient(90deg, transparent 30%, rgba(52,211,153,0.08) 50%, transparent 70%)",
            }}
          />
        )}
      </motion.div>
      <div className="relative w-full" style={{ zIndex: 1 }}>{children}</div>
    </div>
  );
};

/** ---------- Minimal toast (no extra deps) ---------- */
function useToast() {
  const [msg, setMsg] = useState<string>("");
  const tRef = useRef<number | null>(null);

  function show(text: string) {
    setMsg(text);
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setMsg(""), 2200);
  }

  return { msg, show, _timerRef: tRef };
}

/** ---------- localStorage helpers (safe) ---------- */
function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function lsSet(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}

/* ---------------- Compare helpers ---------------- */

const PROVIDERS: Array<{ id: ProviderId; label: string; hint: string; featured?: boolean }> = [
  { id: "google", label: "Google", hint: "Gemini 3 is optimized for structured, decision-grade synthesis.", featured: true },
  { id: "openai", label: "OpenAI", hint: "Excellent quality, though rate limits may apply." },
  { id: "groq", label: "Groq", hint: "Fast inference. Availability may vary." },
  { id: "openrouter", label: "OpenRouter", hint: "Single API for multiple models. Availability may vary." },
];

// IMPORTANT: option `value` MUST be the real model id (not the UI label)
const MODEL_OPTIONS: Record<ProviderId, Array<{ label: string; value: string }>> = {
  openai: [
    { label: "GPT-4o mini (fast)", value: "gpt-4o-mini" },
    { label: "GPT-4.1 mini (strong)", value: "gpt-4.1-mini" },
  ],
  groq: [
    { label: "Llama 3.1 8B (instant)", value: "llama-3.1-8b-instant" },
    { label: "Llama 3.1 70B (versatile)", value: "llama-3.1-70b-versatile" },
  ],
  google: [
    { label: "Gemini 3 Pro", value: "gemini-3-pro" },
    { label: "Gemini 3 Flash", value: "gemini-3-flash" },
    { label: "Gemini 1.5 Flash (safe)", value: "gemini-1.5-flash" },
    { label: "Gemini 1.5 Pro (strong)", value: "gemini-1.5-pro" },
  ],
  openrouter: [
    { label: "Llama 3.1 8B Instruct", value: "meta-llama/llama-3.1-8b-instruct" },
    { label: "Qwen 2.5 7B Instruct", value: "qwen/qwen-2.5-7b-instruct" },
  ],
};

type CompareItem = {
  provider: ProviderId;
  model: string;
  ok: boolean;
  text?: string;
  latencyMs?: number;
  usage?: Record<string, unknown>;
  error?: { message: string } | string;
  message?: string;
};

type CompareResponse = {
  results: CompareItem[];
  error?: string;
  message?: string;
  meta?: Record<string, unknown>;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

type NormalizedCompare = Omit<CompareItem, "text" | "latencyMs" | "usage" | "error" | "message"> & {
  text: string;
  latencyMs: number | null;
  usage: Record<string, unknown> | null;
  error: { message: string } | null;
  score: number;
  scoreReason: string;
};

function normalizeCompareItem(item: CompareItem): NormalizedCompare {
  const ok = !!item.ok;

  const text = ok && typeof item.text === "string" ? item.text.trim() : "";
  const latencyMs = typeof item.latencyMs === "number" ? item.latencyMs : null;
  const usage = isRecord(item.usage) ? (item.usage as Record<string, unknown>) : null;

  const rawErr =
    typeof item.error === "string"
      ? item.error
      : item.error?.message || (typeof item.message === "string" ? item.message : "") || "";

  const error = !ok ? { message: String(rawErr || "Request failed").trim() } : null;

  const len = text.length;

  // ✅ Count unique bullets (not duplicates)
  const bullets = text.match(/^\s*[-•*]\s+.+/gm) || [];
  const uniqueBullets = new Set(bullets.map(b => b.toLowerCase().trim()));
  const bulletCount = uniqueBullets.size;
  
  // ✅ Only detect CLEAR placeholder/repetitive patterns (reduce false positives)
  const repetitivePatterns = [
    "define a quick test or data check to confirm",
    "validation: define a quick test",
    "trigger: define the event that would force",
    "add a concrete mitigation step and an owner",
    "owner: assign a person/team",
    "timebox: 24-48h", // Only exact generic timebox
  ];
  
  let repetitiveCount = 0;
  for (const pattern of repetitivePatterns) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "gi");
    const matches = text.match(regex);
    if (matches) repetitiveCount += matches.length;
  }
  
  // ✅ Count EXACT duplicate bullets (same text appears 2+ times)
  const bulletTexts = bullets.map(b => b.replace(/^\s*[-•*]\s+/, '').trim().toLowerCase());
  const bulletCounts = new Map<string, number>();
  for (const bt of bulletTexts) {
    if (bt.length > 40) { // Only count longer bullets
      bulletCounts.set(bt, (bulletCounts.get(bt) || 0) + 1);
    }
  }
  const duplicateBullets = Array.from(bulletCounts.values()).filter(c => c > 1).reduce((a, b) => a + (b - 1), 0);
  
  // ✅ Penalty only for SEVERE repetition (much less aggressive)
  // Max penalty reduced from 50 to 25, multipliers reduced
  const repetitivePenalty = Math.min(25, (repetitiveCount * 5) + (duplicateBullets * 3));
  
  // ✅ Detect if all required sections are present
  const requiredSections = ["BEST OPTION", "RATIONALE", "TOP RISKS", "ASSUMPTIONS", "HALF-LIFE", "BLIND SPOTS", "NEXT ACTIONS"];
  const sectionsFound = requiredSections.filter(s => text.toUpperCase().includes(s)).length;
  const structureScore = sectionsFound >= 6 ? 20 : sectionsFound >= 4 ? 14 : sectionsFound >= 2 ? 8 : 0;

  // ✅ BONUS for Google/Gemini provider (featured)
  const providerBonus = item.provider === "google" ? 10 : 0;

  // ✅ Length score (increased)
  const lenScore =
    len >= 2000 ? 35 :
    len >= 1200 ? 32 :
    len >= 800 ? 28 :
    len >= 500 ? 24 :
    len >= 300 ? 18 :
    len >= 180 ? 12 :
    len > 0 ? 6 : 0;

  // ✅ Bullet score based on unique bullets (increased)
  const bulletScore = 
    bulletCount >= 20 ? 22 :
    bulletCount >= 15 ? 18 :
    bulletCount >= 10 ? 14 :
    bulletCount >= 5 ? 10 :
    bulletCount >= 2 ? 5 : 0;

  const okScore = ok ? 15 : -100;

  const latencyScore =
    latencyMs == null ? 0 :
    latencyMs <= 1000 ? 8 :
    latencyMs <= 2000 ? 6 :
    latencyMs <= 4000 ? 4 :
    latencyMs <= 8000 ? 2 : 0;

  // ✅ Final score calculation
  const rawScore = okScore + lenScore + bulletScore + latencyScore + structureScore + providerBonus - repetitivePenalty;
  const score = Math.max(0, Math.min(100, rawScore));
  
  const scoreReason = !ok 
    ? "Error" 
    : `ok + len(${len}) + bullets(${bulletCount}) + struct(${sectionsFound}/7)${providerBonus ? " + gemini" : ""}${repetitivePenalty > 0 ? ` - repeat(${repetitivePenalty})` : ""}`;

  return {
    provider: item.provider,
    model: item.model,
    ok,
    text,
    latencyMs,
    usage,
    error,
    score,
    scoreReason,
  };
}

function normalizeCompareResponse(resp: CompareResponse): NormalizedCompare[] {
  return (resp?.results ?? []).map(normalizeCompareItem);
}

function pickBestProvider(items: NormalizedCompare[]): ProviderId | null {
  const okItems = items.filter((x) => x.ok && x.text.trim().length > 0);
  if (!okItems.length) return null;

  const sorted = [...okItems].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const la = a.latencyMs ?? 999999;
    const lb = b.latencyMs ?? 999999;
    if (la !== lb) return la - lb;

    return a.provider.localeCompare(b.provider);
  });

  return sorted[0]?.provider ?? null;
}

// ✅ NEW: Get ranking for each provider (1st, 2nd, 3rd, etc.)
function getProviderRankings(items: NormalizedCompare[]): Map<ProviderId, { rank: number; medal: string; label: string }> {
  const okItems = items.filter((x) => x.ok && x.text.trim().length > 0);
  const rankings = new Map<ProviderId, { rank: number; medal: string; label: string }>();
  
  if (!okItems.length) return rankings;

  const sorted = [...okItems].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const la = a.latencyMs ?? 999999;
    const lb = b.latencyMs ?? 999999;
    if (la !== lb) return la - lb;
    return a.provider.localeCompare(b.provider);
  });

  // ✅ Winner = emoji + "Winner", others = emoji + number
  const rankData = [
    { medal: "🥇", label: "Winner" },      // 1st - no number
    { medal: "🥈", label: "2nd Place" },   // 2nd
    { medal: "🥉", label: "3rd Place" },   // 3rd
    { medal: "4️⃣", label: "4th Place" },  // 4th
    { medal: "5️⃣", label: "5th Place" },  // 5th
  ];
  
  sorted.forEach((item, index) => {
    const data = rankData[index] || { medal: `${index + 1}`, label: `${index + 1}th Place` };
    rankings.set(item.provider, {
      rank: index + 1,
      medal: data.medal,
      label: data.label,
    });
  });

  return rankings;
}

/* ---------------- Decision Themes System ---------------- */

// ✅ Theme type definition
type DecisionTheme = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  color: string;
  caseStudy: {
    title: string;
    context: string;
    intent: string;
    options: string;
    assumptions: string;
    risks: string;
    evidence: string;
    confidence: DecisionInput["confidence"];
    outcome: string;
    comparePrompt: string;
  };
};

// ✅ All available themes with viral 2025-2026 case studies
const DECISION_THEMES: Record<string, DecisionTheme> = {
  general: {
    id: "general",
    label: "General",
    emoji: "🌐",
    description: "General business decisions",
    color: "slate",
    caseStudy: {
      title: "Should we continue AI training with user data after the consent controversy went viral?",
      context: [
        "A global technology company has been accused of using user data to train AI models without explicit consent. The case went viral after internal leaks revealed data collection practices that were not clearly disclosed in the consent pages.",
        "",
        "The public reacted strongly, several partners suspended cooperation, and regulators announced a comprehensive review of the company's practices.",
      ].join("\n"),
      intent: "Decide on the immediate response strategy that balances business continuity with reputation recovery.",
      options: [
        "Option A: Immediately suspend all AI features using user data until full audit is complete.",
        "Option B: Pause new data collection, keep existing models running, launch transparency initiative.",
        "Option C: Update consent flows and communications, continue operations with enhanced user controls.",
        "Option D: Maintain current operations, prepare legal defense, wait for regulatory guidance.",
      ].join("\n"),
      assumptions: "Regulators will act within 60-90 days; early cooperation may influence outcomes.",
      risks: "Delayed response triggers class-action lawsuits or coordinated boycotts.",
      evidence: "Sentiment tracking: social media mentions down 40% negative after competitor crisis in 2023.",
      confidence: "medium",
      outcome: "Company chose Option B and announced within 36 hours. Initial media response was cautiously positive.",
      comparePrompt: "Analyze this AI ethics decision and provide structured recommendations for stakeholder management.",
    },
  },
  technology: {
    id: "technology",
    label: "Technology",
    emoji: "💻",
    description: "Tech & software decisions",
    color: "cyan",
    caseStudy: {
      title: "Should we migrate our entire infrastructure to AI-powered autonomous systems after the 2025 cloud outage crisis?",
      context: [
        "In January 2025, a major cloud provider experienced a 72-hour global outage affecting millions of businesses. Our company lost $2.3M in revenue and faced customer trust issues.",
        "",
        "New AI-powered autonomous infrastructure solutions promise 99.999% uptime with self-healing capabilities, but require significant investment and carry vendor lock-in risks.",
        "",
        "Competitors are rapidly adopting these solutions, and our engineering team is divided on the approach.",
      ].join("\n"),
      intent: "Decide whether to invest in AI-autonomous infrastructure or enhance existing multi-cloud strategy.",
      options: [
        "Option A: Full migration to AI-autonomous infrastructure (18-month timeline, $15M investment).",
        "Option B: Hybrid approach - critical systems on AI-autonomous, others on enhanced multi-cloud.",
        "Option C: Strengthen existing multi-cloud with better failover and monitoring.",
        "Option D: Wait for market maturity and learn from early adopters' experiences.",
      ].join("\n"),
      assumptions: "AI-autonomous systems will mature significantly by 2026. Our engineering team can be upskilled within 6 months.",
      risks: "Vendor lock-in with new AI providers. Migration complexity underestimated. New technology has undiscovered failure modes.",
      evidence: "Gartner 2025 report: 67% of enterprises planning AI infrastructure adoption. Early adopter case studies show 40% reduction in downtime.",
      confidence: "medium",
      outcome: "Decision pending board approval. Pilot program with Option B (hybrid approach) recommended for Q2 2026.",
      comparePrompt: "Analyze this technology infrastructure decision considering cloud reliability, AI maturity, and business continuity.",
    },
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    emoji: "🏥",
    description: "Medical & health decisions",
    color: "emerald",
    caseStudy: {
      title: "Should our hospital adopt AI-assisted diagnosis after the 2025 FDA approval of autonomous medical AI?",
      context: [
        "In March 2025, the FDA approved the first fully autonomous AI diagnostic system for radiology. Early adopters report 34% improvement in early cancer detection.",
        "",
        "Our hospital faces pressure from patients demanding access to 'AI-powered healthcare' and from insurance companies offering lower premiums for AI-assisted facilities.",
        "",
        "However, medical staff unions express concerns about job displacement, and there are unresolved questions about liability in case of AI diagnostic errors.",
      ].join("\n"),
      intent: "Decide on AI diagnostic adoption strategy that balances patient outcomes, staff concerns, and liability management.",
      options: [
        "Option A: Full adoption across all diagnostic departments with comprehensive staff retraining.",
        "Option B: Pilot program in radiology only, expand based on 12-month results.",
        "Option C: AI as 'second opinion' tool only - all final diagnoses remain with human doctors.",
        "Option D: Wait for more liability case law and peer hospital experiences.",
      ].join("\n"),
      assumptions: "FDA approval indicates sufficient safety validation. Insurance incentives will persist. Staff can adapt with proper training.",
      risks: "Medical malpractice liability unclear for AI errors. Staff resistance leads to implementation failures. Patient trust issues if AI makes errors.",
      evidence: "Johns Hopkins study: AI-assisted diagnosis reduced misdiagnosis by 28%. Mayo Clinic pilot: 15% staff initially resistant, dropped to 3% after training.",
      confidence: "medium",
      outcome: "Board voted for Option B (radiology pilot). 12-month evaluation scheduled for Q1 2027.",
      comparePrompt: "Analyze this healthcare AI adoption decision considering patient safety, regulatory compliance, and medical ethics.",
    },
  },
  legal: {
    id: "legal",
    label: "Legal",
    emoji: "⚖️",
    description: "Law & compliance decisions",
    color: "amber",
    caseStudy: {
      title: "Should our law firm use AI contract analysis after the 2025 landmark ruling on AI-generated legal documents?",
      context: [
        "In June 2025, the Supreme Court ruled that AI-generated legal documents are admissible if reviewed by licensed attorneys. This opened the floodgates for legal AI adoption.",
        "",
        "Competing firms are advertising '24-hour contract review' using AI, undercutting our pricing by 60%. Associates are concerned about job security.",
        "",
        "The State Bar issued guidance requiring disclosure of AI use to clients, and malpractice insurers are still developing AI-specific policies.",
      ].join("\n"),
      intent: "Decide on AI legal tools adoption that maintains quality standards while staying competitive.",
      options: [
        "Option A: Comprehensive AI adoption for document review, research, and draft generation.",
        "Option B: AI for initial review and research only, all client-facing work remains human.",
        "Option C: Create separate 'AI-assisted' service tier at lower price point.",
        "Option D: Position as 'premium human-only' firm for clients who prefer traditional approach.",
      ].join("\n"),
      assumptions: "AI legal tools will continue improving rapidly. Clients will accept AI-assisted work with proper disclosure. Malpractice coverage will be available.",
      risks: "AI errors in legal documents cause client harm. Disclosure requirements deter some clients. Associates leave for firms with clearer AI policies.",
      evidence: "ABA 2025 survey: 73% of clients accept AI-assisted legal work if disclosed. LegalTech study: AI reduced contract review time by 80%.",
      confidence: "medium",
      outcome: "Partnership committee approved Option C (tiered service). Launch planned for March 2026.",
      comparePrompt: "Analyze this legal technology decision considering professional ethics, client confidentiality, and competitive positioning.",
    },
  },
  finance: {
    id: "finance",
    label: "Finance",
    emoji: "💰",
    description: "Financial & investment decisions",
    color: "green",
    caseStudy: {
      title: "Should we offer AI-managed investment portfolios after the 2025 crypto-AI integration boom?",
      context: [
        "In 2025, AI-managed crypto portfolios outperformed traditional funds by 47%. Major brokerages launched AI wealth management services with $0 management fees.",
        "",
        "Our traditional wealth management firm faces client exodus to AI platforms. AUM dropped 23% in Q3 2025.",
        "",
        "Regulatory bodies are developing new frameworks for AI financial advisors, but guidance remains unclear on fiduciary duties of AI systems.",
      ].join("\n"),
      intent: "Decide on AI wealth management strategy that retains clients while managing regulatory and fiduciary risks.",
      options: [
        "Option A: Launch proprietary AI portfolio management competing directly with robo-advisors.",
        "Option B: Hybrid model - AI for portfolio optimization, humans for client relationships.",
        "Option C: Partner with established AI platform, white-label their technology.",
        "Option D: Double down on high-touch human service for ultra-high-net-worth clients only.",
      ].join("\n"),
      assumptions: "AI outperformance is sustainable, not just market timing luck. Regulatory framework will clarify within 12 months. Clients value some human interaction.",
      risks: "AI underperforms in market downturn, damaging reputation. Regulatory penalties for unclear AI fiduciary duties. Technology investment doesn't pay off.",
      evidence: "BlackRock 2025 report: 62% of millennials prefer AI-managed portfolios. SEC enforcement actions against 3 AI advisors for disclosure failures.",
      confidence: "medium",
      outcome: "Executive team chose Option B (hybrid). Implementation underway with 6-month review cycle.",
      comparePrompt: "Analyze this financial services decision considering fiduciary duties, regulatory compliance, and market competition.",
    },
  },
  politics: {
    id: "politics",
    label: "Government",
    emoji: "🏛️",
    description: "Government & public policy decisions",
    color: "red",
    caseStudy: {
      title: "Should our city invest in AI-powered smart city infrastructure after the 2025 digital transformation success stories?",
      context: [
        "In 2025, Singapore and Seoul showcased AI-powered smart city systems that reduced traffic congestion by 35% and improved emergency response times by 40%.",
        "",
        "Our city faces aging infrastructure and budget constraints. Proposed $50M AI smart city initiative promises efficiency gains but requires significant upfront investment.",
        "",
        "Citizens have mixed views: some excited about modernization, others concerned about data privacy and government surveillance.",
      ].join("\n"),
      intent: "Decide on smart city AI adoption that improves city services while addressing citizen concerns about privacy and cost.",
      options: [
        "Option A: Full smart city deployment with comprehensive citizen data protection framework.",
        "Option B: Phased approach starting with traffic and utilities, expand based on citizen feedback.",
        "Option C: Focus on non-data-intensive improvements like smart streetlights and waste management.",
        "Option D: Delay investment until more cities demonstrate long-term ROI.",
      ].join("\n"),
      assumptions: "Technology vendors can deliver on promises. Citizens will adopt new systems. Privacy safeguards will satisfy concerns.",
      risks: "Cost overruns exceed budget. Technology becomes obsolete before ROI achieved. Citizen backlash over data collection.",
      evidence: "Smart City Index 2025: AI-enabled cities report 28% efficiency improvement. Citizen survey: 62% support if privacy protected, 24% oppose.",
      confidence: "medium",
      outcome: "City council approved Option B (phased approach). Traffic pilot starting Q2 2026.",
      comparePrompt: "Analyze this public infrastructure decision considering citizen welfare, fiscal responsibility, and technological readiness.",
    },
  },
  religion: {
    id: "religion",
    label: "Religion & Ethics",
    emoji: "🕊️",
    description: "Religious & ethical decisions",
    color: "purple",
    caseStudy: {
      title: "Should our religious organization use AI for sermon writing and spiritual counseling after the 2025 'AI Pastor' controversy?",
      context: [
        "In 2025, a megachurch revealed their popular sermons were AI-generated, sparking global debate about authenticity in religious leadership.",
        "",
        "Our congregation is divided: younger members see AI as a tool for accessibility, older members view it as undermining spiritual authenticity.",
        "",
        "Other religious organizations are quietly adopting AI for administrative tasks, translation, and accessibility features.",
      ].join("\n"),
      intent: "Decide on AI adoption that serves congregation needs while maintaining spiritual authenticity and trust.",
      options: [
        "Option A: Full transparency - use AI openly for research, accessibility, never for core spiritual content.",
        "Option B: AI assistance for sermon research and drafts, all final content personally reviewed by clergy.",
        "Option C: AI only for administrative and accessibility (translation, captioning, scheduling).",
        "Option D: No AI use - position as authentically human spiritual community.",
      ].join("\n"),
      assumptions: "Congregation values authenticity but also accessibility. Younger members will accept transparent AI use. Spiritual guidance requires human connection.",
      risks: "Discovery of undisclosed AI use damages trust permanently. Falling behind on accessibility alienates disabled members. Staff time overwhelmed without AI help.",
      evidence: "Pew Research 2025: 67% of religious Americans uncomfortable with AI-generated spiritual content. 82% accept AI for accessibility features.",
      confidence: "low",
      outcome: "Council voted for Option B (AI research + human review). Transparency policy adopted.",
      comparePrompt: "Analyze this religious organization decision considering spiritual authenticity, community trust, and ethical transparency.",
    },
  },
  education: {
    id: "education",
    label: "Education",
    emoji: "📚",
    description: "Educational decisions",
    color: "blue",
    caseStudy: {
      title: "Should our university allow AI tutors after the 2025 academic integrity crisis?",
      context: [
        "In 2025, studies revealed 78% of students used AI for assignments. Universities struggled to distinguish AI-assisted from original work.",
        "",
        "New AI tutoring systems promise personalized learning with built-in integrity monitoring. Early adopters report 34% improvement in learning outcomes.",
        "",
        "Faculty are divided: some see AI as inevitable tool, others fear it undermines critical thinking and academic rigor.",
      ].join("\n"),
      intent: "Decide on AI integration strategy that enhances learning while maintaining academic integrity.",
      options: [
        "Option A: Embrace AI tutors fully, redesign assessments to test application rather than recall.",
        "Option B: AI tutors for practice and review, traditional assessments remain AI-free.",
        "Option C: AI detection tools + strict policies, minimal AI integration.",
        "Option D: Create 'AI-assisted' and 'traditional' tracks, let students choose.",
      ].join("\n"),
      assumptions: "AI detection tools will remain somewhat effective. Students will follow clear guidelines. Learning outcomes matter more than process purity.",
      risks: "Academic integrity becomes unenforceable. Faculty resistance slows implementation. Graduates lack critical thinking skills employers need.",
      evidence: "Stanford 2025 study: AI tutoring improved test scores 34% but reduced creative problem-solving 12%. Student survey: 89% want clear AI use guidelines.",
      confidence: "medium",
      outcome: "Faculty senate approved Option B (AI tutors for practice). Policy rollout Fall 2026.",
      comparePrompt: "Analyze this educational decision considering academic integrity, learning outcomes, and future workforce preparation.",
    },
  },
  environment: {
    id: "environment",
    label: "Environment",
    emoji: "🌍",
    description: "Environmental & sustainability decisions",
    color: "teal",
    caseStudy: {
      title: "Should our company commit to AI-optimized carbon neutrality after the 2025 climate disclosure mandates?",
      context: [
        "In 2025, SEC mandated climate risk disclosure for all public companies. AI-powered carbon management systems can track, optimize, and verify emissions in real-time.",
        "",
        "Our company faces pressure from ESG investors threatening divestment. Competitors are marketing 'AI-verified carbon neutral' products at premium prices.",
        "",
        "Implementation costs are significant, and some environmental groups criticize AI carbon solutions as 'greenwashing enablers'.",
      ].join("\n"),
      intent: "Decide on carbon management strategy that meets regulatory requirements while building genuine environmental credibility.",
      options: [
        "Option A: Comprehensive AI carbon management with third-party verification and full transparency.",
        "Option B: AI for internal optimization, traditional auditors for external reporting.",
        "Option C: Join industry consortium for shared AI carbon platform to reduce costs.",
        "Option D: Minimum compliance approach, invest savings in actual emission reduction projects.",
      ].join("\n"),
      assumptions: "AI carbon tracking will become industry standard. ESG investors will reward early adopters. Regulatory requirements will tighten further.",
      risks: "AI system errors lead to misreported emissions and regulatory penalties. Greenwashing accusations damage brand. Technology costs exceed benefits.",
      evidence: "McKinsey 2025: AI carbon management reduces emissions 23% through optimization. SEC enforcement: 12 companies penalized for climate disclosure errors.",
      confidence: "medium",
      outcome: "Board approved Option A (full AI carbon management). RFP issued to 3 vendors.",
      comparePrompt: "Analyze this environmental decision considering regulatory compliance, stakeholder expectations, and genuine sustainability impact.",
    },
  },
  media: {
    id: "media",
    label: "Media & Entertainment",
    emoji: "🎬",
    description: "Media & entertainment decisions",
    color: "pink",
    caseStudy: {
      title: "Should our studio use AI actors after the 2025 SAG-AI agreement?",
      context: [
        "In late 2025, SAG-AFTRA reached a landmark agreement allowing AI-generated performances with actor consent and residuals. Studios can now legally use 'digital twins'.",
        "",
        "Production costs for AI-generated content are 70% lower. Streaming platforms are flooding the market with AI content.",
        "",
        "Audience research shows mixed reactions: some prefer AI content, others actively seek 'human-only' productions.",
      ].join("\n"),
      intent: "Decide on AI content production strategy that balances cost efficiency with audience preferences and talent relations.",
      options: [
        "Option A: Aggressive AI adoption - maximize AI content, minimize human actors except for leads.",
        "Option B: Hybrid productions - AI for background, stunts, and de-aging; humans for performances.",
        "Option C: 'Human-crafted' brand positioning - no AI performances, premium pricing.",
        "Option D: Separate AI and human content brands for different market segments.",
      ].join("\n"),
      assumptions: "AI content quality will continue improving. Some audience segments will always prefer human performances. Talent relations affect future recruitment.",
      risks: "AI content saturates market, reducing all content value. 'Human-only' positioning fails if audience doesn't care. Talent backlash affects future productions.",
      evidence: "Netflix 2025 data: AI content has 23% lower completion rate but 60% lower production cost. Audience survey: 34% prefer human-only, 28% no preference.",
      confidence: "medium",
      outcome: "Studio greenlit Option D (separate brands). AI brand launches Q3 2026.",
      comparePrompt: "Analyze this entertainment industry decision considering creative authenticity, production economics, and audience preferences.",
    },
  },
  transportation: {
    id: "transportation",
    label: "Transportation",
    emoji: "🚗",
    description: "Logistics & transport decisions",
    color: "orange",
    caseStudy: {
      title: "Should our city approve autonomous vehicle zones after the 2025 Waymo fatality lawsuit?",
      context: [
        "In 2025, a Waymo autonomous vehicle fatality led to $450M settlement and stricter federal oversight. Public trust in AVs dropped 34%.",
        "",
        "Our city's traffic congestion costs $2.1B annually. AV companies offer to deploy free pilot programs with extensive insurance coverage.",
        "",
        "Taxi and rideshare drivers threaten strikes if AV zones are approved. Disability advocates support AVs for mobility access.",
      ].join("\n"),
      intent: "Decide on autonomous vehicle policy that balances innovation, safety, labor concerns, and accessibility.",
      options: [
        "Option A: Approve limited AV zones with extensive monitoring and quick suspension triggers.",
        "Option B: AV-only zones in industrial/low-pedestrian areas, expand based on safety data.",
        "Option C: Reject AV zones until federal safety standards are strengthened.",
        "Option D: Approve AVs only for accessibility services (disabled, elderly transport).",
      ].join("\n"),
      assumptions: "AV technology will continue improving. Insurance can adequately cover accidents. Federal oversight will provide clearer guidance.",
      risks: "AV accident in our city triggers massive liability and political fallout. Labor unrest disrupts city services. Rejecting AVs makes city uncompetitive.",
      evidence: "NHTSA 2025: AVs have 40% fewer accidents per mile than human drivers. Labor study: 12,000 local jobs at risk from AV adoption.",
      confidence: "low",
      outcome: "Council deferred decision pending federal guidance. Review scheduled Q4 2026.",
      comparePrompt: "Analyze this urban policy decision considering public safety, economic impact, and technological innovation.",
    },
  },
};

// ✅ Theme options for dropdown
const THEME_OPTIONS = Object.values(DECISION_THEMES).map(t => ({
  id: t.id,
  label: `${t.emoji} ${t.label}`,
  description: t.description,
}));

/* ---------------- Page ---------------- */

// Default case study template (used when resetting to new case)
const DEFAULT_CASE_STUDY = {
  title: "Should we continue AI training with user data after the consent controversy went viral?",
  context: [
    "A global technology company has been accused of using user data to train AI models without explicit consent. The case went viral after internal leaks revealed data collection practices that were not clearly disclosed in the consent pages. The public reacted strongly, several partners suspended cooperation, and regulators announced a comprehensive review of the company's practices.",
    "",
    "The decision to be made is whether the company should immediately suspend the related features, change policies and public communications while continuing to operate, or maintain the current system while awaiting the review results.",
    "",
    "Analysis must consider:",
    "- Short-term reputation damage and potential long-term brand erosion",
    "- Risk of escalating public pressure and regulatory action",
    "- Business dependency on the feature in question",
    "- Concrete steps to take within 30 days to reduce risk and restore trust"
  ].join("\n"),
  intent: [
    "Decide on the immediate response strategy that balances business continuity with reputation recovery.",
    "",
    "Success looks like:",
    "- Clear action plan communicated within 48 hours",
    "- Stakeholder confidence stabilized within 2 weeks",
    "- No further partner defections or regulatory escalation",
    "- Framework for transparent data practices going forward"
  ].join("\n"),
  options: [
    "Option A: Immediately suspend all AI features using user data until full audit is complete (highest trust signal, highest business disruption).",
    "Option B: Pause new data collection, keep existing models running, launch transparency initiative (moderate disruption, moderate trust signal).",
    "Option C: Update consent flows and communications, continue operations with enhanced user controls (lowest disruption, requires strong messaging).",
    "Option D: Maintain current operations, prepare legal defense, wait for regulatory guidance (high risk if pressure escalates)."
  ].join("\n"),
  assumptions: [
    "Regulators will act within 60-90 days; early cooperation may influence outcomes.",
    "Partners are waiting for a credible response before making final decisions on cooperation.",
    "Users who stay are more engaged; vocal critics may not represent the majority.",
    "Technical changes to consent flows can be implemented within two to three weeks.",
    "The media cycle will move on if a clear, decisive action is taken quickly."
  ].join("\n"),
  risks: [
    "Delayed response triggers class-action lawsuits or coordinated boycotts.",
    "Competitors exploit the situation with 'privacy-first' positioning.",
    "Key engineering talent leaves due to ethical concerns.",
    "Regulatory penalties exceed projected reserves.",
    "Internal leak of response strategy further damages credibility."
  ].join("\n"),
  evidence: [
    "Sentiment tracking: social media mentions down 40% negative after competitor crisis in 2023 (baseline).",
    "Partner survey: 3 of 8 major partners have paused discussions pending response.",
    "User data: 12% increase in account deletions this week vs. baseline.",
    "Legal review: preliminary assessment suggests defensible position but high litigation cost.",
    "Internal poll: 67% of employees support proactive transparency measures."
  ].join("\n"),
  confidence: "medium" as DecisionInput["confidence"],
  // ✅ Added outcome example for demo
  outcome: [
    "Company chose Option B and announced within 36 hours.",
    "Initial media response was cautiously positive.",
    "2 of 3 partners resumed discussions after transparency roadmap was shared.",
    "Regulatory review ongoing but no escalation signals.",
  ].join("\n"),
  // ✅ Default compare prompt for template
  comparePrompt: [
    "Analyze the decision scenario and provide a structured recommendation.",
    "Consider all stakeholders: customers, partners, regulators, employees.",
    "Focus on actionable next steps with clear ownership and timelines."
  ].join("\n"),
};

export default function Page() {
  const router = useRouter();
  const toast = useToast();

  // ✅ Single hook call (avoid hooks inside loops/maps)
  const reduceMotion = useReducedMotion();

  // LocalStorage keys (versioned)
  const LS_COMPARE = "grounds:lastCompare:v1";
  const LS_COMPARE_ISO = "grounds:lastCompareISO:v1";

  const LS_FORM = "grounds:form:v1";
  const LS_COMPARE_CFG = "grounds:compareCfg:v1";

  // ---------------- form state ----------------
  // ✅ State persists in localStorage - uses defaults only if no saved data
  const [title, setTitle] = useState(DEFAULT_CASE_STUDY.title);
  const [context, setContext] = useState(DEFAULT_CASE_STUDY.context);
  const [intent, setIntent] = useState(DEFAULT_CASE_STUDY.intent);
  const [options, setOptions] = useState(DEFAULT_CASE_STUDY.options);
  const [assumptions, setAssumptions] = useState(DEFAULT_CASE_STUDY.assumptions);
  const [risks, setRisks] = useState(DEFAULT_CASE_STUDY.risks);
  const [evidence, setEvidence] = useState(DEFAULT_CASE_STUDY.evidence);
  const [confidence, setConfidence] = useState<DecisionInput["confidence"]>(DEFAULT_CASE_STUDY.confidence);
  const [outcome, setOutcome] = useState(DEFAULT_CASE_STUDY.outcome);


  // ✅ NEW: Selected theme for decision context
  const [selectedTheme, setSelectedTheme] = useState<string>("general");
  
  // ✅ NEW: Stepper sidebar state - hidden by default, shown when user clicks Guide button
  const [activeStep, setActiveStep] = useState<StepId>("theme");
  const [stepperVisible, setStepperVisible] = useState(false);
  const [stepperMinimized, setStepperMinimized] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<StepId[]>([]);
  
  // ✅ NEW: Document scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ percent: number; label: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // stable createdAtISO (don’t change on each keystroke)
  const [createdAtISO, setCreatedAtISO] = useState<string>(() => new Date().toISOString());

  // ---------------- typing glow ----------------
  const typingTimersRef = useRef<Record<string, number | null>>({});
  const [typingGlow, setTypingGlow] = useState<Record<string, boolean>>({});

  // ---------------- input area animation key (for fade-in after reset/template) ----------------
  const [inputAreaKey, setInputAreaKey] = useState(0);

  function pulseGlow(key: string) {
    setTypingGlow((p) => ({ ...p, [key]: true }));
    const old = typingTimersRef.current[key];
    if (old) window.clearTimeout(old);
    typingTimersRef.current[key] = window.setTimeout(() => {
      setTypingGlow((p) => ({ ...p, [key]: false }));
      typingTimersRef.current[key] = null;
    }, 900);
  }

  function setWithGlow(key: string, setter: (v: string) => void) {
    return (evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | string) => {
      const next = typeof evt === "string" ? evt : evt.target.value;
      setter(next);
      pulseGlow(key);
    };
  }

  const input: DecisionInput = useMemo(() => {
    return {
      title,
      context,
      intent,
      options: options
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      assumptions: assumptions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      risks: risks
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      evidence: evidence
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      confidence,
      createdAtISO,
      outcome: outcome.trim() ? outcome : undefined,
    };
  }, [title, context, intent, options, assumptions, risks, evidence, confidence, outcome, createdAtISO]);

  const analysis = useMemo(() => analyzeDecision(input), [input]);

  // Reset isProcessed when user changes any input (so they need to Process again)
  useEffect(() => {
    setIsProcessed(false);
  }, [title, context, intent, options, assumptions, risks, evidence, confidence]);

  // Compute radar chart data from analysis
  useEffect(() => {
    if (analysis) {
      const confidenceMap: Record<string, number> = { low: 30, medium: 60, high: 90 };
      const confValue = confidenceMap[confidence.toLowerCase()] || 50;
      
      const newRadar: RadarChartData = {
        readiness: analysis.readiness.score,
        riskCoverage: Math.min(100, (risks.split('\n').filter(r => r.trim()).length) * 20),
        evidenceQuality: Math.min(100, (evidence.split('\n').filter(e => e.trim()).length) * 25),
        assumptionClarity: Math.min(100, (assumptions.split('\n').filter(a => a.trim()).length) * 25),
        actionability: analysis.readiness.score >= 70 ? 85 : analysis.readiness.score >= 50 ? 60 : 40,
        confidence: confValue,
      };
      setRadarData(newRadar);
    }
  }, [analysis, confidence, risks, evidence, assumptions]);

  /* ---------------- Grade tooltip ---------------- */

  const GRADE_INFO: Record<string, { title: string; lines: string[] }> = useMemo(() => {
    return {
      A: {
        title: "Grade A: Decision-grade",
        lines: [
          "Clear, specific, and actionable.",
          "Has real options, key assumptions, major risks, and at least some evidence.",
          "Hard edges exist: metrics, deadline, budget, or constraints.",
          "You can safely review, export, and share as a brief.",
          "Grades used: A, B, C, D, F.",
        ],
      },
      B: {
        title: "Grade B: Strong draft",
        lines: [
          "Mostly decision-grade, but one area is under-specified.",
          "Typical gaps: weak evidence, fuzzy success metric, or thin assumptions.",
          "Good enough to decide internally, but tighten one or two items before sharing widely.",
          "Quick upgrade: add one measurable constraint and one evidence line.",
          "Grades used: A, B, C, D, F.",
        ],
      },
      C: {
        title: "Grade C: Needs work",
        lines: [
          "You have the outline, but it’s not yet safe to act on.",
          "Usually missing hard edges, or options and assumptions are too thin.",
          "Good for exploration, not for commitment.",
          "Quick upgrade: add two realistic options and two assumptions that would flip the decision.",
          "Grades used: A, B, C, D, F.",
        ],
      },
      D: {
        title: "Grade D: Incomplete brief",
        lines: [
          "Too many missing inputs or too vague to evaluate.",
          "High risk of decision churn because the brief doesn’t constrain outcomes.",
          "Use this as a scratchpad, then add structure.",
          "Quick upgrade: rewrite intent in concrete terms and add evidence or metrics.",
          "Grades used: A, B, C, D, F.",
        ],
      },
      F: {
        title: "Grade F: Not decision-ready",
        lines: [
          "Insufficient detail to recommend or compare options.",
          "Often missing options, risks, and evidence entirely.",
          "Treat as a placeholder until you add basic structure.",
          "Quick upgrade: write three options, three risks, and one evidence line.",
          "Grades used: A, B, C, D, F.",
        ],
      },
      "?": {
        title: "Grade: Unknown",
        lines: ["No grade available yet.", "Grades used: A, B, C, D, F."],
      },
    };
  }, []);

  const gradeTip = useMemo(() => {
    const g = String(analysis.readiness.grade || "").trim().toUpperCase();
    return GRADE_INFO[g] ?? GRADE_INFO["?"];
  }, [analysis.readiness.grade, GRADE_INFO]);

  /* ---------------- Ledger helpers ---------------- */

  function appendIntentSnapshot(reason?: string) {
    const evt: LedgerEvent = {
      id: uid(),
      type: "INTENT_SNAPSHOT",
      createdAtISO: new Date().toISOString(),
      title,
      context,
      intent,
      options: input.options,
      assumptions: input.assumptions,
      risks: input.risks,
      evidence: input.evidence,
      confidence,
      outcome: input.outcome,
      reason: reason ?? undefined,
    } as LedgerEvent;

    appendEvent(evt);
  }

  function appendDecisionEvent(meta?: { compareWinner?: ProviderId | null }) {
    const evt: LedgerEvent = {
      id: uid(),
      type: "DECISION",
      createdAtISO: new Date().toISOString(),
      title,
      selectedOptionIndex: 0,
      selectedOption: input.options?.[0] ?? null,
      rationale: "Generated from Process action. Upgrade this later with a real selected option + rationale from analysis.",
      confidence,
      links: [],
      meta: meta ?? undefined,
    } as LedgerEvent;

    appendEvent(evt);
  }

  const outcomeDebounceRef = useRef<number | null>(null);
  const lastOutcomeWrittenRef = useRef<string>("");

  useEffect(() => {
    const clean = (outcome ?? "").trim();

    if (outcomeDebounceRef.current) window.clearTimeout(outcomeDebounceRef.current);

    outcomeDebounceRef.current = window.setTimeout(() => {
      if (!clean) return;
      if (clean === lastOutcomeWrittenRef.current) return;

      const evt: LedgerEvent = {
        id: uid(),
        type: "OUTCOME",
        createdAtISO: new Date().toISOString(),
        title,
        outcome: clean,
        evidenceHint: (evidence ?? "").split("\n").filter(Boolean).slice(-1)[0] ?? null,
        source: "manual_or_compare",
      } as LedgerEvent;

      appendEvent(evt);
      lastOutcomeWrittenRef.current = clean;
    }, 650);

    return () => {
      if (outcomeDebounceRef.current) window.clearTimeout(outcomeDebounceRef.current);
    };
  }, [outcome, evidence, title]);

  /* ---------------- Text-driven “Decision signals” ---------------- */

  const textSignals = useMemo(() => {
    const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
    const lineCount = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean).length;

    const titleWords = wc(title);
    const contextWords = wc(context);
    const intentWords = wc(intent);

    const opts = input.options.length;
    const assm = input.assumptions.length;
    const rsk = input.risks.length;
    const evd = input.evidence.length;

    const outcomeWords = wc(outcome || "");

    const genericMarkers = [
      "good",
      "nice",
      "better",
      "optimize",
      "improve",
      "perfect",
      "synergy",
      "leverage",
      "robust",
      "scalable",
      "world-class",
      "premium",
      "elegant",
      "durable",
    ];

    const genericHit =
      (intent.toLowerCase().includes("premium") ? 1 : 0) +
      genericMarkers.reduce((acc, m) => acc + (context.toLowerCase().includes(m) ? 1 : 0), 0) +
      genericMarkers.reduce((acc, m) => acc + (intent.toLowerCase().includes(m) ? 1 : 0), 0);

    const hasNumbers =
      /(\b\d+%|\b\d+\b|\bms\b|\bday\b|\bweek\b|\bmonth\b|\byear\b|\bUSD\b|\bIDR\b)/i.test(
        context + " " + intent + " " + evidence + " " + risks
      );

    const ambiguity =
      (opts < 2 ? 2 : 0) +
      (assm < 2 ? 2 : 0) +
      (evd < 1 ? 2 : 0) +
      (rsk < 2 ? 1 : 0) +
      (intentWords < 14 ? 1 : 0);

    const completeness = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (Math.min(1, titleWords / 3) * 12 +
            Math.min(1, contextWords / 60) * 22 +
            Math.min(1, intentWords / 18) * 18 +
            Math.min(1, opts / 3) * 16 +
            Math.min(1, assm / 3) * 12 +
            Math.min(1, rsk / 3) * 10 +
            Math.min(1, evd / 2) * 10) *
            1.0
        )
      )
    );

    const clarityPenalty =
      (genericHit >= 3 ? 12 : genericHit === 2 ? 7 : genericHit === 1 ? 3 : 0) + (hasNumbers ? 0 : 4);

    const actionability = Math.max(0, Math.min(100, completeness - clarityPenalty - ambiguity * 3));

    const nextFix: Array<{ key: string; icon: React.ReactNode; title: string; note: string }> = [];
    if (opts < 2) {
      nextFix.push({
        key: "options",
        icon: <ListChecks className="h-4 w-4" />,
        title: "Options are too thin",
        note: "Add at least two real choices. Include a baseline option if needed.",
      });
    }
    if (assm < 2) {
      nextFix.push({
        key: "assumptions",
        icon: <Lightbulb className="h-4 w-4" />,
        title: "Assumptions need leverage",
        note: "Write two or three assumptions that would flip the decision if false.",
      });
    }
    if (evd < 1) {
      nextFix.push({
        key: "evidence",
        icon: <ShieldCheck className="h-4 w-4" />,
        title: "Evidence is missing",
        note: "Add at least one proof line: a link, metric, experiment, or user signal.",
      });
    }
    if (!hasNumbers) {
      nextFix.push({
        key: "hard_edges",
        icon: <Timer className="h-4 w-4" />,
        title: "Not enough hard edges",
        note: "Add at least one measurable constraint (deadline, budget, success metric).",
      });
    }
    if (genericHit >= 2) {
      nextFix.push({
        key: "generic",
        icon: <TriangleAlert className="h-4 w-4" />,
        title: "Language is generic",
        note: "Replace “premium / elegant / durable” with concrete definitions.",
      });
    }
    if (outcomeWords > 0 && evd === 0) {
      nextFix.push({
        key: "trail",
        icon: <ShieldCheck className="h-4 w-4" />,
        title: "Outcome but no evidence trail",
        note: "Capture what you observed along with a timestamp or source.",
      });
    }

    const hintLine =
      nextFix.length === 0
        ? "Nice work. Inputs are concrete. Next up: assign an owner and define the review trigger."
        : "Fix the top one or two items below to make this decision-grade.";

    return {
      completeness,
      actionability,
      hasNumbers,
      genericHit,
      lineCounts: {
        options: lineCount(options),
        assumptions: lineCount(assumptions),
        risks: lineCount(risks),
        evidence: lineCount(evidence),
      },
      nextFix: nextFix.slice(0, 4),
      hintLine,
    };
  }, [
    title,
    context,
    intent,
    options,
    assumptions,
    risks,
    evidence,
    outcome,
    input.options.length,
    input.assumptions.length,
    input.risks.length,
    input.evidence.length,
  ]);

  const completenessTip = useMemo(() => {
    const lines: string[] = [
      `Coverage of required inputs (counts + minimum detail).`,
      `Options: ${textSignals.lineCounts.options} · Assumptions: ${textSignals.lineCounts.assumptions} · Risks: ${textSignals.lineCounts.risks} · Evidence: ${textSignals.lineCounts.evidence}`,
    ];

    if (textSignals.nextFix.length) {
      lines.push("Top gaps to reach 100:");
      for (const x of textSignals.nextFix.slice(0, 2)) lines.push(x.note);
    } else {
      lines.push("No obvious gaps. Coverage is decision-grade.");
    }

    return {
      title: `Completeness · ${textSignals.completeness}/100`,
      lines,
    };
  }, [textSignals]);

  const actionabilityTip = useMemo(() => {
    const lines: string[] = [
      "How usable this is for an actual decision (clarity + hard edges).",
      `Hard edges: ${textSignals.hasNumbers ? "present" : "missing"} · Generic phrasing: ${textSignals.genericHit}`,
    ];

    if (textSignals.nextFix.length) {
      lines.push("Fastest upgrades:");
      for (const x of textSignals.nextFix.slice(0, 2)) lines.push(x.title);
    } else {
      lines.push("Actionable as-is. Pick the option, assign an owner, and set the review trigger.");
    }

    return {
      title: `Actionability · ${textSignals.actionability}/100`,
      lines,
    };
  }, [textSignals]);

  /* ---------------- top badges ---------------- */

  const badges = useMemo(() => {
    const r = analysis.readiness;
    const h = analysis.halfLife;
    const b = analysis.blindSpots;

    const readinessTone: Tone = r.score >= 80 ? "good" : r.score >= 65 ? "info" : r.score >= 50 ? "warn" : "bad";
    const halfLifeTone: Tone = h.status === "stable" ? "good" : h.status === "degrading" ? "warn" : "bad";
    const blindTone: Tone = b.score >= 80 ? "good" : b.score >= 60 ? "warn" : "bad";

    return [
      { label: 'Readiness', score: `${r.score}/100`, tone: readinessTone, hint: 'Clarity + coverage of inputs.' },
      { label: 'Half-life:', score: h.status, tone: halfLifeTone, hint: 'How likely context stays valid.' },
      { label: 'Blind spots', score: `${b.score}/100`, tone: blindTone, hint: 'Checks what you did not write down.' },
    ];
  }, [analysis]);

  /* ---------------- report state ---------------- */

  const [lastHTML, setLastHTML] = useState<string>("");
  const [lastReportId, setLastReportId] = useState<string>("");
  const [isWorking, setIsWorking] = useState(false);
  const [isProcessed, setIsProcessed] = useState(false); // Track if Process button was clicked

  // ✅ Inline preview modal state (consistent UX like Gallery)
  const [previewModal, setPreviewModal] = useState<{
    open: boolean;
    kind: "html" | "pdf";
    url: string;
    filename: string;
  } | null>(null);
  const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark");

  // ✅ Keep a synchronous copy for preview generation (avoid React state timing pitfalls)
  const lastHTMLRef = useRef<string>("");

  const htmlUrlRef = useRef<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  // Persist Gemini Critic result in parent (state) AND a ref (sync read during Process)
  const [geminiCritic, setGeminiCritic] = useState<GeminiCriticResult | null>(null);
  const geminiCriticRef = useRef<GeminiCriticResult | null>(null);

  // NEW: Sentiment Analysis state
  const [sentimentData, setSentimentData] = useState<SentimentAnalysisData | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const sentimentRef = useRef<SentimentAnalysisData | null>(null);

  // NEW: Executive Conclusion state
  const [conclusionData, setConclusionData] = useState<ConclusionData | null>(null);
  const [conclusionLoading, setConclusionLoading] = useState(false);
  const conclusionRef = useRef<ConclusionData | null>(null);

  // NEW: Related Research state
  const [researchData, setResearchData] = useState<RelatedResearchData | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const researchRef = useRef<RelatedResearchData | null>(null);

  // NEW: Extras progress state (like scan image)
  const [extrasProgress, setExtrasProgress] = useState<{ percent: number; label: string } | null>(null);

  // NEW: Radar Chart data (computed from analysis)
  const [radarData, setRadarData] = useState<RadarChartData | null>(null);

  // NEW: Deep Reasoner Stress Test state
  const [stressTestData, setStressTestData] = useState<StressTestReportData | null>(null);
  const [stressTestLoading, setStressTestLoading] = useState(false);
  const stressTestRef = useRef<StressTestReportData | null>(null);

  function cleanupUrl(ref: React.MutableRefObject<string | null>) {
    if (ref.current) URL.revokeObjectURL(ref.current);
    ref.current = null;
  }

  function saveSnapshot(reason?: string) {
    appendIntentSnapshot(reason);
    toast.show("Snapshot saved ✓");
  }

  /* ---------------- Compare state ---------------- */

  const [compareEnabled, setCompareEnabled] = useState<Partial<Record<ProviderId, boolean>>>({
    openai: false,
    groq: true,
    google: true,
    openrouter: true,
  });

  const [compareModels, setCompareModels] = useState<Partial<Record<ProviderId, string>>>({
    openai: MODEL_OPTIONS.openai[0]?.value ?? "gpt-4o-mini",
    groq: MODEL_OPTIONS.groq[0]?.value ?? "llama-3.1-8b-instant",
    google: "gemini-1.5-flash",
    openrouter: MODEL_OPTIONS.openrouter[0]?.value ?? "meta-llama/llama-3.1-8b-instruct",
  });

  const [comparePrompt, setComparePrompt] = useState<string>(
    "Analyze this decision and output EXACTLY these sections with 2-5 bullets each:\n\n## BEST OPTION\n## RATIONALE\n## TOP RISKS\n## ASSUMPTIONS TO VALIDATE\n## HALF-LIFE\n## BLIND SPOTS\n## NEXT ACTIONS\n\nBe specific. Include metrics, dates, and concrete actions where possible."
  );

  const [compareAttachToReport, setCompareAttachToReport] = useState<boolean>(true);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareResp, setCompareResp] = useState<CompareResponse | null>(null);
  const [compareLastISO, setCompareLastISO] = useState<string>("");

  const [pinnedProvider, setPinnedProvider] = useState<ProviderId | null>("google"); // Google featured by default for Gemini hackathon
  const [winnerProvider, setWinnerProvider] = useState<ProviderId | null>(null);

  // Template Picker state
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Google Export modal state
  const [showGoogleExport, setShowGoogleExport] = useState(false);

  // Handle template selection
  function handleTemplateSelect(template: DecisionTemplate) {
    setTitle(template.title);
    setContext(template.context);
    setIntent(template.intent);
    setOptions(template.options);
    setAssumptions(template.assumptions);
    setRisks(template.risks);
    setEvidence(template.evidence);
    
    // Set compare prompt based on template theme/category
    const comparePrompts: Record<string, string> = {
      technology: "Analyze this technology decision considering implementation risks, ROI, and long-term scalability.",
      healthcare: "Analyze this healthcare decision considering patient safety, regulatory compliance, and clinical outcomes.",
      finance: "Analyze this financial decision considering risk management, ROI projections, and market conditions.",
      education: "Analyze this educational decision considering learning outcomes, accessibility, and institutional goals.",
      legal: "Analyze this legal decision considering regulatory compliance, risk exposure, and professional ethics.",
      realestate: "Analyze this real estate decision considering market trends, operational efficiency, and long-term value.",
      travel: "Analyze this travel/mobility decision considering cost efficiency, sustainability, and operational impact.",
      hr: "Analyze this HR decision considering employee wellbeing, productivity, and organizational culture.",
      research: "Analyze this research decision considering methodology rigor, resource allocation, and expected outcomes.",
      startup: "Analyze this startup decision considering market opportunity, runway, and competitive positioning.",
      general: "Analyze this decision considering all relevant factors, risks, and potential outcomes.",
    };
    const promptForTheme = comparePrompts[template.theme] || comparePrompts.general;
    setComparePrompt(promptForTheme);
    
    // Update theme based on template's theme
    if (template.theme && DECISION_THEMES[template.theme]) {
      setSelectedTheme(template.theme);
    }
    
    setShowTemplatePicker(false);
    setInputAreaKey((k: number) => k + 1); // Trigger animation
    
    const themeInfo = template.theme && DECISION_THEMES[template.theme] 
      ? `${DECISION_THEMES[template.theme].emoji} ${DECISION_THEMES[template.theme].label}` 
      : '🌐 General';
    toast.show(`📋 Template loaded: "${template.title}" (${themeInfo})`);
  }

  /* ---------------- NEW: Fetch Sentiment Analysis ---------------- */
  async function fetchSentiment() {
    if (sentimentLoading) return;
    setSentimentLoading(true);
    try {
      const payload = {
        title: title.trim(),
        context: context.trim(),
        intent: intent.trim(),
        options: options.trim(),
        assumptions: assumptions.trim(),
        risks: risks.trim(),
        evidence: evidence.trim(),
        outcome: outcome.trim(),
      };
      const res = await fetch("/api/sentiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Sentiment API error: ${res.status}`);
      const data = await res.json();
      if (data.success && data.aspects) {
        const result: SentimentAnalysisData = {
          aspects: data.aspects,
          overallSentiment: data.overallSentiment || "neutral",
          overallConfidence: data.overallConfidence || 70,
          summary: data.summary || "",
          modelUsed: data.modelUsed || "Llama 4 Scout",
        };
        setSentimentData(result);
        sentimentRef.current = result;
        toast.show("Sentiment analysis complete");
      }
    } catch (err) {
      console.error("Sentiment fetch error:", err);
      toast.show("Sentiment analysis failed");
    } finally {
      setSentimentLoading(false);
    }
  }

  /* ---------------- NEW: Fetch Executive Conclusion ---------------- */
  async function fetchConclusion() {
    if (conclusionLoading) return;
    setConclusionLoading(true);
    try {
      const payload = {
        title: title.trim(),
        context: context.trim(),
        intent: intent.trim(),
        options: options.trim(),
        risks: risks.trim(),
        readinessScore: analysis.readiness.score,
        grade: analysis.readiness.grade,
        confidence: confidence,
        theme: selectedTheme,
      };
      const res = await fetch("/api/conclusion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Conclusion API error: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const result: ConclusionData = {
          summary: data.summary || "",
          recommendation: data.recommendation || "",
          keyTakeaways: data.keyTakeaways || [],
          nextSteps: data.nextSteps || [],
          reviewDate: data.reviewDate || "2 weeks from now",
          confidenceStatement: data.confidenceStatement || "",
        };
        setConclusionData(result);
        conclusionRef.current = result;
        toast.show("Conclusion generated");
      }
    } catch (err) {
      console.error("Conclusion fetch error:", err);
      toast.show("Conclusion generation failed");
    } finally {
      setConclusionLoading(false);
    }
  }

  /* ---------------- NEW: Fetch Related Research ---------------- */
  async function fetchResearch() {
    if (researchLoading) return;
    setResearchLoading(true);
    try {
      const payload = {
        title: title.trim(),
        context: context.trim(),
        theme: selectedTheme,
      };
      const res = await fetch("/api/related-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Research API error: ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const result: RelatedResearchData = {
          links: data.links || [],
          searchSuggestions: data.searchSuggestions || [],
          educationalNote: data.educationalNote || "",
        };
        setResearchData(result);
        researchRef.current = result;
        toast.show("Research suggestions loaded");
      }
    } catch (err) {
      console.error("Research fetch error:", err);
      toast.show("Research fetch failed");
    } finally {
      setResearchLoading(false);
    }
  }

  /* ---------------- NEW: Fetch All Extras (Sentiment, Conclusion, Research) ---------------- */
  async function fetchAllExtras() {
    setExtrasProgress({ percent: 0, label: "Starting analysis..." });
    
    try {
      // Step 1: Sentiment Analysis (0-40%)
      setExtrasProgress({ percent: 10, label: "Analyzing sentiment..." });
      await fetchSentiment();
      setExtrasProgress({ percent: 40, label: "Sentiment complete" });
      
      // Step 2: Executive Conclusion (40-70%)
      setExtrasProgress({ percent: 50, label: "Generating conclusion..." });
      await fetchConclusion();
      setExtrasProgress({ percent: 70, label: "Conclusion complete" });
      
      // Step 3: Related Research (70-100%)
      setExtrasProgress({ percent: 80, label: "Finding research..." });
      await fetchResearch();
      setExtrasProgress({ percent: 100, label: "All extras ready!" });
      
      // Clear progress after short delay
      setTimeout(() => {
        setExtrasProgress(null);
      }, 1500);
      
    } catch (err) {
      console.error("Extras fetch error:", err);
      setExtrasProgress({ percent: 100, label: "Completed with errors" });
      setTimeout(() => setExtrasProgress(null), 2000);
    }
  }

  const normalizedCompare = useMemo(() => {
    if (!compareResp?.results?.length) return [];
    return normalizeCompareResponse(compareResp);
  }, [compareResp]);

  const chosenProvider = useMemo(() => pinnedProvider ?? winnerProvider ?? null, [pinnedProvider, winnerProvider]);

  const enabledProvidersCount = useMemo(() => {
    return PROVIDERS.reduce((acc, p) => acc + ((compareEnabled[p.id] ?? false) ? 1 : 0), 0);
  }, [compareEnabled]);

  const [galleryTick, setGalleryTick] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);

  useEffect(() => {
    try {
      setReportsCount(listReports().length);
    } catch {
      setReportsCount(0);
    }
  }, [galleryTick]);

  useEffect(() => {
    try {
      const f = lsGet<{
        title?: string;
        context?: string;
        intent?: string;
        options?: string;
        assumptions?: string;
        risks?: string;
        evidence?: string;
        confidence?: DecisionInput["confidence"];
        outcome?: string;
      }>(LS_FORM);

      if (f) {
        if (typeof f.title === "string") setTitle(f.title);
        if (typeof f.context === "string") setContext(f.context);
        if (typeof f.intent === "string") setIntent(f.intent);
        if (typeof f.options === "string") setOptions(f.options);
        if (typeof f.assumptions === "string") setAssumptions(f.assumptions);
        if (typeof f.risks === "string") setRisks(f.risks);
        if (typeof f.evidence === "string") setEvidence(f.evidence);
        if (f.confidence === "low" || f.confidence === "medium" || f.confidence === "high") setConfidence(f.confidence);
        if (typeof f.outcome === "string") setOutcome(f.outcome);
      }

      const cfg = lsGet<{
        compareEnabled?: Partial<Record<ProviderId, boolean>>;
        compareModels?: Partial<Record<ProviderId, string>>;
        comparePrompt?: string;
        compareAttachToReport?: boolean;
      }>(LS_COMPARE_CFG);

      if (cfg) {
        if (cfg.compareEnabled && typeof cfg.compareEnabled === "object") setCompareEnabled(cfg.compareEnabled);
        if (cfg.compareModels && typeof cfg.compareModels === "object") setCompareModels(cfg.compareModels);
        if (typeof cfg.comparePrompt === "string") setComparePrompt(cfg.comparePrompt);
        if (typeof cfg.compareAttachToReport === "boolean") setCompareAttachToReport(cfg.compareAttachToReport);
      }

      const raw = localStorage.getItem(LS_COMPARE);
      const iso = localStorage.getItem(LS_COMPARE_ISO) || "";
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed) && Array.isArray((parsed as { results?: unknown }).results)) {
          const resp = parsed as CompareResponse;
          setCompareResp(resp);
          if (iso) setCompareLastISO(iso);

          const normalized = normalizeCompareResponse(resp);
          setWinnerProvider(pickBestProvider(normalized));
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      lsSet(LS_FORM, { title, context, intent, options, assumptions, risks, evidence, confidence, outcome });
      lsSet(LS_COMPARE_CFG, { compareEnabled, compareModels, comparePrompt, compareAttachToReport });
      persistTimerRef.current = null;
    }, 260);

    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, [
    title,
    context,
    intent,
    options,
    assumptions,
    risks,
    evidence,
    confidence,
    outcome,
    compareEnabled,
    compareModels,
    comparePrompt,
    compareAttachToReport,
  ]);

  function toggleProvider(p: ProviderId) {
    setCompareEnabled((prev) => ({ ...prev, [p]: !(prev[p] ?? false) }));
  }

  function setProviderModel(p: ProviderId, model: string) {
    setCompareModels((prev) => ({ ...prev, [p]: model }));
  }

  function buildComparePayload() {
    const enabled: Partial<Record<ProviderId, boolean>> = {};
    const models: Partial<Record<ProviderId, string>> = {};

    for (const { id } of PROVIDERS) {
      const en = compareEnabled[id] ?? false;
      if (en) enabled[id] = true;
      const m = compareModels[id];
      if (typeof m === "string" && m.trim()) models[id] = m.trim();
    }

    // ✅ Optimized system prompt for ALL providers
    // Key: anti-repetitive, specific content, proper structure
    const system = [
      "You are a decision-grade analyst specializing in structured decision synthesis.",
      "",
      "CRITICAL RULES (follow exactly):",
      "• Each bullet MUST contain SPECIFIC information from the decision context.",
      "• NEVER use placeholder text like 'Define a quick test', 'To be determined', or generic templates.",
      "• NEVER repeat the same bullet point multiple times.",
      "• If you lack specific details, derive reasonable specifics from the context provided.",
      "• Be concrete and concise. Avoid fluff and generic advice.",
      "",
      "Output structure (use these exact headers):",
      "• BEST OPTION - Your recommended choice with brief reasoning",
      "• RATIONALE - 3-5 specific reasons supporting the recommendation", 
      "• TOP RISKS - 3-5 specific risks with concrete mitigation strategies",
      "• ASSUMPTIONS TO VALIDATE - 3-5 assumptions with specific validation methods",
      "• HALF-LIFE - When does this decision need review? Include specific triggers",
      "• BLIND SPOTS - What are we not seeing? Be specific to this decision",
      "• NEXT ACTIONS - 5-8 concrete actions with Owner and Timebox",
    ].join("\n");

    const prompt =
      `TITLE:\n${title}\n\n` +
      `CONTEXT:\n${context}\n\n` +
      `INTENT:\n${intent}\n\n` +
      `OPTIONS:\n${input.options.map((o) => `- ${o}`).join("\n")}\n\n` +
      `ASSUMPTIONS:\n${input.assumptions.map((a) => `- ${a}`).join("\n")}\n\n` +
      `RISKS:\n${input.risks.map((r) => `- ${r}`).join("\n")}\n\n` +
      `EVIDENCE:\n${input.evidence.map((e) => `- ${e}`).join("\n")}\n\n` +
      `TASK:\n${comparePrompt.trim() || "Critique and recommend."}\n`;

    return { system, prompt, temperature: 0.2, maxTokens: 700, enabled, models };
  }

  function prettyProviderError(err: string) {
    const s = (err || "").toLowerCase();
    if (!s.trim()) return { title: "Provider unavailable", tip: "Try again or choose a different provider." };

    if (s.includes("api key") || s.includes("unauthorized") || s.includes("401")) {
      return { title: "Missing or invalid API key", tip: "Check your environment key for this provider." };
    }
    if (s.includes("rate") || s.includes("429") || s.includes("quota")) {
      return { title: "Rate limited or quota exceeded", tip: "Wait a moment, then try again or switch providers." };
    }
    if (s.includes("timeout") || s.includes("timed out") || s.includes("504")) {
      return { title: "Request timed out", tip: "Try again or use a smaller, faster model." };
    }
    if (s.includes("invalid json") || s.includes("payload") || s.includes("unknown name")) {
      return { title: "Payload mismatch", tip: "The provider API rejected the request. Verify your adapter fields." };
    }
    if (s.includes("model") && (s.includes("not found") || s.includes("does not exist") || s.includes("unavailable"))) {
      return { title: "Model not available", tip: "Choose another model. The dropdown value must be the exact model ID." };
    }
    return { title: "Request failed", tip: "See details below for the provider error message." };
  }

  async function runCompare() {
    if (enabledProvidersCount <= 0) {
      toast.show("Enable at least 1 provider to run compare.");
      return;
    }

    setCompareLoading(true);
    try {
      const payload = buildComparePayload();
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.show(data?.message ?? data?.error ?? "Compare failed.");
        return;
      }

      if (!isRecord(data) || !Array.isArray((data as { results?: unknown }).results)) {
        toast.show("Compare response shape invalid.");
        return;
      }

      const resp = data as CompareResponse;
      const nowISO = new Date().toISOString();

      setCompareResp(resp);
      setCompareLastISO(nowISO);

      try {
        localStorage.setItem(LS_COMPARE, JSON.stringify(resp));
        localStorage.setItem(LS_COMPARE_ISO, nowISO);
      } catch {
        // ignore
      }

      const normalized = normalizeCompareResponse(resp);
      const best = pickBestProvider(normalized);
      setWinnerProvider(best);

      if (pinnedProvider) {
        const stillExists = normalized.some((x) => x.provider === pinnedProvider);
        if (!stillExists) setPinnedProvider(null);
      }

      const evt: LedgerEvent = {
        id: uid(),
        type: "COMPARE_RUN",
        createdAtISO: nowISO,
        title,
        prompt: payload.prompt,
        system: payload.system,
        enabled: payload.enabled,
        models: payload.models,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        results: resp.results,
        winnerProvider: best,
        pinnedProvider: pinnedProvider ?? null,
      } as LedgerEvent;

      appendEvent(evt);

      toast.show(best ? "Compare finished ✓" : "Compare finished (no winner) ✓");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Compare failed.";
      toast.show(msg);
    } finally {
      setCompareLoading(false);
    }
  }

  function appendEvidenceLine(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setEvidence((prev) => {
      const sep = prev.trim().length ? "\n" : "";
      return prev + sep + clean;
    });
    pulseGlow("evidence");
    toast.show("Evidence added ✓");
  }

  function useCompareResult(provider: ProviderId, text: string) {
    const clean = (text ?? "").trim();
    if (!clean) {
      toast.show("Empty result. Nothing to use.");
      return;
    }

    setOutcome(clean);
    pulseGlow("outcome");

    const firstLine = clean.split("\n").find((l) => l.trim())?.trim() ?? clean.slice(0, 140);
    appendEvidenceLine(`[Compare:${provider}] ${firstLine.slice(0, 160)}`);

    toast.show(`Used ${provider} ✓`);
  }

  function useBestCompareOption() {
    if (!normalizedCompare.length) {
      toast.show("Run compare first.");
      return;
    }

    const chosen = chosenProvider ?? pickBestProvider(normalizedCompare);
    if (!chosen) {
      toast.show("No usable compare output yet (all providers failed).");
      return;
    }

    const item = normalizedCompare.find((x) => x.provider === chosen);
    if (!item || !item.ok || !item.text.trim()) {
      toast.show("Chosen provider has no usable output.");
      return;
    }

    useCompareResult(chosen, item.text);
  }

  /* ---------------- Confidence (human labels) ---------------- */

  const CONF_LABEL: Record<DecisionInput["confidence"], { label: string; hint: string }> = {
    low: { label: "Draft", hint: "Lots of unknowns. Add evidence before taking action." },
    medium: { label: "Solid", hint: "Directionally sound. Validate one or two key assumptions." },
    high: { label: "Committed", hint: "Constraints are clear. Focus on risks and execution details." },
  };

  function confidenceActiveClasses(c: DecisionInput["confidence"]) {
    const base = ["rounded-2xl border px-3 py-2 text-[13px] select-none", "transition-all duration-150", btnFx("")].join(
      " "
    );

    const inactive =
      "border-slate-200 bg-white/65 text-slate-900 hover:bg-white/75 dark:border-white/[0.06] dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10";

    if (confidence !== c) return `${base} ${inactive}`;

    if (c === "low")
      return `${base} border-rose-300/35 bg-rose-500/10 text-rose-700 dark:text-rose-50 dark:bg-rose-500/15`;
    if (c === "medium")
      return `${base} border-amber-300/35 bg-amber-400/10 text-amber-800 dark:text-amber-50 dark:bg-amber-400/15`;
    return `${base} border-emerald-300/35 bg-emerald-400/10 text-emerald-800 dark:text-emerald-50 dark:bg-emerald-400/15`;
  }

  /* ---------------- “Fix next” actions (premium CTA) ---------------- */

  function addHardEdge() {
    const stamp = `Hard edge: Ship by ${new Date(Date.now() + 7 * 24 * 3600 * 1000).toLocaleDateString()} · Success = 0 unverifiable citations + 30% faster drafts`;
    setContext((prev) => (prev.trim() ? `${prev.trim()}\n\n${stamp}` : stamp));
    pulseGlow("context");
    toast.show("Added a hard edge ✓");
  }

  function addEvidenceSeed() {
    const line = "Evidence: create a verification pack template (citation → source → holding summary → screenshot/export).";
    appendEvidenceLine(line);
  }

  function addAssumptionSeed() {
    const line = "Associates will actually do verification under time pressure (not just copy-paste AI text).";
    setAssumptions((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
    pulseGlow("assumptions");
    toast.show("Assumption added ✓");
  }

  function addOptionSeed() {
    const line = "Option E: Allow AI only for outlines; partner writes final argument + all citations manually.";
    setOptions((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
    pulseGlow("options");
    toast.show("Option added ✓");
  }

  function deGenericizeIntent() {
    const rewrite =
      "Decide an AI drafting policy that guarantees: (1) zero unverifiable citations, (2) an auditable verification pack, (3) client confidentiality controls, and (4) roughly 30-40% faster first drafts.";
    setIntent(rewrite);
    pulseGlow("intent");
    toast.show("Intent tightened ✓");
  }

  function fixActionFor(key: string) {
    if (key === "hard_edges") return addHardEdge;
    if (key === "evidence") return addEvidenceSeed;
    if (key === "assumptions") return addAssumptionSeed;
    if (key === "options") return addOptionSeed;
    if (key === "generic") return deGenericizeIntent;
    if (key === "trail") return addEvidenceSeed;
    return () => {};
  }

  /* ---------------- Premium “completion / readiness bar” ---------------- */

  const readinessScore = Math.max(0, Math.min(100, analysis.readiness.score ?? 0));
  const missingTo100 = Math.max(
    0,
    Math.min(
      100,
      // @ts-ignore
      analysis.readiness.breakdown?.missingTo100 ?? Math.max(0, 100 - readinessScore)
    )
  );

  const completionTone: Tone =
    readinessScore >= 85 ? "good" : readinessScore >= 70 ? "info" : readinessScore >= 55 ? "warn" : "bad";

  const completionLabel =
    readinessScore >= 85 ? "Ready" : readinessScore >= 70 ? "Almost" : readinessScore >= 55 ? "Needs work" : "Draft";

  const readinessTip = useMemo(() => {
    // @ts-ignore
    const b = analysis.readiness.breakdown;

    // @ts-ignore
    if (b?.tooltip?.lines?.length) {
      return {
        // @ts-ignore
        title: b.tooltip.title || `${completionLabel} · ${readinessScore}/100`,
        // @ts-ignore
        lines: b.tooltip.lines,
      };
    }

    if (readinessScore >= 100) {
      return {
        title: `Ready · ${readinessScore}/100`,
        lines: ["All checks passed.", "You’re clear to review + export."],
      };
    }

    const lines: string[] = [];

    // @ts-ignore
    if (b?.missingReasons?.length) lines.push(...b.missingReasons);

    // @ts-ignore
    if ((!lines.length || lines.length < 2) && b?.parts?.length) {
      // @ts-ignore
      const missingParts = b.parts
        .filter((p: any) => !p.ok && (p.suggestion || p.reason))
        .slice(0, 6)
        .map((p: any) => {
          const max = typeof p.maxPoints === "number" ? p.maxPoints : 0;
          const pts = typeof p.points === "number" ? p.points : 0;
          const gap = Math.max(0, max - pts);
          const hint = p.suggestion || p.reason || "Add more detail.";
          return `+${gap} ${p.label}: ${hint}`;
        });
      lines.push(...missingParts);
    }

    // ✅ If score is high (90+) but not 100, show specific missing fields
    if (!lines.length || (readinessScore >= 90 && lines.length < 2)) {
      const missingFields: string[] = [];
      if (!title.trim()) missingFields.push("+2 Title: Add decision question");
      if (!context.trim()) missingFields.push("+3 Context: Add background info");
      if (!intent.trim()) missingFields.push("+2 Intent: Define success criteria");
      if (!options.trim()) missingFields.push("+3 Options: List available choices");
      if (!assumptions.trim()) missingFields.push("+2 Assumptions: State key assumptions");
      if (!risks.trim()) missingFields.push("+2 Risks: Identify potential risks");
      if (!evidence.trim()) missingFields.push("+2 Evidence: Add supporting data");
      if (!outcome.trim()) missingFields.push("+1 Outcome: Add expected outcome");
      
      if (missingFields.length) {
        lines.length = 0; // Clear generic messages
        lines.push(...missingFields.slice(0, 4));
      }
    }

    if (!lines.length) {
      lines.push("Add one or two specifics to reach 100.");
    }

    return {
      title: `${completionLabel} - ${readinessScore}/100`,
      lines: lines.slice(0, 10),
    };
  }, [analysis.readiness, completionLabel, readinessScore, title, context, intent, options, assumptions, risks, evidence, outcome]);

  /* ---------------- report generation (single source of truth: toReportHTML) ---------------- */

  function processDecisionWith(forInput: DecisionInput): string {
    const forAnalysis = analyzeDecision(forInput);

    const tooltips: ReportTooltip[] = [
      { id: "readiness", title: readinessTip.title, lines: readinessTip.lines },
      { id: "grade", title: gradeTip.title, lines: gradeTip.lines },
      { id: "completeness", title: completenessTip.title, lines: completenessTip.lines },
      { id: "actionability", title: actionabilityTip.title, lines: actionabilityTip.lines },
      { id: "badges", title: "Badges", lines: badges.map((b) => `${b.label}: ${b.hint}`) },
    ];

    const providerCompare: ProviderCompareRow[] | undefined =
      compareAttachToReport && compareResp?.results?.length
        ? compareResp.results.map((r) => ({
            provider: r.provider,
            model: r.model,
            latencyMs: r.latencyMs,
            ok: r.ok,
            text: r.text,
            error: typeof r.error === "string" ? r.error : r.error?.message,
            message: typeof r.message === "string" ? r.message : undefined,
            status: r.ok ? "ok" : "error",
          }))
        : undefined;

    const latestCritic = geminiCriticRef.current ?? geminiCritic;

    // Get current theme info for report
    const currentTheme = DECISION_THEMES[selectedTheme];
    const themeInfo: ThemeInfo | null = currentTheme ? {
      id: currentTheme.id,
      label: currentTheme.label,
      emoji: currentTheme.emoji,
    } : null;

    // Get timezone for display
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    // Get latest sentiment, conclusion, research from refs
    const latestSentiment = sentimentRef.current ?? sentimentData;
    const latestConclusion = conclusionRef.current ?? conclusionData;
    const latestResearch = researchRef.current ?? researchData;
    const latestStressTest = stressTestRef.current ?? stressTestData;

    const extras: ReportExtras = {
      tooltips,
      providerCompare,
      geminiCritic: latestCritic,
      theme: themeInfo,
      timezone: userTimezone,
      sentiment: latestSentiment,
      conclusion: latestConclusion,
      relatedResearch: latestResearch,
      radarChart: radarData,
      stressTest: latestStressTest,
    };

    const html = toReportHTML(forInput, forAnalysis, extras);

    lastHTMLRef.current = html;
    setLastHTML(html);

    const reportId = uid();
    setLastReportId(reportId);

    const report: StoredReport = {
      id: reportId,
      title: forInput.title,
      createdAtISO: forInput.createdAtISO,
      generatedAtISO: forAnalysis.meta.generatedAtISO,
      readinessScore: forAnalysis.readiness.score,
      grade: forAnalysis.readiness.grade,
      halfLife: forAnalysis.halfLife.status,
      blindSpotScore: forAnalysis.blindSpots.score,
      html,
    };

    saveReport(report);

    cleanupUrl(htmlUrlRef);
    htmlUrlRef.current = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    cleanupUrl(pdfUrlRef);

    toast.show("Report generated ✓");
    return html;
  }

  function getLatestHTMLStringForPreview(): string {
    return (lastHTMLRef.current || lastHTML || "").trim();
  }

  function ensureHTMLUrlFromLast(): string | null {
    const html = getLatestHTMLStringForPreview();
    if (!html || html.length <= 50) return null;

    if (htmlUrlRef.current) return htmlUrlRef.current;

    htmlUrlRef.current = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    return htmlUrlRef.current;
  }

  async function ensurePDFUrlFromLast(): Promise<string | null> {
    const html = getLatestHTMLStringForPreview();
    if (!html || html.length <= 50) return null;

    if (pdfUrlRef.current) return pdfUrlRef.current;

    setIsWorking(true);
    try {
      const bytes = await fetchPDFBytes(html, "grounds-report");
      if (!bytes) return null;
      pdfUrlRef.current = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      return pdfUrlRef.current;
    } finally {
      setIsWorking(false);
    }
  }

  // ✅ Open inline preview modal (no popup, consistent UX)
  function previewHTMLNewTab() {
    const url = ensureHTMLUrlFromLast();
    if (!url) {
      toast.show("Press Process first to generate the report.");
      return;
    }
    setPreviewModal({ open: true, kind: "html", url, filename: "grounds-report.html" });
  }

  async function previewPDFNewTab() {
    const url = await ensurePDFUrlFromLast();
    if (!url) {
      toast.show("Press Process first to generate the report.");
      return;
    }
    setPreviewModal({ open: true, kind: "pdf", url, filename: "grounds-report.pdf" });
  }

  function closePreviewModal() {
    setPreviewModal(null);
  }

  function downloadFromModal() {
    if (!previewModal) return;
    const a = document.createElement("a");
    a.href = previewModal.url;
    a.download = previewModal.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.show("Download started ✓");
  }

  function exportLedger() {
    const ledger = loadLedger();
    downloadText("grounds-ledger.json", JSON.stringify(ledger, null, 2), "application/json;charset=utf-8");
  }

  // ✅ NEW CASE: Start from completely blank state (all fields empty)
  function newCase() {
    setTitle("");
    setContext("");
    setIntent("");
    setOptions("");
    setAssumptions("");
    setRisks("");
    setEvidence("");
    setConfidence("low"); // Draft = low confidence
    setOutcome("");
    // ✅ Clear compare prompt too
    setComparePrompt("");
    // Clear all results
    setCompareResp(null);
    setWinnerProvider(null);
    setPinnedProvider("google"); // Reset to Google featured
    setCompareLastISO("");
    // Clear Gemini Critic
    setGeminiCritic(null);
    geminiCriticRef.current = null;
    // Clear Stress Test
    setStressTestData(null);
    stressTestRef.current = null;
    // Clear localStorage for compare
    try {
      localStorage.removeItem(LS_COMPARE);
      localStorage.removeItem(LS_COMPARE_ISO);
    } catch {}
    // Trigger input area fade-in animation
    setInputAreaKey((k) => k + 1);
    toast.show("New case created ✓ All fields cleared.");
  }

  // ✅ USE TEMPLATE: Load default example case study
  function startFromTemplate() {
    // ✅ Use selected theme's case study
    const theme = DECISION_THEMES[selectedTheme] || DECISION_THEMES.general;
    const cs = theme.caseStudy;
    
    setTitle(cs.title);
    setContext(cs.context);
    setIntent(cs.intent);
    setOptions(cs.options);
    setAssumptions(cs.assumptions);
    setRisks(cs.risks);
    setEvidence(cs.evidence);
    setConfidence(cs.confidence);
    setOutcome(cs.outcome);
    setComparePrompt(cs.comparePrompt);
    // Clear all results
    setCompareResp(null);
    setWinnerProvider(null);
    setPinnedProvider("google"); // Reset to Google featured
    setCompareLastISO("");
    // Clear Gemini Critic
    setGeminiCritic(null);
    geminiCriticRef.current = null;
    // Clear Stress Test
    setStressTestData(null);
    stressTestRef.current = null;
    // Clear localStorage for compare
    try {
      localStorage.removeItem(LS_COMPARE);
      localStorage.removeItem(LS_COMPARE_ISO);
    } catch {}
    // Trigger input area fade-in animation
    setInputAreaKey((k) => k + 1);
    toast.show(`${theme.emoji} ${theme.label} template loaded ✓`);
  }

  // ✅ NEW: Load theme case study when theme changes
  function handleThemeChange(themeId: string) {
    setSelectedTheme(themeId);
    setActiveStep("theme");
    const theme = DECISION_THEMES[themeId];
    if (theme) {
      toast.show(`Theme changed to ${theme.emoji} ${theme.label}. Click "Use Template" to load example.`);
    }
  }

  // ✅ NEW: Stepper step click handler - smooth scroll to section
  function handleStepClick(stepId: StepId) {
    setActiveStep(stepId);
    
    // Mark current step as completed when navigating away
    if (!completedSteps.includes(stepId)) {
      // Don't auto-complete, let the useEffect handle it based on actual progress
    }
    
    // Map step IDs to section element IDs
    const sectionMap: Record<StepId, string> = {
      theme: "section-theme",
      input: "section-input",
      critic: "section-critic",
      compare: "section-compare",
      sentiment: "section-sentiment",
      stress: "section-stress",
      export: "section-export",
    };
    
    const targetId = sectionMap[stepId];
    const element = document.getElementById(targetId);
    
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  
  // ✅ Auto-track workflow progress based on actual user actions
  useEffect(() => {
    const newCompleted: StepId[] = [];
    
    // Step 1: Theme - always considered complete (default selected)
    newCompleted.push("theme");
    
    // Step 2: Input - complete if title OR context has content
    if (title.trim().length > 0 || context.trim().length > 0) {
      newCompleted.push("input");
    }
    
    // Step 3: Gemini Critic - complete if we have critic results
    if (geminiCritic) {
      newCompleted.push("critic");
    }
    
    // Step 4: Provider Compare - complete if we have compare results
    if (compareResp) {
      newCompleted.push("compare");
    }
    
    // Step 5: Sentiment - complete if we have sentiment OR conclusion OR research results
    if (sentimentData || conclusionData || researchData) {
      newCompleted.push("sentiment");
    }
    
    // Step 6: Stress Test - complete if we have stress test results
    if (stressTestData) {
      newCompleted.push("stress");
    }
    
    // Step 7: Export - complete when user clicks Process button (isProcessed = true)
    if (isProcessed) {
      newCompleted.push("export");
    }
    
    setCompletedSteps(newCompleted);
  }, [title, context, geminiCritic, compareResp, sentimentData, conclusionData, researchData, stressTestData, isProcessed]);

  // ✅ NEW: Document scan handler (Image → auto-fill via Groq Vision)
  async function handleDocumentScan(file: File) {
    if (!file) return;
    
    setIsScanning(true);
    setScanError(null);
    setScanProgress({ percent: 0, label: "Starting..." });
    
    try {
      // Step 1: Validate
      setScanProgress({ percent: 10, label: "Validating file..." });
      await new Promise(r => setTimeout(r, 200));
      
      if (file.size > 4 * 1024 * 1024) {
        throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 4MB.`);
      }
      
      // Step 2: Prepare upload
      setScanProgress({ percent: 25, label: "Preparing upload..." });
      await new Promise(r => setTimeout(r, 200));
      
      const formData = new FormData();
      formData.append("file", file);
      formData.append("theme", selectedTheme);
      
      // Step 3: Upload & analyze
      setScanProgress({ percent: 40, label: "Uploading image..." });
      
      const res = await fetch("/api/scan-document", {
        method: "POST",
        body: formData,
      });
      
      setScanProgress({ percent: 70, label: "AI analyzing..." });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Extraction failed. Please try a clearer image.");
      }
      
      // Step 4: Process results
      setScanProgress({ percent: 85, label: "Processing results..." });
      const data = await res.json();
      
      // Count how many fields were extracted
      let filledCount = 0;
      
      // Helper to safely get string value
      const getString = (val: unknown): string => {
        if (typeof val === "string") return val.trim();
        if (Array.isArray(val)) return val.join("\n").trim();
        if (val && typeof val === "object") return JSON.stringify(val);
        return "";
      };
      
      // Auto-fill form fields from scan result
      const titleVal = getString(data.title);
      const contextVal = getString(data.context);
      const intentVal = getString(data.intent);
      const optionsVal = getString(data.options);
      const assumptionsVal = getString(data.assumptions);
      const risksVal = getString(data.risks);
      const evidenceVal = getString(data.evidence);
      
      if (titleVal) { setTitle(titleVal); filledCount++; }
      if (contextVal) { setContext(contextVal); filledCount++; }
      if (intentVal) { setIntent(intentVal); filledCount++; }
      if (optionsVal) { setOptions(optionsVal); filledCount++; }
      if (assumptionsVal) { setAssumptions(assumptionsVal); filledCount++; }
      if (risksVal) { setRisks(risksVal); filledCount++; }
      if (evidenceVal) { setEvidence(evidenceVal); filledCount++; }
      
      // ✅ Auto-detect and set theme from scan result
      if (data.detectedTheme && data.detectedTheme !== selectedTheme) {
        setSelectedTheme(data.detectedTheme);
        const themeInfo = DECISION_THEMES[data.detectedTheme];
        if (themeInfo) {
          toast.show(`🎯 Auto-detected theme: ${themeInfo.emoji} ${themeInfo.label}`);
        }
      }
      
      // ✅ Auto-generate compare task based on extracted content
      if (filledCount > 0) {
        const taskTitle = titleVal || "this decision";
        const generatedTask = `Analyze "${taskTitle}" and provide:
1. Best option with clear recommendation
2. Supporting rationale with evidence
3. Top 3 risks and mitigation strategies
4. Key assumptions that need validation
5. Decision half-life and review triggers

Focus on actionable insights. Be specific, not generic.`;
        setComparePrompt(generatedTask);
      }
      
      // Step 5: Done!
      setScanProgress({ percent: 100, label: "Done!" });
      
      if (filledCount === 0) {
        toast.show("⚠️ No content extracted. Try a clearer image with more text.");
      } else {
        toast.show(`✨ Extracted ${filledCount} fields + generated task. Review and refine before grading.`);
      }
      
      setInputAreaKey((k) => k + 1);
      
      // Clear progress after short delay
      setTimeout(() => setScanProgress(null), 1500);
      
    } catch (err: any) {
      const errorMsg = err.message || "Failed to process image";
      setScanError(errorMsg);
      setScanProgress(null);
      toast.show(`❌ ${errorMsg}`);
    } finally {
      setIsScanning(false);
    }
  }

  // ✅ Clear compare results only (keep input data intact)
  function clearCompareResults() {
    setCompareResp(null);
    setWinnerProvider(null);
    setCompareLastISO("");
    // Clear localStorage for compare only
    try {
      localStorage.removeItem(LS_COMPARE);
      localStorage.removeItem(LS_COMPARE_ISO);
    } catch {}
    toast.show("Compare results cleared ✓");
  }

  async function copyShareText() {
    const text =
      `Grounds: decision-grade reports.\n\n` +
      `Readiness: ${analysis.readiness.score}/100 (Grade ${analysis.readiness.grade})\n` +
      `Half-life: ${analysis.halfLife.status}\n` +
      `Blind-Spot Index: ${analysis.blindSpots.score}/100\n`;

    try {
      await navigator.clipboard.writeText(text);
      toast.show("Copied ✓");
    } catch {
      toast.show("Copy failed (clipboard blocked).");
    }
  }

  function goToGallery() {
    router.push("/gallery");
  }

  const gradeTone: Tone =
    analysis.readiness.grade === "A"
      ? "good"
      : analysis.readiness.grade === "B"
      ? "info"
      : analysis.readiness.grade === "C"
      ? "warn"
      : "bad";

  const canPreview = getLatestHTMLStringForPreview().length > 50;

  /* ---------------- Cleanup on unmount ---------------- */

  useEffect(() => {
    return () => {
      try {
        for (const k of Object.keys(typingTimersRef.current)) {
          const t = typingTimersRef.current[k];
          if (t) window.clearTimeout(t);
        }
        if (toast._timerRef.current) window.clearTimeout(toast._timerRef.current);
        if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
        if (outcomeDebounceRef.current) window.clearTimeout(outcomeDebounceRef.current);

        cleanupUrl(htmlUrlRef);
        cleanupUrl(pdfUrlRef);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // ✅ DARK MODE ONLY - Force dark theme for hackathon demo (no light mode on main page)
    <div className="dark">
      <div className="text-white min-h-screen bg-[#0b0c14]">
        {/* Stepper Sidebar */}
        <StepperSidebar 
          activeStep={activeStep} 
          onStepClick={handleStepClick}
          isVisible={stepperVisible}
          isMinimized={stepperMinimized}
          onClose={() => setStepperVisible(false)}
          onToggleMinimize={() => setStepperMinimized(!stepperMinimized)}
          completedSteps={completedSteps}
        />
        
        {/* toast */}
        {toast.msg ? (
          <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-2xl border border-white/[0.06] bg-[#0b0c14]/90 px-4 py-2 text-[12px] text-white/90 backdrop-blur-md shadow-lg">
            {toast.msg}
          </div>
        ) : null}

      {/* HERO - pulled up behind header with negative margin */}
      <FadeIn>
        <div id="section-theme" className="px-4 md:px-6 -mt-[72px] pt-[72px] scroll-mt-20">
          <Card className="relative isolate overflow-hidden rounded-3xl border border-white/[0.06] bg-[#0b0c14] [&>*]:rounded-[inherit]">
          {/* Animated 3-color gradient background inside - subtle premium look */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] bg-inherit">
            {/* Animated gradient orbs - reduced opacity for better CTA focus */}
            <div 
              className="absolute -top-1/2 -left-1/4 w-[80%] h-[80%] rounded-full opacity-20 dark:opacity-15 animate-pulse [animation-duration:4s]"
              style={{ background: "radial-gradient(circle, rgba(34,211,238,0.35) 0%, transparent 70%)" }}
            />
            <div 
              className="absolute -bottom-1/4 -right-1/4 w-[70%] h-[70%] rounded-full opacity-18 dark:opacity-12 animate-pulse [animation-duration:5s] [animation-delay:1s]"
              style={{ background: "radial-gradient(circle, rgba(167,139,250,0.35) 0%, transparent 70%)" }}
            />
            <div 
              className="absolute top-1/4 right-1/4 w-[50%] h-[50%] rounded-full opacity-15 dark:opacity-10 animate-pulse [animation-duration:6s] [animation-delay:2s]"
              style={{ background: "radial-gradient(circle, rgba(251,113,133,0.3) 0%, transparent 70%)" }}
            />
            {/* Shimmer sweep - more subtle */}
            <motion.div 
              className="absolute inset-0"
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{
                duration: 3.5,
                ease: "linear",
                repeat: Infinity,
                repeatDelay: 2
              }}
              style={{ 
                background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)",
              }}
            />
          </div>
          <CardContent className="relative p-5 md:p-6">
            <div className="grid gap-5 md:grid-cols-[1fr_1.3fr] items-start">
              <div className="pt-12"> {/* Space for GroundsDrawer animation */}
                {/* Title with Grounds drawer that opens to show source code */}
                <div 
                  className="relative text-[34px] md:text-[44px] font-semibold tracking-tight leading-[1.05]"
                >
                  <span className="bg-gradient-to-r from-cyan-700 via-violet-700 to-rose-700 dark:from-cyan-300 dark:via-violet-300 dark:to-rose-300 bg-clip-text text-transparent animate-hue [animation-duration:3s]">
                    Make decisions on solid{" "}
                  </span>
                  <GroundsDrawer />.
                  <span className="pointer-events-none absolute left-0 right-0 -bottom-2 h-[10px] rounded-full bg-gradient-to-r from-cyan-400/0 via-violet-400/35 to-rose-400/0 blur-lg" />
                </div>

                <div className="mt-3 text-[14px] text-black/80 dark:text-white/60 max-w-xl">
                  Turn messy inputs into a{" "}
                  <span className="text-black dark:text-white/75">decision-grade brief in under a minute.</span>
                </div>

                {/* Hackathon narrative */}
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] text-slate-900 dark:border-white/[0.06] dark:bg-white/5 dark:text-white/85">
                    ✨ <span className="font-semibold">Gemini 3 Critic</span>
                    <span className="text-black/70 dark:text-white/55">+ hard-edge critique</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] text-slate-900 dark:border-white/[0.06] dark:bg-white/5 dark:text-white/85">
                    ✨ <span className="font-semibold">Gemini 3 Compare</span>
                    <span className="text-black/70 dark:text-white/55">+ structured winner</span>
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {badges.map((b: any) => (
                    <Chip 
                      key={b.label} 
                      label={b.score ? `${b.label} ${b.score}` : b.label}
                      tone={b.tone as any} 
                      hint={b.hint}
                    />
                  ))}
                </div>
              </div>

              {/* RIGHT PANEL */}
              <div className="md:pl-2">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/25 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-semibold text-black dark:text-white/90">Quick actions</div>
                      <div className="text-[12px] text-black/80 dark:text-white/60 mt-1">
                        Utilities. Main workflow is in the sticky bar.
                      </div>
                    </div>
                    <Chip label="Local-first" tone="info" />
                  </div>

                  {/* Theme Selector + Scan Image */}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-black/80 dark:text-white/80">🎨 Theme:</span>
                      <select
                        value={selectedTheme}
                        onChange={(e) => handleThemeChange(e.target.value)}
                        className="text-[12px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5 dark:text-white/90 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 cursor-pointer"
                      >
                        {THEME_OPTIONS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Tip for Theme workflow - softer colors */}
                    <div className="text-[10px] italic flex items-center gap-1 flex-wrap text-black/40 dark:text-white/35">
                      <span className="font-medium">💡 Tip:</span>
                      <span className="font-medium">Select</span>
                      <span className="font-semibold text-violet-500/70 dark:text-violet-400/60">Theme</span>
                      <span className="font-medium">→</span>
                      <span className="font-semibold text-emerald-500/70 dark:text-emerald-400/60">Use Template</span> 
                      <span className="font-medium">for example, or</span>
                      <span className="font-semibold text-sky-500/70 dark:text-sky-400/60">New Case</span> 
                      <span className="font-medium">for blank</span>
                    </div>
                  </div>
                    
                  {/* Hidden file input - images only for Groq Vision */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleDocumentScan(file);
                      e.target.value = ""; // Reset for re-upload
                    }}
                  />
                    
                  {/* Scan error display */}
                  {scanError && !scanProgress && (
                    <div className="mt-2 text-[11px] text-red-500 dark:text-red-400 flex items-center gap-1">
                      <TriangleAlert className="h-3 w-3" />
                      {scanError}
                    </div>
                  )}

                  {/* ✅ Quick Action Buttons - Row 1: Guide, Scan, New Case, Use Template */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {/* GUIDE BUTTON - Opens workflow stepper */}
                    <HoverTip
                      title="Step-by-Step Guide"
                      lines={[
                        "Open the workflow navigation panel",
                        "",
                        "Shows 7 steps to complete your decision:",
                        "1. Theme → 2. Input → 3. Critic → 4. Compare",
                        "5. Sentiment → 6. Stress Test → 7. Export",
                        "",
                        "Click steps to navigate directly to each section",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          onClick={() => setStepperVisible(true)}
                          disabled={isWorking}
                          className={btnFx(
                            "border-2 border-violet-400/50 bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 hover:from-violet-500/30 hover:to-fuchsia-500/30 dark:border-violet-400/40 dark:from-violet-500/15 dark:to-fuchsia-500/15 dark:hover:from-violet-500/25 dark:hover:to-fuchsia-500/25 font-semibold"
                          )}
                        >
                          <ListChecks className="h-4 w-4" />
                          Guide
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>

                    {/* SCAN IMAGE moved here - beside New Case and Use Template */}
                    {scanProgress ? (
                      <div className="flex-1 min-w-[200px] max-w-[320px] space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className={
                            scanProgress.percent === 100 
                              ? "text-emerald-600 dark:text-emerald-400 font-medium" 
                              : "text-black/70 dark:text-white/60"
                          }>
                            {scanProgress.label}
                          </span>
                          <span className={
                            scanProgress.percent === 100 
                              ? "text-emerald-600 dark:text-emerald-400 font-semibold" 
                              : scanProgress.percent >= 70 
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-sky-600 dark:text-sky-400"
                          }>
                            {scanProgress.percent}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                          <div 
                            className={[
                              "h-full rounded-full transition-all duration-300 ease-out",
                              scanProgress.percent === 100 
                                ? "bg-emerald-500" 
                                : scanProgress.percent >= 70 
                                  ? "bg-amber-500"
                                  : "bg-sky-500"
                            ].join(" ")}
                            style={{ width: `${scanProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <HoverTip
                        title="Smart Document Scan"
                        lines={[
                          "Auto-extract decision context from images",
                          "",
                          "Supported: PNG, JPG, WebP",
                          "Max file size: 4MB",
                          "Powered by Llama 4 Scout Vision",
                          "Auto-detects theme from content",
                        ]}
                        align="left"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="secondary"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isWorking || !!scanProgress}
                            className={btnFx(
                              "border border-indigo-300/35 bg-indigo-500/10 hover:bg-indigo-500/15 dark:border-indigo-300/25 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/15"
                            )}
                          >
                            <Sparkles className="h-4 w-4" />
                            Scan Image
                          </Button>
                          <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                        </span>
                      </HoverTip>
                    )}

                    {/* NEW CASE: Blank state */}
                    <HoverTip
                      title="New Case"
                      lines={[
                        "Start fresh with empty inputs",
                        "",
                        "Use this when starting a brand new decision",
                        "or clearing all current data",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          onClick={newCase}
                          disabled={isWorking}
                          className={btnFx(
                            "border border-sky-300/35 bg-sky-500/10 hover:bg-sky-500/15 dark:border-sky-300/25 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
                          )}
                        >
                          <Plus className="h-4 w-4" /> New Case
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>

                    {/* TEMPLATE: Single button opens template modal with both options */}
                    <HoverTip
                      title="Decision Templates"
                      lines={[
                        "Quick-start with pre-built frameworks",
                        "",
                        "🎯 Use Template: Load current theme example",
                        "📋 Browse Gallery: Explore all 11 templates",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          onClick={() => setShowTemplatePicker(true)}
                          disabled={isWorking}
                          className={btnFx(
                            "border border-emerald-300/35 bg-emerald-500/10 hover:bg-emerald-500/15 dark:border-emerald-300/25 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15"
                          )}
                        >
                          <FileText className="h-4 w-4" /> Template
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>
                  </div>

                  {/* ✅ Quick Action Buttons - Row 2: Sentiment, Snapshot, Ledger, Copy */}
                  <div id="section-sentiment" className="mt-1.5 flex flex-wrap gap-1.5 scroll-mt-20">
                    {/* SENTIMENT ANALYSIS */}
                    {extrasProgress ? (
                      <div className="flex-1 min-w-[180px] max-w-[280px] space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className={
                            extrasProgress.percent === 100 
                              ? "text-emerald-600 dark:text-emerald-400 font-medium" 
                              : "text-black/70 dark:text-white/60"
                          }>
                            {extrasProgress.label}
                          </span>
                          <span className={
                            extrasProgress.percent === 100 
                              ? "text-emerald-600 dark:text-emerald-400 font-semibold" 
                              : extrasProgress.percent >= 70 
                                ? "text-teal-600 dark:text-teal-400"
                                : extrasProgress.percent >= 40
                                  ? "text-cyan-600 dark:text-cyan-400"
                                  : "text-pink-500 dark:text-pink-400"
                          }>
                            {extrasProgress.percent}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{ 
                              width: `${extrasProgress.percent}%`,
                              background: extrasProgress.percent === 100 
                                ? 'linear-gradient(90deg, #10b981, #22c55e)'
                                : extrasProgress.percent >= 70 
                                  ? 'linear-gradient(90deg, #14b8a6, #10b981)'
                                  : extrasProgress.percent >= 40
                                    ? 'linear-gradient(90deg, #06b6d4, #14b8a6)'
                                    : 'linear-gradient(90deg, #ec4899, #f472b6)'
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <HoverTip
                        title="Sentiment Analysis"
                        lines={[
                          "Run additional AI analysis:",
                          "",
                          "• Sentiment Analysis (ABSA)",
                          "• Executive Conclusion", 
                          "• Related Research suggestions",
                          "",
                          "Results will be included in HTML/PDF reports",
                        ]}
                        align="left"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Button
                            variant="secondary"
                            onClick={fetchAllExtras}
                            disabled={isWorking || sentimentLoading || conclusionLoading || researchLoading}
                            className={btnFx(
                              "border border-rose-300/35 bg-rose-500/10 hover:bg-rose-500/15 dark:border-rose-300/25 dark:bg-rose-500/10 dark:hover:bg-rose-500/15"
                            )}
                          >
                            <Zap className="h-4 w-4" />
                            Sentiment Analysis
                          </Button>
                          <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                        </span>
                      </HoverTip>
                    )}

                    {/* SNAPSHOT */}
                    <HoverTip
                      title="Snapshot"
                      lines={[
                        "Save current state to decision ledger",
                        "",
                        "Creates a timestamped backup",
                        "Useful for tracking decision evolution",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          onClick={() => saveSnapshot("manual_snapshot")}
                          disabled={isWorking}
                          className={btnFx()}
                        >
                          <Wand2 className="h-4 w-4" /> Snapshot
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>

                    {/* LEDGER */}
                    <HoverTip
                      title="Ledger"
                      lines={[
                        "Export decision history as JSON",
                        "",
                        "Contains all snapshots and events",
                        "For backup or external analysis",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          onClick={exportLedger}
                          disabled={isWorking}
                          className={btnFx()}
                        >
                          <Download className="h-4 w-4" /> Ledger
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>

                    {/* COPY */}
                    <HoverTip
                      title="Copy"
                      lines={[
                        "Copy decision summary to clipboard",
                        "",
                        "Ready to paste in Slack, email, etc.",
                      ]}
                      align="left"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button variant="ghost" onClick={copyShareText} className={btnFx()}>
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </Button>
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </span>
                    </HoverTip>
                  </div>

                  {/* Gallery */}
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/[0.06] dark:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-semibold text-black dark:text-white/90">Gallery</div>
                        <div className="text-[12px] text-black/80 dark:text-white/60 mt-1">
                          Saved reports (local to this browser).
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Chip label={`${reportsCount}`} tone={"neutral" as any} />
                        <Button
                          variant="secondary"
                          onClick={goToGallery}
                          disabled={isWorking}
                          className={btnFx("px-3 py-2 h-auto rounded-2xl")}
                          title="Open gallery"
                        >
                          <GalleryHorizontal className="h-4 w-4" />
                          <span className="text-[12px]">Open</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* About */}
            <div className="mt-5">
              <AboutGrounds />
            </div>
          </CardContent>
        </Card>
        </div>
      </FadeIn>

      {/* Content area - spacing matches hero */}
      <div className="px-4 py-6 md:px-6 md:py-8 space-y-6 pb-24 lg:pb-8">

      {/* Make left & right columns the same height */}
      <div id="section-input" className="grid gap-6 md:grid-cols-2 items-stretch scroll-mt-20">
        {/* LEFT: FORM */}
        <FadeIn delay={0.06} className="h-full">
          <Card className="overflow-hidden h-full flex flex-col border border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/5">
            <PageCardHeader title="Decision input" subtitle="Write it like a calm briefing: short, concrete, and honest." />

            <CardContent className="flex flex-col flex-1 min-h-0 pt-4">
              {/* Input area with fade-in animation on reset/template */}
              <motion.div
                key={inputAreaKey}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="space-y-4 flex flex-col flex-1 min-h-0"
              >
                <Field label="Title" emoji="🏷️" help="Short and specific." typing={!!typingGlow.title}>
                  <Input
                    className={inputBaseClass("h-12")}
                    value={title}
                    onChange={setWithGlow("title", setTitle)}
                    placeholder="e.g. Should we allow AI drafting for court briefs?"
                  />
                </Field>

                <Field label="Context" emoji="🧭" help="One or two paragraphs the reader needs." typing={!!typingGlow.context} onVoiceInput={(text) => setContext(prev => prev ? `${prev} ${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("min-h-[160px] md:min-h-[180px]")}
                    value={context}
                    onChange={setWithGlow("context", setContext)}
                    rows={9}
                  />
                </Field>

                <Field label="Intent" emoji="🎯" help="Plain words. Define success." typing={!!typingGlow.intent} onVoiceInput={(text) => setIntent(prev => prev ? `${prev} ${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("min-h-[140px] md:min-h-[160px]")}
                    value={intent}
                    onChange={setWithGlow("intent", setIntent)}
                    rows={8}
                  />
                </Field>

                <Field
                  label="Options (one per line)"
                  emoji="🧩"
                  help="Real choices you’d pick between."
                  typing={!!typingGlow.options}
                  onVoiceInput={(text) => setOptions(prev => prev ? `${prev}\n${text}` : text)}
                >
                  <Textarea
                    className={textareaBaseClass("min-h-[160px] md:min-h-[180px]")}
                    value={options}
                    onChange={setWithGlow("options", setOptions)}
                    rows={9}
                  />
                </Field>

                <Field label="Assumptions" emoji="🧠" help="If false, decision changes." typing={!!typingGlow.assumptions} onVoiceInput={(text) => setAssumptions(prev => prev ? `${prev}\n${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("min-h-[140px] md:min-h-[160px]")}
                    value={assumptions}
                    onChange={setWithGlow("assumptions", setAssumptions)}
                    rows={8}
                  />
                </Field>

                <Field label="Risks" emoji="⚠️" help="What could fail first." typing={!!typingGlow.risks} onVoiceInput={(text) => setRisks(prev => prev ? `${prev}\n${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("min-h-[140px] md:min-h-[160px]")}
                    value={risks}
                    onChange={setWithGlow("risks", setRisks)}
                    rows={8}
                  />
                </Field>

                <Field label="Evidence" emoji="🧾" help="Links, metrics, experiments." typing={!!typingGlow.evidence} onVoiceInput={(text) => setEvidence(prev => prev ? `${prev}\n${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("min-h-[160px] md:min-h-[190px]")}
                    value={evidence}
                    onChange={setWithGlow("evidence", setEvidence)}
                    rows={9}
                  />
                </Field>

                <Field label="Outcome (optional)" emoji="📌" help="What actually happened." typing={!!typingGlow.outcome} grow onVoiceInput={(text) => setOutcome(prev => prev ? `${prev} ${text}` : text)}>
                  <Textarea
                    className={textareaBaseClass("h-full min-h-[180px] md:min-h-[220px]")}
                    value={outcome}
                    onChange={setWithGlow("outcome", setOutcome)}
                    placeholder="If something already happened, describe what actually occurred…"
                  />
                </Field>

                {/* Confidence */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[12px] text-black/80 dark:text-white/60">
                      <span className="mr-2">🔒</span>
                      <span className="text-black dark:text-white/75">Confidence</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-white/40">How solid is this brief right now?</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(["low", "medium", "high"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setConfidence(c)}
                        className={confidenceActiveClasses(c)}
                        title={CONF_LABEL[c].hint}
                      >
                        <motion.span
                          whileHover={{ y: -1 }}
                          transition={{ duration: 0.15 }}
                          className="inline-flex items-center gap-2"
                        >
                          {c === "low" ? (
                            <TriangleAlert className="h-4 w-4" />
                          ) : c === "medium" ? (
                            <Info className="h-4 w-4" />
                          ) : (
                            <Star className="h-4 w-4" />
                          )}
                          {CONF_LABEL[c].label}
                        </motion.span>
                      </button>
                    ))}
                  </div>

                  <div className="text-[12px] text-black/80 dark:text-white/60">{CONF_LABEL[confidence].hint}</div>
                </div>

                <div className="pt-1 text-[12px] text-black/80 dark:text-white/60">
                  {lastReportId ? (
                    <>
                      Saved to Gallery:{" "}
                      <span className="text-black dark:text-white/75 font-medium">{lastReportId.slice(0, 10)}…</span>{" "}
                      ✅
                    </>
                  ) : (
                    <>
                      Press <span className="text-black dark:text-white/75 font-medium">Process</span> to generate your report. ✨
                    </>
                  )}
                </div>
              </motion.div>


              {/* sticky bar */}
              <div id="section-export" className="mt-auto pt-4 scroll-mt-20">
                <div className="sticky bottom-0 rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-md p-3 shadow-[0_12px_50px_rgba(0,0,0,.08)] dark:border-white/[0.06] dark:bg-[#0b0c14]/60 dark:shadow-[0_22px_90px_rgba(0,0,0,.45)]">
                  <div className="mb-2 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Process → Review → Download - whitespace-nowrap prevents wrapping */}
                      <div className="text-[11px] text-slate-600 dark:text-white/70 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        {isWorking ? (
                          <motion.span className="inline-flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <span className="h-2 w-2 rounded-full bg-slate-700/70 dark:bg-white/70 animate-pulse" />
                            <span>Generating…</span>
                          </motion.span>
                        ) : isProcessed ? (
                          <motion.span 
                            className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium" 
                            initial={{ opacity: 0, scale: 0.9 }} 
                            animate={{ opacity: 1, scale: 1 }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Finished</span>
                            <span className="text-slate-400 dark:text-white/50">·</span>
                            <span className="text-slate-600 dark:text-white/70 font-normal">Ready to Review & Download</span>
                          </motion.span>
                        ) : (
                          <>
                            <Zap className="h-3 w-3 shrink-0" />
                            <span className="text-black dark:text-white/90 font-medium">Process</span>
                            <span className="text-slate-400 dark:text-white/50">→</span>
                            <span>Review</span>
                            <span className="text-slate-400 dark:text-white/50">→</span>
                            <span>Download</span>
                          </>
                        )}
                      </div>

                      {/* ✅ Score synced with confidence level - shows 100/100 + Finished after Process */}
                      {(() => {
                        const hasContent = title.trim() || context.trim() || intent.trim();
                        const confidenceScore = confidence === "high" ? 100 : confidence === "medium" ? 70 : 30;
                        const confidenceLabel = confidence === "high" ? "Committed" : confidence === "medium" ? "Solid" : "Draft";
                        
                        // After Process: show 100/100 + "Finished"
                        const displayScore = isProcessed ? 100 : (hasContent ? Math.min(readinessScore, confidenceScore) : 0);
                        const displayLabel = isProcessed ? "Finished" : (hasContent ? confidenceLabel : "Empty");
                        const displayTone = isProcessed ? "good" : (displayScore >= 85 ? "good" : displayScore >= 55 ? "warn" : "bad");
                        
                        return (
                          <HoverTip title={isProcessed ? "Report Generated ✓" : readinessTip.title} lines={isProcessed ? ["Your decision report is ready!", "Click Review HTML or Review PDF to see it."] : readinessTip.lines} align="center">
                            <div className="inline-flex items-center gap-1.5 shrink-0">
                              <Chip
                                label={`${displayLabel} · ${displayScore}/100`}
                                tone={displayTone as any}
                                hint={isProcessed ? "✅ Report generated successfully" : "ℹ️ Score based on content + confidence level"}
                              />
                              {isProcessed && (
                                <motion.span
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  className="text-emerald-500"
                                >
                                  ✓
                                </motion.span>
                              )}
                              <InfoDot className="shrink-0" />
                            </div>
                          </HoverTip>
                        );
                      })()}
                    </div>

                    <div className="text-[11px] text-black/80 dark:text-white/60 shrink-0 whitespace-nowrap">
                      {canPreview ? "Report ready ✅" : "Process to unlock reviews ✨"}
                    </div>
                  </div>

                  {/* ✅ Animated progress bar */}
                  <div className="mb-3 h-2 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-white/[0.06] dark:bg-white/5 relative">
                    {/* Shimmer animation overlay */}
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                      initial={{ x: "-100%" }}
                      animate={{ x: "200%" }}
                      transition={{ 
                        duration: 2, 
                        repeat: Infinity, 
                        ease: "linear",
                        repeatDelay: 1
                      }}
                    />
                    <div className="h-full w-full flex relative z-10">
                      <motion.div
                        className="h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${isProcessed ? 100 : Math.max(0, Math.min(100, readinessScore))}%` }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                        style={{
                          background: isProcessed 
                            ? "linear-gradient(90deg, rgba(52,211,153,.85), rgba(34,211,238,.65))"
                            : readinessScore >= 85
                              ? "linear-gradient(90deg, rgba(52,211,153,.70), rgba(34,211,238,.45))"
                              : readinessScore >= 70
                              ? "linear-gradient(90deg, rgba(34,211,238,.55), rgba(167,139,250,.40))"
                              : readinessScore >= 55
                              ? "linear-gradient(90deg, rgba(251,191,36,.55), rgba(167,139,250,.35))"
                              : "linear-gradient(90deg, rgba(244,63,94,.55), rgba(251,191,36,.30))",
                        }}
                      />
                      {/* Hide the "missing" bar when processed */}
                      {!isProcessed && (
                        <motion.div
                          className="h-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(0, Math.min(100, missingTo100))}%` }}
                          transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
                          style={{
                            background: "linear-gradient(90deg, rgba(251,113,133,.24), rgba(244,63,94,.14))",
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:flex md:flex-wrap md:gap-2">
                    <Button
                      onClick={async () => {
                        setIsWorking(true);
                        await new Promise((r) => setTimeout(r, 0));
                        try {
                          const iso = new Date().toISOString();
                          setCreatedAtISO(iso);

                          const localInput: DecisionInput = { ...input, createdAtISO: iso };

                          saveSnapshot("process_click");
                          appendDecisionEvent({ compareWinner: winnerProvider });

                          processDecisionWith(localInput);
                          setGalleryTick((x) => x + 1);
                          setIsProcessed(true); // Mark as processed for 100/100 display
                        } finally {
                          setIsWorking(false);
                        }
                      }}
                      disabled={isWorking}
                      className={btnFx("w-full md:w-auto")}
                      title="Generate report artifacts"
                    >
                      <Sparkles className="h-4 w-4" /> {isProcessed ? "Finished ✓" : "Process"}
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={previewHTMLNewTab}
                      disabled={isWorking || !canPreview}
                      className={btnFx("w-full md:w-auto")}
                      title={!canPreview ? "Press Process first" : "Open HTML review"}
                    >
                      <FileText className="h-4 w-4" /> Review HTML
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={previewPDFNewTab}
                      disabled={isWorking || !canPreview}
                      className={btnFx("w-full md:w-auto")}
                      title={!canPreview ? "Press Process first" : "Open PDF review"}
                    >
                      <FileText className="h-4 w-4" /> Review PDF
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </FadeIn>

        {/* RIGHT: SIGNALS + COMPARE */}
        <FadeIn delay={0.1} className="h-full">
          <Card className="overflow-hidden h-full flex flex-col border border-slate-200 bg-slate-50 dark:border-white/[0.06] dark:bg-white/5">
            <PageCardHeader
              title="Decision signals"
              subtitle="Fast feedback + what to fix next (before you commit)."
              right={
                <HoverTip title={gradeTip.title} lines={gradeTip.lines} align="right">
                  <div className="inline-flex items-center gap-1">
                    <Chip label={`Grade ${analysis.readiness.grade}`} tone={gradeTone as any} />
                    <InfoDot />
                  </div>
                </HoverTip>
              }
            />

            <CardContent className="space-y-4 flex-1 min-h-0 pt-4">
              {/* Live reaction */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/[0.06] dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-black dark:text-white/90">Live reaction</div>
                    <div className="text-[12px] text-black/80 dark:text-white/60 mt-1">{textSignals.hintLine}</div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <HoverTip title={completenessTip.title} lines={completenessTip.lines} align="right">
                      <div className="inline-flex items-center gap-1">
                        <Chip label={`Completeness ${textSignals.completeness}/100`} tone={"info" as any} />
                        <InfoDot />
                      </div>
                    </HoverTip>

                    <HoverTip title={actionabilityTip.title} lines={actionabilityTip.lines} align="right">
                      <div className="inline-flex items-center gap-1">
                        <Chip
                          label={`Actionability ${textSignals.actionability}/100`}
                          tone={
                            (textSignals.actionability >= 80
                              ? "good"
                              : textSignals.actionability >= 60
                              ? "info"
                              : "warn") as any
                          }
                        />
                        <InfoDot />
                      </div>
                    </HoverTip>
                  </div>
                </div>

                {/* 3D Decision Landscape Visualization - Only show when there's actual input */}
                {(input.context.trim() || input.intent.trim() || input.options.some(o => o.trim()) || input.assumptions.some(a => a.trim()) || input.risks.some(r => r.trim()) || input.evidence.some(e => e.trim())) && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-[#0d1117] p-4 dark:border-white/[0.06]">
                    <DecisionLandscape
                      metrics={{
                        readiness: analysis.readiness.score,
                        blindSpotCoverage: analysis.blindSpots?.score || 50,
                        confidence: textSignals.completeness,
                        riskScore: Math.max(0, 100 - textSignals.lineCounts.risks * 15),
                        evidenceQuality: textSignals.actionability,
                        actionability: analysis.readiness.score >= 70 ? 85 : analysis.readiness.score >= 50 ? 65 : 45,
                      }}
                      title="Decision Landscape"
                      showLabels={true}
                      animated={true}
                    />
                  </div>
                )}

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-[#0b0c14]/25">
                    <div className="text-[11px] text-black/70 dark:text-white/55">Counts</div>
                    <div className="mt-1 text-[12px] text-slate-700 dark:text-white/75">
                      Options:{" "}
                      <span className="text-black dark:text-white/90 font-medium">{textSignals.lineCounts.options}</span> ·
                      Assumptions:{" "}
                      <span className="text-black dark:text-white/90 font-medium">{textSignals.lineCounts.assumptions}</span>{" "}
                      · Risks:{" "}
                      <span className="text-black dark:text-white/90 font-medium">{textSignals.lineCounts.risks}</span> · Evidence:{" "}
                      <span className="text-black dark:text-white/90 font-medium">{textSignals.lineCounts.evidence}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-black/70 dark:text-white/45">Quick “decision-grade?” sanity check.</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-[#0b0c14]/25">
                    <div className="text-[11px] text-black/70 dark:text-white/55">Clarity markers</div>
                    <div className="mt-1 text-[12px] text-slate-700 dark:text-white/75">
                      Hard edges:{" "}
                      <span className="text-black dark:text-white/90 font-medium">
                        {textSignals.hasNumbers ? "present" : "missing"}
                      </span>{" "}
                      · Generic phrasing:{" "}
                      <span className="text-black dark:text-white/90 font-medium">{textSignals.genericHit}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-black/70 dark:text-white/45">Add metrics + replace vague adjectives.</div>
                  </div>
                </div>

                {textSignals.nextFix.length ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/[0.06] dark:bg-white/5">
                    <div className="text-[12px] text-black dark:text-white/80 font-medium">What to fix next</div>
                    <div className="mt-2 space-y-2">
                      {textSignals.nextFix.map((x, idx) => (
                        <div
                          key={idx}
                          className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 dark:border-white/[0.06] dark:bg-[#0b0c14]/25"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="mt-[2px] text-black dark:text-white/70">{x.icon}</div>
                            <div className="min-w-0">
                              <div className="text-[12px] text-black dark:text-white/85 font-medium">{x.title}</div>
                              <div className="mt-1 text-[11px] text-black/70 dark:text-white/55">{x.note}</div>
                            </div>
                          </div>

                          <Button
                            variant="secondary"
                            onClick={fixActionFor(x.key)}
                            className={btnFx("shrink-0")}
                            title="Apply a smart fix"
                          >
                            <Sparkles className="h-4 w-4" /> Fix
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Provider compare */}
              <div id="section-compare" className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/[0.06] dark:bg-white/5 scroll-mt-20">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-black dark:text-white/90">Provider compare</div>
                    <div className="text-[12px] text-black/80 dark:text-white/60 mt-1">
                      Run the same task across providers. Normalize + pick a winner.{" "}
                      <span className="text-black dark:text-white/70">Use fills Outcome + Evidence.</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <div className="text-[11px] text-black/70 dark:text-white/50 hidden sm:block">
                      {compareResp?.results?.length
                        ? `Last run: ${new Date(compareLastISO || Date.now()).toLocaleTimeString()}`
                        : "Not run yet"}
                    </div>

                    {winnerProvider ? (
                      <Chip label={`Winner: ${providerMeta(winnerProvider).emoji} ${winnerProvider}`} tone={"good" as any} />
                    ) : null}
                    {pinnedProvider ? (
                      <Chip label={`Pinned: ${providerMeta(pinnedProvider).emoji} ${pinnedProvider}`} tone={"info" as any} />
                    ) : null}

                    <Chip
                      label={compareLoading ? "Running…" : compareResp?.results?.length ? "Ready" : "Idle"}
                      tone={(compareLoading ? "info" : compareResp?.results?.length ? "good" : "neutral") as any}
                    />
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/[0.06] dark:bg-white/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] text-black dark:text-white/80 font-medium">Compare task</div>
                      <div className="text-[11px] text-black/70 dark:text-white/45 mt-1">Keep it short. Ask for bullets.</div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-[11px] text-black/80 dark:text-white/60 select-none">
                      <input
                        type="checkbox"
                        checked={compareAttachToReport}
                        onChange={(e) => setCompareAttachToReport(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      Attach to report
                    </label>
                  </div>

                  <div className="mt-2">
                    <GlowWrap active={!!typingGlow.comparePrompt}>
                      <Textarea
                        className={textareaBaseClass("")}
                        rows={3}
                        value={comparePrompt}
                        onChange={setWithGlow("comparePrompt", setComparePrompt)}
                        placeholder="Example: Use headings + bullets. Be concrete."
                      />
                    </GlowWrap>
                  </div>

                  <div className="mt-2 text-[11px] text-black/70 dark:text-white/45">
                    After you run compare, press{" "}
                    <span className="text-black dark:text-white/70 font-medium">Use best option</span> or{" "}
                    <span className="text-black dark:text-white/70 font-medium">Process</span>.
                  </div>
                </div>

                {/* ✅ Calculate rankings for all providers */}
                {(() => {
                  const rankings = getProviderRankings(normalizedCompare);
                  
                  return (
                <div className="mt-3 grid gap-2">
                  {PROVIDERS.map((p) => {
                    const meta = providerMeta(p.id);

                    const enabled = compareEnabled[p.id] ?? false;
                    const model = compareModels[p.id] ?? "";
                    const rowResult = compareResp?.results?.find((x) => x.provider === p.id) ?? null;

                    const isPinned = pinnedProvider === p.id;
                    const isWinner = winnerProvider === p.id;
                    const isChosen = isPinned || (!pinnedProvider && isWinner);
                    
                    // ✅ Get ranking for this provider
                    const ranking = rankings.get(p.id);

                    const locked = !enabled || compareLoading;

                    const normalized = rowResult ? normalizeCompareItem(rowResult) : null;

                    const scoreTip = normalized
                      ? {
                          title: `${meta.emoji} ${meta.name} score · ${normalized.score}/100`,
                          lines: [
                            "This is a lightweight UI hint (not the official scorer).",
                            `Reason: ${normalized.scoreReason}`,
                            `Latency: ${normalized.latencyMs ?? "-"}ms`,
                            `Model: ${rowResult?.model ?? model ?? "-"}`,
                            `Output length: ${normalized.text.length}`,
                          ],
                        }
                      : null;

                    return (
                      <div
                        key={p.id}
                        className={[
                          "relative overflow-hidden rounded-2xl border-2 p-3 transition-all",
                          meta.borderColor,
                          "bg-white/80 dark:bg-white/5",
                          isChosen
                            ? "shadow-[0_0_0_1px_rgba(52,211,153,.16),inset_0_0_0_1px_rgba(52,211,153,.10)]"
                            : "",
                        ].join(" ")}
                      >
                        {/* per-provider animated glow */}
                        <motion.div
                          aria-hidden="true"
                          className={[
                            "pointer-events-none absolute -inset-x-10 -top-14 h-44 blur-2xl opacity-70",
                            "bg-gradient-to-r",
                            meta.glow,
                          ].join(" ")}
                          initial={false}
                          animate={reduceMotion ? undefined : { x: ["-4%", "4%", "-4%"] }}
                          transition={reduceMotion ? undefined : { duration: 6.5, ease: "easeInOut", repeat: Infinity }}
                        />

                        <div className="relative">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => toggleProvider(p.id)}
                                  className={[
                                    "inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[12px] select-none",
                                    btnFx(""),
                                    enabled
                                      ? "border-emerald-300/35 bg-emerald-400/10 text-black dark:text-emerald-50 dark:bg-emerald-400/10"
                                      : "border-rose-300/35 bg-rose-500/10 text-black dark:text-rose-50 dark:bg-rose-500/10",
                                  ].join(" ")}
                                  title="Enable/disable this provider"
                                  disabled={compareLoading}
                                >
                                  <span className={["h-2.5 w-2.5 rounded-full animate-pulse", meta.dot, meta.dotGlow].join(" ")} />
                                  <span className="font-semibold">
                                    {meta.emoji} {p.label}
                                  </span>
                                </button>

                                <Chip label={enabled ? "Enabled" : "Disabled"} tone={(enabled ? "good" : "bad") as any} />
                                {p.featured ? <Chip label="⭐ Featured" tone={"info" as any} /> : null}
                                {isPinned ? <Chip label="📌 Pinned" tone={"info" as any} /> : null}
                                {/* ✅ Show ranking with medal + text */}
                                {ranking ? (
                                  <Chip 
                                    label={`${ranking.medal} ${ranking.label}`} 
                                    tone={(ranking.rank === 1 ? "good" : ranking.rank <= 3 ? "info" : "neutral") as any} 
                                  />
                                ) : null}

                                {normalized?.ok ? (
                                  scoreTip ? (
                                    <HoverTip title={scoreTip.title} lines={scoreTip.lines} align="center">
                                      <div className="inline-flex items-center gap-1">
                                        <Chip
                                          label={`Score ${normalized.score}`}
                                          tone={
                                            (normalized.score >= 80 ? "good" : normalized.score >= 60 ? "info" : "warn") as any
                                          }
                                        />
                                        <InfoDot />
                                      </div>
                                    </HoverTip>
                                  ) : (
                                    <Chip label={`Score ${normalized.score}`} tone={"info" as any} />
                                  )
                                ) : null}
                              </div>

                              <div className="mt-1 text-[11px] text-black/70 dark:text-white/45">
                                {p.hint}
                                {rowResult?.latencyMs != null ? <span className="ml-2">· {rowResult.latencyMs}ms</span> : null}
                              </div>
                            </div>

                            <div className="w-[52%] min-w-[220px]">
                              <div
                                className={[
                                  "rounded-2xl border px-3 py-2",
                                  "border-slate-200 bg-white/75 dark:border-white/[0.06] dark:bg-white/5",
                                  locked ? "opacity-60" : "opacity-100",
                                ].join(" ")}
                              >
                                <div className="text-[11px] text-black/70 dark:text-white/55 mb-1">Model</div>
                                <select
                                  value={model}
                                  onChange={(e) => setProviderModel(p.id, e.target.value)}
                                  disabled={locked}
                                  className="w-full bg-transparent text-[13px] text-slate-900 outline-none dark:text-white/85"
                                >
                                  {MODEL_OPTIONS[p.id].map((opt) => (
                                    <option
                                      key={opt.value}
                                      value={opt.value}
                                      className="bg-white text-slate-900 dark:bg-[#0b0c14] dark:text-white"
                                    >
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="mt-1 text-[10px] text-slate-600 dark:text-white/40">Choose a supported model.</div>
                            </div>
                          </div>

                          {rowResult ? (
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/[0.06] dark:bg-[#0b0c14]/25">
                              <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="text-[12px] font-medium text-black dark:text-white/70">{rowResult.ok ? "Response" : "Issue"}</div>

                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                  <Button
                                    variant={isPinned ? "secondary" : "ghost"}
                                    onClick={() => {
                                      setPinnedProvider((prev) => (prev === p.id ? null : p.id));
                                      toast.show(isPinned ? "Unpinned ✓" : `Pinned ${p.label} ✓`);
                                    }}
                                    className={btnFx("px-3 py-1.5 text-[12px]")}
                                    title="Pin this provider"
                                    disabled={compareLoading}
                                  >
                                    <Star className="h-3.5 w-3.5" /> {isPinned ? "Pinned" : "Pin"}
                                  </Button>

                                  {rowResult.ok && rowResult.text ? (
                                    <>
                                      <Button
                                        variant="ghost"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(rowResult.text || "");
                                            toast.show("Copied ✓");
                                          } catch {
                                            toast.show("Copy failed (clipboard blocked).");
                                          }
                                        }}
                                        className={btnFx("px-3 py-1.5 text-[12px]")}
                                        title="Copy text"
                                      >
                                        <Copy className="h-3.5 w-3.5" /> Copy
                                      </Button>

                                      <Button
                                        variant="secondary"
                                        onClick={() => useCompareResult(p.id, rowResult.text || "")}
                                        className={btnFx("px-3 py-1.5 text-[12px]")}
                                        title="Insert this provider result into Outcome + Evidence"
                                      >
                                        <ArrowRight className="h-3.5 w-3.5" /> Use
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      onClick={runCompare}
                                      className={btnFx("px-3 py-1.5 text-[12px]")}
                                      title="Retry compare"
                                      disabled={compareLoading}
                                    >
                                      <Play className="h-3.5 w-3.5" /> Retry
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {rowResult.ok ? (
                                <>
                                  {normalized?.ok ? (
                                    <div className="mt-2 text-[11px] text-black/70 dark:text-white/45">
                                      Normalized:{" "}
                                      <span className="text-black dark:text-white/70">score={normalized.score}</span> ·{" "}
                                      <span className="text-black/80 dark:text-white/60">{normalized.scoreReason}</span>
                                    </div>
                                  ) : null}

                                  {/* ✅ Use formatted rendering instead of raw <pre> */}
                                  <FormattedCompareText text={rowResult.text || "(empty)"} providerId={p.id} />
                                </>
                              ) : (
                                (() => {
                                  const errMsg =
                                    typeof rowResult.error === "string"
                                      ? rowResult.error
                                      : rowResult.error?.message || rowResult.message || "";
                                  const pretty = prettyProviderError(errMsg);
                                  return (
                                    <div className="mt-2 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-3">
                                      <div className="text-[12px] text-black dark:text-rose-50 font-medium">{pretty.title}</div>
                                      <div className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-100/70">{pretty.tip}</div>
                                      <div className="mt-2 text-[11px] text-rose-700/75 dark:text-rose-100/50 break-words">
                                        <span className="font-medium text-rose-800 dark:text-rose-100/70">Details:</span>{" "}
                                        {errMsg || "Request failed"}
                                      </div>
                                    </div>
                                  );
                                })()
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                  );
                })()}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-black/70 dark:text-white/45">
                    Uses <span className="text-black dark:text-white/70 font-medium">/api/compare</span>. Disable providers you don’t use.
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={runCompare}
                      disabled={compareLoading || isWorking || enabledProvidersCount <= 0}
                      className={btnFx()}
                      title={enabledProvidersCount <= 0 ? "Enable at least 1 provider first" : "Run compare"}
                    >
                      {compareLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Running
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" /> Run compare
                        </>
                      )}
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={useBestCompareOption}
                      disabled={compareLoading || isWorking || !normalizedCompare.length}
                      className={btnFx()}
                      title={!normalizedCompare.length ? "Run compare first" : "Use winner (or pinned) into Outcome + Evidence"}
                    >
                      <Sparkles className="h-4 w-4" /> Use best option
                    </Button>
                  </div>
                </div>
              </div>

              {/* Gemini Critic Panel - Premium wrapper */}
              <div id="section-critic" className="mt-6 relative scroll-mt-20">
                {/* Premium border glow effect */}
                <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-r from-cyan-500/20 via-violet-500/20 to-rose-500/20 blur-sm" />
                <div className="relative rounded-3xl border border-white/10 bg-[#0d0e16] p-4 overflow-hidden">
                  {/* Inner gradient accent */}
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-violet-500/5 pointer-events-none" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="text-[11px] text-white/50">
                        Gemini Critic powered by <span className="font-medium text-cyan-400">Gemini 3</span>
                      </div>
                      <HoverTip
                        title="Gemini Critic Status"
                        lines={[
                          "🔴 No input: Fill in the decision inputs to get started.",
                          "🟢 Ready: All set. Click Run Critic to analyze.",
                          "🟡 Running: Analysis in progress. Takes a few seconds.",
                          "🔵 Done: Analysis complete. Review the results below."
                        ]}
                        align="left"
                      >
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </HoverTip>
                    </div>
                    <GeminiCriticPanel
                      className=""
                      title={title}
                      context={context}
                      intent={intent}
                      options={input.options}
                      assumptions={input.assumptions}
                      risks={input.risks}
                      evidence={input.evidence}
                      outcome={outcome}
                      btnFx={btnFx}
                      onToast={toast.show}
                      onResult={(r) => {
                        geminiCriticRef.current = r;
                        setGeminiCritic(r);
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ── Deep Reasoner: Stress Test Panel ── */}
              <div id="section-stress" className="mt-6 relative scroll-mt-20">
                <div className="relative rounded-3xl border border-slate-200/60 dark:border-white/[0.06] bg-white/50 dark:bg-white/[0.02] p-4 overflow-hidden transition-all duration-200 hover:border-violet-300 dark:hover:border-violet-500/20">
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="text-[11px] text-black/50 dark:text-white/50">
                        🔬 Deep Reasoner powered by <span className="font-medium text-violet-600 dark:text-violet-400">Gemini 3</span>
                      </div>
                      <HoverTip
                        title="Deep Reasoner: Stress Test"
                        lines={[
                          "🔬 Adversarial AI analysis that attacks your decision from every angle.",
                          "🛡️ Scores: Robustness, Assumption Strength, Risk Coverage, Evidence Quality, Execution Readiness.",
                          "😈 Devil's Advocate: AI generates worst-case challenges and counter-arguments.",
                          "🔗 Hidden Dependencies: Finds unacknowledged dependencies that could cause cascading failure.",
                          "📊 Probability Matrix: Quantifies overall failure risk and identifies correlated risks.",
                          "🧠 Thinking Path: Shows the AI's step-by-step reasoning process.",
                          "⚙️ Requires: Title + Context filled in. More input fields = deeper analysis.",
                          "📄 Results appear in both HTML and PDF reports with full interpretation.",
                        ]}
                        align="left"
                      >
                        <InfoDot className="opacity-50 hover:opacity-80 transition-opacity" />
                      </HoverTip>
                    </div>

                    {/* Stress Test Results */}
                    {stressTestData && (
                      <div className="mb-4 space-y-3">
                        {/* Score overview */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                          {[
                            { label: "Robustness", value: stressTestData.scores.overall_robustness, emoji: "🛡️" },
                            { label: "Assumptions", value: stressTestData.scores.assumption_strength, emoji: "🧱" },
                            { label: "Risk Coverage", value: stressTestData.scores.risk_coverage, emoji: "⚡" },
                            { label: "Evidence", value: stressTestData.scores.evidence_quality, emoji: "📎" },
                            { label: "Execution", value: stressTestData.scores.execution_readiness, emoji: "🚀" },
                          ].map((sc) => {
                            const color = sc.value >= 80 ? "text-emerald-500" : sc.value >= 60 ? "text-amber-500" : sc.value >= 40 ? "text-orange-500" : "text-red-500";
                            const bg = sc.value >= 80 ? "bg-emerald-500/10" : sc.value >= 60 ? "bg-amber-500/10" : sc.value >= 40 ? "bg-orange-500/10" : "bg-red-500/10";
                            return (
                              <div key={sc.label} className={cx("rounded-xl border border-slate-200/50 dark:border-white/[0.06] p-2.5 text-center transition-all hover:scale-[1.02]", bg)}>
                                <div className="text-[10px] text-black/50 dark:text-white/40">{sc.emoji} {sc.label}</div>
                                <div className={cx("text-lg font-bold tabular-nums", color)}>{Math.round(sc.value)}</div>
                              </div>
                            );
                          })}
                        </div>
                        {/* Critical flaw alert */}
                        {stressTestData.critical_flaw && (
                          <div className="p-3 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/5">
                            <div className="text-[12px] font-semibold text-red-600 dark:text-red-400">🚨 {stressTestData.critical_flaw.title}</div>
                            <div className="text-[11px] text-red-500/80 dark:text-red-300/60 mt-1">{stressTestData.critical_flaw.explanation}</div>
                          </div>
                        )}
                        {/* Quick summary */}
                        <div className="text-[11px] text-black/50 dark:text-white/40">
                          {stressTestData.devils_advocate_challenges?.length || 0} challenges · {stressTestData.hidden_dependencies?.length || 0} hidden deps · {stressTestData.blind_spots?.length || 0} blind spots
                          {stressTestData.meta?.processing_time_ms ? ` · ${Math.round(stressTestData.meta.processing_time_ms)}ms` : ""}
                        </div>
                      </div>
                    )}

                    {/* Run button */}
                    <Button
                      disabled={stressTestLoading || (!title.trim() && !context.trim())}
                      onClick={async () => {
                        if (stressTestLoading) return;
                        setStressTestLoading(true);
                        try {
                          const res = await fetch("/api/deep-reasoner", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              title: title.trim(),
                              context: context.trim(),
                              intent: intent.trim(),
                              options: input.options,
                              assumptions: input.assumptions,
                              risks: input.risks,
                              evidence: input.evidence,
                              outcome: outcome.trim(),
                              confidence,
                            }),
                          });
                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          const json = await res.json();
                          if (json.success && json.result) {
                            const result: StressTestReportData = json.result;
                            setStressTestData(result);
                            stressTestRef.current = result;
                            toast.show("Stress test complete ✓");
                          } else {
                            throw new Error(json.error || "Unknown error");
                          }
                        } catch (err: any) {
                          toast.show(`Stress test failed: ${err.message}`);
                        } finally {
                          setStressTestLoading(false);
                        }
                      }}
                      className={cx(
                        btnFx(),
                        "border border-slate-200/60 dark:border-white/[0.08] bg-transparent hover:bg-violet-50 dark:hover:bg-violet-500/5",
                        "text-black/70 dark:text-white/60 hover:text-violet-700 dark:hover:text-violet-300",
                      )}
                    >
                      {stressTestLoading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Running stress test...</>
                      ) : stressTestData ? (
                        <><RotateCcw className="h-4 w-4" /> Re-run Stress Test</>
                      ) : (
                        <><Zap className="h-4 w-4" /> Run Stress Test</>
                      )}
                    </Button>
                    {!title.trim() && !context.trim() && (
                      <div className="mt-1.5 text-[10px] text-black/40 dark:text-white/30">Fill in Title or Context to enable stress test.</div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>
      </div>{/* end content wrapper */}

      {/* ✅ Full-page Preview Modal (consistent UX like Gallery) */}
      {previewModal?.open && (
        <div className="fixed inset-0 z-50 flex flex-col">
          {/* Full page container with theme support */}
          <div 
            className={cx(
              "flex-1 flex flex-col transition-colors duration-200",
              previewTheme === "light" 
                ? "bg-[#f6f7fb]" 
                : "bg-[#0b0c14]"
            )}
          >
            {/* Header bar */}
            <header 
              className={cx(
                "sticky top-0 z-10 border-b backdrop-blur-xl transition-colors duration-200",
                previewTheme === "light"
                  ? "border-black/10 bg-white/80"
                  : "border-white/10 bg-black/30"
              )}
            >
              <div className="mx-auto max-w-6xl px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  {/* Left - Logo & label */}
                  <div className="flex items-center gap-3">
                    <div 
                      className={cx(
                        "flex items-center gap-2 px-3 py-1.5 rounded-2xl border",
                        previewTheme === "light"
                          ? "border-black/10 bg-white/70"
                          : "border-white/10 bg-white/5"
                      )}
                    >
                      <div className="w-2 h-2 rounded-full bg-gradient-to-r from-cyan-400 via-violet-400 to-rose-400" />
                      <span 
                        className={cx(
                          "text-[12px] font-semibold",
                          previewTheme === "light" ? "text-slate-900" : "text-white/90"
                        )}
                      >
                        Grounds
                      </span>
                      <span 
                        className={cx(
                          "text-[11px]",
                          previewTheme === "light" ? "text-slate-500" : "text-white/50"
                        )}
                      >
                        {previewModal.kind === "pdf" ? "PDF Review" : "HTML Review"}
                      </span>
                    </div>
                  </div>

                  {/* Right - Actions */}
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* Theme toggle */}
                    <button
                      onClick={() => {
                        const newTheme = previewTheme === "dark" ? "light" : "dark";
                        setPreviewTheme(newTheme);
                        // Apply theme to iframe content (HTML preview)
                        try {
                          const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement;
                          if (iframe?.contentDocument?.documentElement) {
                            iframe.contentDocument.documentElement.setAttribute("data-theme", newTheme);
                            iframe.contentDocument.documentElement.style.colorScheme = newTheme;
                          }
                        } catch {
                          // Cross-origin or PDF - ignore
                        }
                      }}
                      className={cx(
                        "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[12px] transition-all",
                        previewTheme === "light"
                          ? "border-black/10 bg-black/5 hover:bg-black/10 text-slate-700"
                          : "border-white/10 bg-white/5 hover:bg-white/10 text-white/80"
                      )}
                    >
                      {previewTheme === "light" ? "☀️ Light" : "🌙 Dark"}
                    </button>

                    {/* Download */}
                    <button
                      onClick={downloadFromModal}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-[12px] text-emerald-400 transition-all"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>

                    {/* Google Export */}
                    <button
                      onClick={() => setShowGoogleExport(true)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-blue-400/30 bg-gradient-to-r from-blue-500/10 to-emerald-500/10 hover:from-blue-500/20 hover:to-emerald-500/20 text-[12px] text-blue-400 transition-all"
                      title="Export to Google Docs, Sheets, or Drive"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5">
                        <path
                          d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"
                          fill="currentColor"
                        />
                      </svg>
                      Google
                    </button>

                    {/* Share: Email */}
                    {previewModal.kind === "pdf" && (
                      <>
                        <button
                          onClick={async () => {
                            const filename = `Decision-Report-${(title || 'Analysis').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
                            // Try Web Share API with file (mobile)
                            if (navigator.share && navigator.canShare) {
                              try {
                                const response = await fetch(previewModal.url);
                                const blob = await response.blob();
                                const file = new File([blob], filename, { type: 'application/pdf' });
                                if (navigator.canShare({ files: [file] })) {
                                  await navigator.share({
                                    title: 'Decision Report: ' + (title || 'Analysis'),
                                    text: 'Decision Intelligence Report generated with Grounds',
                                    files: [file]
                                  });
                                  return;
                                }
                              } catch (e) { console.log('Web Share failed'); }
                            }
                            // Fallback: Download PDF then open mailto
                            const a = document.createElement('a');
                            a.href = previewModal.url;
                            a.download = filename;
                            a.click();
                            setTimeout(() => {
                              const s = encodeURIComponent('Decision Report: ' + (title || 'Analysis'));
                              const b = encodeURIComponent('Hi,\n\nPlease find attached the Decision Intelligence Report: "' + (title || 'My Decision') + '"\n\n(PDF downloaded - please attach it)\n\nGenerated with Grounds');
                              window.open('mailto:?subject=' + s + '&body=' + b, '_blank');
                            }, 500);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-blue-400/30 bg-blue-500/10 hover:bg-blue-500/20 text-[12px] text-blue-400 transition-all"
                          title="Share via Email (downloads PDF)"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                          Email
                        </button>
                        <button
                          onClick={async () => {
                            const filename = `Decision-Report-${(title || 'Analysis').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
                            // Try Web Share API with file (mobile)
                            if (navigator.share && navigator.canShare) {
                              try {
                                const response = await fetch(previewModal.url);
                                const blob = await response.blob();
                                const file = new File([blob], filename, { type: 'application/pdf' });
                                if (navigator.canShare({ files: [file] })) {
                                  await navigator.share({
                                    title: 'Decision Report',
                                    text: '📊 Decision Report: ' + (title || 'Decision') + '\nGenerated with Grounds',
                                    files: [file]
                                  });
                                  return;
                                }
                              } catch (e) { console.log('Web Share failed'); }
                            }
                            // Fallback: Download then open WhatsApp
                            const a = document.createElement('a');
                            a.href = previewModal.url;
                            a.download = filename;
                            a.click();
                            setTimeout(() => {
                              const t = encodeURIComponent('📊 *Decision Report*\n📌 *' + (title || 'Decision') + '*\n\n_PDF downloaded - please attach_\n\n_Generated with Grounds_');
                              window.open('https://wa.me/?text=' + t, '_blank');
                            }, 500);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-green-400/30 bg-green-500/10 hover:bg-green-500/20 text-[12px] text-green-400 transition-all"
                          title="Share via WhatsApp (downloads PDF)"
                        >
                          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          WA
                        </button>
                        <button
                          onClick={async () => {
                            const filename = `Decision-Report-${(title || 'Analysis').replace(/[^a-zA-Z0-9]/g, '-')}.pdf`;
                            // Try Web Share API with file (mobile)
                            if (navigator.share && navigator.canShare) {
                              try {
                                const response = await fetch(previewModal.url);
                                const blob = await response.blob();
                                const file = new File([blob], filename, { type: 'application/pdf' });
                                if (navigator.canShare({ files: [file] })) {
                                  await navigator.share({
                                    title: 'Decision Report',
                                    text: '📊 Decision Report: ' + (title || 'Decision') + '\nGenerated with Grounds',
                                    files: [file]
                                  });
                                  return;
                                }
                              } catch (e) { console.log('Web Share failed'); }
                            }
                            // Fallback: Download then open Telegram
                            const a = document.createElement('a');
                            a.href = previewModal.url;
                            a.download = filename;
                            a.click();
                            setTimeout(() => {
                              const t = encodeURIComponent('📊 Decision Report\n📌 ' + (title || 'Decision') + '\n\n(PDF downloaded - please attach)\n\nGenerated with Grounds');
                              window.open('https://t.me/share/url?text=' + t, '_blank');
                            }, 500);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-[12px] text-sky-400 transition-all"
                          title="Share via Telegram (downloads PDF)"
                        >
                          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                          TG
                        </button>
                      </>
                    )}

                    {/* Close */}
                    <button
                      onClick={closePreviewModal}
                      className={cx(
                        "inline-flex items-center justify-center w-8 h-8 rounded-xl border transition-all",
                        previewTheme === "light"
                          ? "border-black/10 bg-black/5 hover:bg-black/10 text-slate-500 hover:text-slate-700"
                          : "border-white/10 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white/90"
                      )}
                      title="Close preview"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </header>

            {/* Preview content - FULL WIDTH iframe */}
            <main className="flex-1 w-full px-4 py-4">
              <div 
                className={cx(
                  "w-full h-full rounded-xl overflow-hidden border shadow-lg",
                  previewTheme === "light"
                    ? "border-black/10 bg-white"
                    : "border-white/10 bg-[#0d0e16]"
                )}
              >
                <iframe
                  id="preview-iframe"
                  src={previewModal.url}
                  className="w-full h-full border-0"
                  style={{
                    minHeight: "calc(100vh - 140px)",
                    background: previewTheme === "light" ? "#ffffff" : "#0b0c14",
                  }}
                  title={previewModal.kind === "pdf" ? "PDF Preview" : "HTML Preview"}
                  onLoad={() => {
                    // Apply theme to iframe after load
                    try {
                      const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement;
                      if (iframe?.contentDocument?.documentElement) {
                        iframe.contentDocument.documentElement.setAttribute("data-theme", previewTheme);
                        iframe.contentDocument.documentElement.style.colorScheme = previewTheme;
                      }
                    } catch {
                      // Cross-origin or PDF - ignore
                    }
                  }}
                />
              </div>
            </main>

            {/* Footer */}
            <footer className="px-4 pb-4">
              <div 
                className={cx(
                  "text-[11px] text-center",
                  previewTheme === "light" ? "text-slate-500" : "text-white/40"
                )}
              >
                {previewModal.kind === "pdf"
                  ? "Review first. Download or print if needed."
                  : "Review first. Download only if you want."}
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* Template Picker Modal */}
      {showTemplatePicker && (
        <TemplatePicker
          isOpen={showTemplatePicker}
          onClose={() => setShowTemplatePicker(false)}
          onSelect={handleTemplateSelect}
          onQuickUse={startFromTemplate}
          currentTheme={selectedTheme}
        />
      )}

      {/* Google Export Modal */}
      {showGoogleExport && (
        <GoogleExportModal
          title={title || "Decision Report"}
          content={{
            // Basic inputs
            summary: analysis?.readiness 
              ? `Readiness: ${analysis.readiness.score}/100 (Grade ${analysis.readiness.grade})` 
              : undefined,
            context: context,
            intent: intent,
            options: input.options,
            assumptions: input.assumptions,
            risks: input.risks,
            evidence: input.evidence,
            outcome: outcome,
            
            // Analysis scores
            analysis: {
              readiness: analysis?.readiness,
              halfLife: analysis?.halfLife,
              blindSpots: analysis?.blindSpots,
              completeness: textSignals?.completeness,
              actionability: textSignals?.actionability,
            },
            
            // Gemini Critic results
            geminiCritic: geminiCritic ? {
              hardEdgesMissing: geminiCritic.hardEdgesMissing,
              genericLanguage: geminiCritic.genericLanguage,
              blindSpots: geminiCritic.blindSpots,
              nextActions: geminiCritic.nextActions,
              clarificationQuestions: geminiCritic.clarificationQuestions,
            } : undefined,
            
            // Sentiment Analysis
            sentiment: sentimentData ? {
              overall: sentimentData.overallSentiment,
              overallConfidence: sentimentData.overallConfidence,
              aspects: sentimentData.aspects,
            } : undefined,
            
            // Executive Conclusion
            conclusion: conclusionData ? {
              summary: conclusionData.summary,
              confidence: conclusionData.confidenceStatement,
              keyTakeaways: conclusionData.keyTakeaways,
              nextSteps: conclusionData.nextSteps,
              recommendation: conclusionData.recommendation,
              reviewDate: conclusionData.reviewDate,
            } : undefined,
            
            // Provider Compare results
            compare: compareResp ? {
              winner: winnerProvider || undefined,
              providers: Object.entries(compareResp).map(([key, val]: [string, any]) => ({
                name: key,
                score: val?.score || 0,
                latency: val?.latency || 0,
                model: val?.model || '',
                bestOption: val?.bestOption || '',
              })),
            } : undefined,
            
            // Monte Carlo (if available in radar data)
            monteCarlo: radarData ? {
              readiness: radarData.readiness,
              riskCoverage: radarData.riskCoverage,
              evidenceQuality: radarData.evidenceQuality,
              assumptionClarity: radarData.assumptionClarity,
              actionability: radarData.actionability,
              confidence: radarData.confidence,
            } : undefined,
            
            // Recommendations
            recommendations: textSignals?.nextFix?.map(f => f.title) || [],
          }}
          onClose={() => setShowGoogleExport(false)}
          onToast={(msg) => toast.show(msg)}
        />
      )}
    </div>
    </div>
  );
}