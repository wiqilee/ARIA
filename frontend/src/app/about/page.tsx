"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import Link from "next/link";
import { GridBackground } from "@/components/effects/GridBackground";
import { DataStream } from "@/components/effects/DataStream";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const FloatingParticles = dynamic(
  () => import("@/components/3d/FloatingParticles").then((m) => ({ default: m.FloatingParticles })),
  { ssr: false },
);

// ── Animated Section Wrapper ──────────────────────────────
function RevealSection({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Hover Glow Card ───────────────────────────────────────
function GlowCard({
  children,
  accentColor = "#06b6d4",
  className = "",
}: {
  children: React.ReactNode;
  accentColor?: string;
  className?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`relative rounded-2xl p-6 transition-all duration-500 cursor-default ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? `linear-gradient(135deg, ${accentColor}08, ${accentColor}04)`
          : "rgba(8, 20, 37, 0.5)",
        border: `1px solid ${hovered ? accentColor + "40" : "#1e3a5f"}`,
        boxShadow: hovered ? `0 0 40px ${accentColor}10, inset 0 0 40px ${accentColor}05` : "none",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      {/* Corner accent */}
      <div
        className="absolute top-0 left-0 w-12 h-12 transition-opacity duration-500"
        style={{
          opacity: hovered ? 1 : 0.3,
          background: `linear-gradient(135deg, ${accentColor}20, transparent)`,
          borderRadius: "16px 0 0 0",
        }}
      />
      {children}
    </div>
  );
}

// ── Feature Item with hover color ─────────────────────────
function FeatureItem({
  icon,
  title,
  description,
  color = "#06b6d4",
}: {
  icon: string;
  title: string;
  description: string;
  color?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group p-5 rounded-xl transition-all duration-400 cursor-default"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}08` : "rgba(8, 20, 37, 0.3)",
        border: `1px solid ${hovered ? color + "30" : "#1e3a5f40"}`,
      }}
    >
      <div
        className="text-2xl mb-3 transition-transform duration-300"
        style={{ transform: hovered ? "scale(1.15)" : "scale(1)" }}
      >
        {icon}
      </div>
      <h4
        className="font-display font-bold text-sm mb-2 transition-colors duration-300"
        style={{ color: hovered ? color : "#f1f5f9" }}
      >
        {title}
      </h4>
      <p className="text-text-secondary text-xs leading-relaxed">{description}</p>
    </div>
  );
}

// ── Step Card ─────────────────────────────────────────────
function StepCard({
  number,
  title,
  description,
  color = "#06b6d4",
}: {
  number: number;
  title: string;
  description: string;
  color?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative p-5 rounded-xl transition-all duration-400 cursor-default"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}08` : "rgba(8, 20, 37, 0.3)",
        border: `1px solid ${hovered ? color + "30" : "#1e3a5f40"}`,
      }}
    >
      <div
        className="font-display font-black text-4xl mb-3 transition-colors duration-300"
        style={{ color: hovered ? color : "#1e3a5f" }}
      >
        {String(number).padStart(2, "0")}
      </div>
      <h4
        className="font-display font-bold text-sm mb-2 transition-colors duration-300"
        style={{ color: hovered ? color : "#f1f5f9" }}
      >
        {title}
      </h4>
      <p className="text-text-secondary text-xs leading-relaxed">{description}</p>
    </div>
  );
}

// ── Social Link ───────────────────────────────────────────
function SocialLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(6, 182, 212, 0.08)" : "rgba(8, 20, 37, 0.4)",
        border: `1px solid ${hovered ? "#06b6d440" : "#1e3a5f"}`,
        transform: hovered ? "translateY(-1px)" : "none",
      }}
    >
      <span className="text-xl">{icon}</span>
      <span
        className="text-sm font-display font-medium transition-colors duration-300"
        style={{ color: hovered ? "#06b6d4" : "#94a3b8" }}
      >
        {label}
      </span>
    </a>
  );
}

// ════════════════════════════════════════════════════════════
// ABOUT PAGE
// ════════════════════════════════════════════════════════════

export default function AboutPage() {
  return (
    <>
      <GridBackground />
      <DataStream position="top-right" lines={4} />
      <DataStream position="bottom-left" lines={3} />

      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
        {/* 3D Background */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <Scene camera={{ position: [0, 0, 8], fov: 50 }}>
            <FloatingParticles count={120} spread={15} />
          </Scene>
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
          >
            <div
              className="inline-block px-4 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase mb-6"
              style={{
                border: "1px solid rgba(6, 182, 212, 0.3)",
                color: "#06b6d4",
                background: "rgba(6, 182, 212, 0.05)",
              }}
            >
              Healthcare AI · Polypharmacy · Clinical Reasoning
            </div>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="font-display font-black text-5xl sm:text-6xl lg:text-7xl mb-6"
            style={{
              filter: "drop-shadow(0 4px 12px rgba(0, 229, 255, 0.4)) drop-shadow(0 0 40px rgba(0, 229, 255, 0.2))",
            }}
          >
            <span className="text-gradient">ARIA</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-4"
          >
            <span className="font-bold text-gradient-health">Adaptive</span>{" "}
            <span className="font-bold text-gradient-health">Risk</span>{" "}
            <span className="font-bold text-gradient-health">Intelligence</span>{" "}
            <span className="text-text-secondary font-light">for</span>{" "}
            <span className="text-text-secondary font-light">Polypharmacy</span>{" "}
            <span className="font-bold text-gradient-health">Assessment</span>
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            className="text-text-muted text-sm max-w-xl mx-auto leading-relaxed mb-10"
          >
            An AI agent system that does not just detect drug interactions.
            It reasons about them.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex gap-4 justify-center"
          >
            <Link href="/analyze" className="btn-primary text-sm px-8 py-3">
              Try ARIA Now
            </Link>
            <a
              href="https://github.com/wiqilee/ARIA"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-sm px-8 py-3"
            >
              View on GitHub
            </a>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <div className="w-5 h-8 rounded-full border border-[#1e3a5f] flex items-start justify-center p-1.5">
            <div className="w-1 h-2 rounded-full bg-[#06b6d4]" />
          </div>
        </motion.div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        {/* ── The Problem ── */}
        <RevealSection className="mb-24">
          <GlowCard accentColor="#ef4444">
            <div className="flex items-start gap-3 mb-5">
              <span className="text-3xl">🚨</span>
              <div>
                <h2 className="font-display font-bold text-2xl text-gradient mb-2">
                  The Problem Nobody Has Solved
                </h2>
                <p
                  className="text-xs uppercase tracking-[0.2em] font-semibold"
                  style={{ color: "#f87171" }}
                >
                  A $42 billion global crisis
                </p>
              </div>
            </div>

            {/* Stat pills — visual anchors that make the numbers impossible
                to skim past. Each pill calls out one striking figure. */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatPill value="$42B" label="annual cost" color="#ef4444" />
              <StatPill value="59%" label="of frail elderly" color="#f59e0b" />
              <StatPill value="90%+" label="alerts overridden" color="#ef4444" />
            </div>

            <div
              className="space-y-4 text-[15px] leading-relaxed"
              style={{ color: "#d0daea" }}
            >
              <p>
                Medication errors cost the world an estimated{" "}
                <span style={{ color: "#ef4444", fontWeight: 700 }}>
                  $42 billion USD every year
                </span>
                . That is nearly 1% of total global health expenditure. Half of
                all preventable harm in medical care is medication-related.
              </p>
              <p>
                The driver is{" "}
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                  polypharmacy
                </span>
                : the simultaneous use of five or more medications. Global
                prevalence sits at 37% in the general population. It climbs to
                52% among inpatients and 59% among frail elderly patients.
              </p>
              <p>
                Existing tools are static lookup tables. They emit identical,
                context-free warnings for every patient. The result is
                predictable: clinicians override{" "}
                <span style={{ color: "#ef4444", fontWeight: 700 }}>
                  more than 90% of all drug interaction alerts
                </span>
                . The tools designed to protect patients have become background
                noise.
              </p>
            </div>
          </GlowCard>
        </RevealSection>

        {/* ── The Solution ── */}
        <RevealSection className="mb-24">
          <div className="text-center mb-10">
            <h2 className="font-display font-bold text-3xl text-gradient mb-3">
              What ARIA Does Differently
            </h2>
            <p className="text-text-muted text-sm max-w-lg mx-auto">
              Not a drug interaction checker. A clinical reasoning engine.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <RevealSection delay={0.05}>
              <FeatureItem
                icon="🕸️"
                title="N-Drug Interaction Graph"
                description="Full interaction graph with hub drug identification. Detects emergent 3-drug interactions invisible to pairwise checkers."
                color="#06b6d4"
              />
            </RevealSection>
            <RevealSection delay={0.1}>
              <FeatureItem
                icon="⏱️"
                title="Temporal Cascade Modeling"
                description="Models when an interaction peaks, not just whether it exists. Predicts critical intervention windows."
                color="#8b5cf6"
              />
            </RevealSection>
            <RevealSection delay={0.15}>
              <FeatureItem
                icon="👤"
                title="Patient Phenotype Risk"
                description="Personalized risk score adjusted for age, CKD stage, hepatic function, sex, weight, and smoking status."
                color="#f59e0b"
              />
            </RevealSection>
            <RevealSection delay={0.2}>
              <FeatureItem
                icon="💊"
                title="Deprescribing Optimizer"
                description="Prioritized, actionable plan: which drug to address first, what to substitute, expected risk reduction at each step."
                color="#10b981"
              />
            </RevealSection>
          </div>
        </RevealSection>

        {/* ── What Makes It Unique ── */}
        <RevealSection className="mb-24">
          <GlowCard accentColor="#8b5cf6">
            <h2 className="font-display font-bold text-2xl mb-6">
              <span style={{ color: "#8b5cf6" }}>8 Capabilities</span>{" "}
              <span className="text-gradient">That Don&apos;t Exist Anywhere Else</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { n: "Temporal Cascade Modeling", d: "Predicts when risk peaks over time" },
                { n: "Pharmacokinetic Reasoning", d: "CYP enzyme, renal, microbiome pathways via Gemini 2.5 Pro" },
                { n: "Patient Phenotype Multiplier", d: "Same drugs, different patients, different risk scores" },
                { n: "N-Drug Graph + Hub ID", d: "Beyond pairwise. Finds the one drug causing 60% of conflicts." },
                { n: "Evidence Grading", d: "A–D grades with confidence scores and PubMed citations" },
                { n: "Cumulative Burden Scores", d: "Anticholinergic, sedation, QT. Validated clinical metrics." },
                { n: "Deprescribing Optimizer", d: "Not a warning. A plan with substitutes and timelines." },
                { n: "Integrated Pipeline", d: "All 8 capabilities orchestrated into one coherent report" },
              ].map((item, i) => (
                <HoverRow key={i} title={item.n} description={item.d} index={i} />
              ))}
            </div>
          </GlowCard>
        </RevealSection>

        {/* ── How to Use ── */}
        <RevealSection className="mb-24">
          <div className="text-center mb-10">
            <h2 className="font-display font-bold text-3xl text-gradient mb-3">
              How It Works
            </h2>
            <p className="text-text-muted text-sm">Three steps to a clinical reasoning report</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            <RevealSection delay={0.05}>
              <StepCard
                number={1}
                title="Enter Medications"
                description="Input the patient's medication list and clinical context: age, CKD stage, hepatic function, comorbidities."
                color="#06b6d4"
              />
            </RevealSection>
            <RevealSection delay={0.15}>
              <StepCard
                number={2}
                title="AI Reasoning Pipeline"
                description="ARIA's agent orchestrates 8 tools: RxNorm normalization, interaction detection, phenotype scoring, temporal modeling, evidence grading, and more."
                color="#8b5cf6"
              />
            </RevealSection>
            <RevealSection delay={0.25}>
              <StepCard
                number={3}
                title="Actionable Report"
                description="Receive a 3D interactive clinical report with risk scores, deprescribing plans, evidence citations, and exportable PDF/HTML reports."
                color="#10b981"
              />
            </RevealSection>
          </div>
        </RevealSection>

        {/* ── Tech Stack ── */}
        <RevealSection className="mb-24">
          <GlowCard accentColor="#06b6d4">
            <h2 className="font-display font-bold text-xl mb-4" style={{ color: "#06b6d4" }}>
              Technology Stack
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              {[
                { l: "MCP Server", v: "Rust", c: "#f97316" },
                { l: "A2A Agent", v: "Python + LangGraph", c: "#3b82f6" },
                { l: "LLM", v: "Gemini 2.5 Pro", c: "#8b5cf6" },
                { l: "Frontend", v: "Next.js 14 + R3F", c: "#06b6d4" },
                { l: "3D", v: "React Three Fiber", c: "#10b981" },
                { l: "Deploy", v: "Cloud Run + Vercel", c: "#f59e0b" },
              ].map((t, i) => (
                <TechItem key={i} label={t.l} value={t.v} color={t.c} />
              ))}
            </div>
          </GlowCard>
        </RevealSection>

        {/* ── Builder ── */}
        <RevealSection className="mb-16">
          <div className="text-center mb-8">
            <h2 className="font-display font-bold text-3xl text-gradient mb-3">
              Built By
            </h2>
            <p style={{ color: "#94a8c8" }} className="text-sm">
              One engineer. Three weeks. Eight clinical capabilities.
            </p>
          </div>

          <div className="max-w-md mx-auto">
            <GlowCard accentColor="#06b6d4" className="text-center">
              {/* Solo-builder badge */}
              <div
                className="inline-block px-3 py-1 rounded-full text-[10px] uppercase mb-5"
                style={{
                  border: "1px solid rgba(139, 92, 246, 0.35)",
                  color: "#a78bfa",
                  background: "rgba(139, 92, 246, 0.08)",
                  letterSpacing: "0.18em",
                  fontFamily: "var(--font-mono, ui-monospace)",
                }}
              >
                Solo Builder · Hackathon Submission
              </div>

              {/* Avatar with multi-ring glow */}
              <div className="relative w-24 h-24 mx-auto mb-5">
                {/* Outer ring (slow rotation feel via shadow only) */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, #06b6d4, #8b5cf6)",
                    filter: "blur(10px)",
                    opacity: 0.4,
                  }}
                />
                {/* Inner avatar */}
                <div
                  className="relative w-24 h-24 rounded-full flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, #06b6d4, #8b5cf6)",
                    boxShadow:
                      "0 0 40px rgba(6, 182, 212, 0.35), inset 0 0 20px rgba(255, 255, 255, 0.12)",
                  }}
                >
                  <span className="text-4xl font-display font-black text-white drop-shadow-md">
                    W
                  </span>
                </div>
              </div>

              {/* Name */}
              <h3
                className="font-display font-bold text-2xl mb-1"
                style={{
                  color: "#f1f5f9",
                  letterSpacing: "-0.01em",
                }}
              >
                Wiqi Lee
              </h3>

              {/* Title roles, separated cleanly */}
              <p
                className="text-[11px] uppercase mb-5"
                style={{
                  color: "#94a8c8",
                  letterSpacing: "0.18em",
                  fontFamily: "var(--font-mono, ui-monospace)",
                }}
              >
                Data Scientist · AI/ML Researcher · Software Engineer
              </p>

              {/* Divider with accent dot */}
              <div className="flex items-center justify-center gap-2 mb-5">
                <span
                  className="h-px flex-1"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.35), transparent)",
                  }}
                />
                <span style={{ color: "#06b6d4", fontSize: "0.5rem" }}>◆</span>
                <span
                  className="h-px flex-1"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.35), transparent)",
                  }}
                />
              </div>

              {/* Quote / mission statement */}
              <p
                className="text-sm leading-relaxed italic mb-6"
                style={{ color: "#c4d0e4" }}
              >
                &ldquo;An agent that thinks like a clinical pharmacologist,
                not a database lookup.&rdquo;
              </p>

              {/* Social links as premium pills */}
              <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
                <SocialLink
                  href="https://twitter.com/wiqi_lee"
                  label="@wiqi_lee"
                  icon="𝕏"
                />
                <SocialLink
                  href="https://github.com/wiqilee/ARIA"
                  label="github.com/wiqilee/ARIA"
                  icon="⌥"
                />
              </div>
            </GlowCard>
          </div>
        </RevealSection>

        {/* ── Hackathon Badge ── */}
        <RevealSection>
          <div className="text-center">
            <p className="text-text-muted text-xs">
              Submitted to the{" "}
              <a
                href="https://agents-assemble.devpost.com"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors duration-300 hover:text-[#06b6d4]"
                style={{ color: "#94a3b8" }}
              >
                Agents Assemble: Healthcare AI Endgame Hackathon
              </a>
            </p>
            <p className="text-text-muted text-[10px] mt-1">
              Sponsored by Prompt Opinion (Darena Health)
            </p>
          </div>
        </RevealSection>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────

function HoverRow({ title, description, index }: { title: string; description: string; index: number }) {
  const [hovered, setHovered] = useState(false);
  const colors = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#f97316", "#3b82f6", "#ec4899"];
  const color = colors[index % colors.length];

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg transition-all duration-300 cursor-default"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}08` : "transparent",
        borderLeft: `2px solid ${hovered ? color : "#1e3a5f40"}`,
      }}
    >
      <div
        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 transition-all duration-300"
        style={{
          background: color,
          boxShadow: hovered ? `0 0 8px ${color}` : "none",
        }}
      />
      <div>
        <p
          className="text-sm font-semibold transition-colors duration-300"
          style={{ color: hovered ? color : "#f1f5f9" }}
        >
          {title}
        </p>
        <p className="text-text-muted text-xs">{description}</p>
      </div>
    </div>
  );
}

function TechItem({ label, value, color }: { label: string; value: string; color: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="p-3 rounded-lg transition-all duration-300 cursor-default"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}08` : "rgba(3, 11, 26, 0.3)",
        border: `1px solid ${hovered ? color + "30" : "#1e3a5f40"}`,
      }}
    >
      <div className="text-text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div
        className="font-mono text-sm font-semibold mt-1 transition-colors duration-300"
        style={{ color: hovered ? color : "#f1f5f9" }}
      >
        {value}
      </div>
    </div>
  );
}

/* Bold statistic shown in The Problem section.
   The visual job is to make the figures unmissable, so each pill is
   a self-contained block: oversized number, supporting label, accent
   border in the severity colour of the statistic. */
function StatPill({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="rounded-lg p-3 text-center transition-all duration-300"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? `${color}14` : `${color}08`,
        border: `1px solid ${hovered ? color + "66" : color + "33"}`,
        boxShadow: hovered ? `0 0 18px ${color}22` : "none",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <div
        className="font-display font-black text-2xl sm:text-3xl"
        style={{
          color,
          letterSpacing: "-0.02em",
          textShadow: `0 0 12px ${color}55`,
        }}
      >
        {value}
      </div>
      <div
        className="text-[10px] uppercase mt-1"
        style={{
          color: "#94a8c8",
          letterSpacing: "0.14em",
          fontFamily: "var(--font-mono, ui-monospace)",
        }}
      >
        {label}
      </div>
    </div>
  );
}
