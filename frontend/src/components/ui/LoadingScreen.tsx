"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);

/* Lazy-load the 3D helix to avoid SSR issues */
const LoaderHelix = dynamic(
  () => import("./LoaderHelix").then((m) => ({ default: m.LoaderHelix })),
  { ssr: false },
);

const PIPELINE_STEPS = [
  { label: "Parsing medication list", icon: "📥" },
  { label: "Normalizing drug names via RxNorm", icon: "🔤" },
  { label: "Building N-drug interaction graph", icon: "🕸" },
  { label: "Computing patient phenotype risk scores", icon: "👤" },
  { label: "Modeling temporal cascade timeline", icon: "⏱" },
  { label: "Grading evidence from PubMed", icon: "📚" },
  { label: "Generating deprescribing plan", icon: "💊" },
  { label: "Assembling clinical report", icon: "📄" },
];

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) =>
        prev < PIPELINE_STEPS.length - 1 ? prev + 1 : prev,
      );
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const progress = ((currentStep + 1) / PIPELINE_STEPS.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
      style={{ background: "var(--background)" }}
    >
      {/* 3D DNA Helix background */}
      <div className="absolute inset-0 z-0">
        <Scene camera={{ position: [0, 0, 5], fov: 50 }}>
          <LoaderHelix />
        </Scene>
      </div>

      {/* Radial vignette */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(3,11,26,0.2) 20%, var(--background) 65%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center max-w-md px-6 text-center">
        <p
          className="text-sm tracking-widest uppercase mb-8"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--primary)",
          }}
        >
          {message || "ARIA Analysis Pipeline"}
        </p>

        {/* Current step display */}
        <div className="mb-8 h-16 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-3"
            >
              <span className="text-2xl">
                {PIPELINE_STEPS[currentStep].icon}
              </span>
              <span className="text-sm text-text-secondary">
                {PIPELINE_STEPS[currentStep].label}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-sm">
          <div
            className="h-1 rounded-full overflow-hidden"
            style={{ background: "var(--primary-dim)" }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, var(--primary), var(--secondary))",
              }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <div className="flex justify-between mt-2">
            <span
              className="text-xs text-text-muted"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Step {currentStep + 1}/{PIPELINE_STEPS.length}
            </span>
            <span
              className="text-xs text-text-muted"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {Math.round(progress)}%
            </span>
          </div>
        </div>

        {/* Completed steps */}
        <div className="mt-6 space-y-1.5 w-full max-w-sm">
          {PIPELINE_STEPS.slice(0, currentStep).map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-xs"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-text-muted">{step.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
