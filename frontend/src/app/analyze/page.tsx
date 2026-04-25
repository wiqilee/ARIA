"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { PatientForm } from "@/components/forms/PatientForm";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { GridBackground } from "@/components/effects/GridBackground";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/types";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const FloatingParticles = dynamic(
  () =>
    import("@/components/3d/FloatingParticles").then((m) => ({
      default: m.FloatingParticles,
    })),
  { ssr: false },
);

export default function AnalyzePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (request: AnalyzeRequest) => {
    setIsLoading(true);
    setError(null);

    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Analysis failed (${resp.status}): ${body}`);
      }

      const data: AnalyzeResponse = await resp.json();
      sessionStorage.setItem("aria-result", JSON.stringify(data));
      sessionStorage.setItem("aria-request", JSON.stringify(request));
      router.push("/report");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setIsLoading(false);
    }
  };

  return (
    <>
      <GridBackground />

      {/* Ambient 3D particle background */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-35">
        <Scene camera={{ position: [0, 0, 6], fov: 60 }}>
          <FloatingParticles count={120} spread={14} size={0.018} />
        </Scene>
      </div>

      <AnimatePresence>
        {isLoading && <LoadingScreen message="Running ARIA pipeline..." />}
      </AnimatePresence>

      <div className="relative z-10 min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            {/* Status badge */}
            <div
              className="inline-flex items-center gap-2 mb-5 px-4 py-1.5 rounded-full"
              style={{
                background: "var(--primary-dim)",
                border: "1px solid rgba(0, 229, 255, 0.15)",
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  background: "var(--primary)",
                  animation: "pulseGlow 2s ease-in-out infinite",
                }}
              />
              <span
                className="text-xs font-medium tracking-wider uppercase"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--primary)",
                }}
              >
                Clinical Analysis
              </span>
            </div>

            <motion.h1
              className="font-display font-bold text-3xl sm:text-4xl mb-3"
              style={{
                background: "linear-gradient(135deg, #00e5ff 0%, #38bdf8 40%, #7c4dff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 4px 12px rgba(0, 229, 255, 0.35)) drop-shadow(0 0 30px rgba(0, 229, 255, 0.15))",
              }}
              whileHover={{
                filter: "drop-shadow(0 4px 16px rgba(0, 229, 255, 0.5)) drop-shadow(0 0 40px rgba(0, 229, 255, 0.25))",
                scale: 1.02,
              }}
              transition={{ duration: 0.3 }}
            >
              Polypharmacy Analysis
            </motion.h1>
            <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
              Enter medications and clinical context. ARIA will build an
              interaction graph, compute personalized risk, model temporal
              cascades, and generate a deprescribing plan.
            </p>
          </motion.div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 p-4 rounded-xl"
                style={{
                  background: "rgba(255, 23, 68, 0.06)",
                  border: "1px solid rgba(255, 23, 68, 0.15)",
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg" style={{ color: "var(--danger)" }}>
                    ⚠
                  </span>
                  <div className="flex-1">
                    <h3
                      className="font-display font-semibold text-sm mb-1"
                      style={{ color: "var(--danger)" }}
                    >
                      Analysis Failed
                    </h3>
                    <p className="text-text-secondary text-sm">{error}</p>
                    <button
                      onClick={() => setError(null)}
                      className="mt-2 text-xs underline"
                      style={{ color: "var(--danger)" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="glass-panel p-6 sm:p-8"
          >
            <PatientForm onSubmit={handleSubmit} isLoading={isLoading} />
          </motion.div>

          {/* Sample profiles */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-8 text-center"
          >
            <p className="text-text-muted text-xs mb-3">
              Quick test with synthetic profiles:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLE_PROFILES.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handleSubmit(p.request)}
                  disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all disabled:opacity-50 glow-border"
                  style={{
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
}

const SAMPLE_PROFILES: { label: string; request: AnalyzeRequest }[] = [
  {
    label: "72F CKD3 — 6 drugs",
    request: {
      medications: [
        "warfarin",
        "aspirin",
        "omeprazole",
        "amlodipine",
        "furosemide",
        "digoxin",
      ],
      patient: {
        age: 72,
        sex: "female",
        weight_kg: 58,
        height_cm: 155,
        ckd_stage: 3,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "none",
        comorbidities: ["hypertension", "atrial fibrillation", "heart failure"],
        allergies: [],
      },
    },
  },
  {
    label: "81M Poly — 8 drugs",
    request: {
      medications: [
        "warfarin",
        "aspirin",
        "fish oil",
        "simvastatin",
        "metoprolol",
        "lisinopril",
        "metformin",
        "gabapentin",
      ],
      patient: {
        age: 81,
        sex: "male",
        weight_kg: 72,
        height_cm: 170,
        ckd_stage: 2,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "occasional",
        comorbidities: [
          "type 2 diabetes",
          "hypertension",
          "atrial fibrillation",
          "peripheral neuropathy",
        ],
        allergies: ["penicillin"],
      },
    },
  },
  {
    label: "65F Anticholinergic",
    request: {
      medications: [
        "amitriptyline",
        "diphenhydramine",
        "oxybutynin",
        "quetiapine",
        "sertraline",
      ],
      patient: {
        age: 65,
        sex: "female",
        weight_kg: 70,
        height_cm: 163,
        ckd_stage: 0,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "none",
        comorbidities: ["depression", "insomnia", "overactive bladder"],
        allergies: [],
      },
    },
  },
];
