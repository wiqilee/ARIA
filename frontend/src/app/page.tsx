"use client";

import { useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useScroll, useTransform } from "framer-motion";
import { GridBackground } from "@/components/effects/GridBackground";
import { ParticleField } from "@/components/effects/ParticleField";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const HeroBackground = dynamic(
  () =>
    import("@/components/3d/HeroBackground").then((m) => ({
      default: m.HeroBackground,
    })),
  { ssr: false },
);

const stats = [
  { value: "$42B", label: "Annual cost of medication errors worldwide", source: "WHO, 2024", url: "https://www.who.int/publications/i/item/9789240088887" },
  { value: "90%+", label: "Drug alerts overridden by clinicians globally", source: "Clinical Literature", url: "https://pubmed.ncbi.nlm.nih.gov/" },
  { value: "39%", label: "Adults 60+ taking five or more medications", source: "Wang et al., 2024", url: "https://pubmed.ncbi.nlm.nih.gov/39135518/" },
  { value: "52%", label: "Polypharmacy rate among hospital inpatients", source: "Kim et al., 2024", url: "https://pubmed.ncbi.nlm.nih.gov/38733922/" },
];

const capabilities = [
  { icon: "⏱", title: "Temporal Cascade Modeling", desc: "Predicts when an interaction will peak, not just whether it exists." },
  { icon: "🧬", title: "Mechanistic Reasoning", desc: "Explains interactions at the molecular level through CYP pathways and renal clearance." },
  { icon: "👤", title: "Patient Phenotype Scoring", desc: "Calculates personalized risk adjusted for age, kidney function, and clinical history." },
  { icon: "🕸", title: "N-Drug Interaction Graph", desc: "Detects emergent three-drug interactions that pairwise checkers miss entirely." },
  { icon: "📊", title: "Evidence Grading", desc: "Tags every alert with a confidence score and links to PubMed citations." },
  { icon: "💊", title: "Deprescribing Optimizer", desc: "Generates a prioritized plan with substitutions and expected risk reduction at each step." },
];

/* ── Animated 3D-style ARIA Title — MORE 3D & PREMIUM ── */
function AnimatedAriaTitle() {
  const letters = ["A", "R", "I", "A"];
  const gradients = [
    "linear-gradient(135deg, #00e5ff 0%, #38bdf8 50%, #0ea5e9 100%)",
    "linear-gradient(135deg, #38bdf8 0%, #7c4dff 50%, #6d28d9 100%)",
    "linear-gradient(135deg, #7c4dff 0%, #00bfa5 50%, #14b8a6 100%)",
    "linear-gradient(135deg, #00bfa5 0%, #00e5ff 50%, #22d3ee 100%)",
  ];

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-3 select-none perspective-[800px]">
      {letters.map((letter, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 70, rotateX: -90, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{
            duration: 0.9,
            delay: 0.3 + i * 0.1,
            ease: [0.22, 1, 0.36, 1],
          }}
          whileHover={{
            scale: 1.15,
            rotateY: 15,
            rotateX: -5,
            filter: "drop-shadow(0 0 50px rgba(0, 229, 255, 0.8))",
            transition: { duration: 0.25 },
          }}
          style={{
            display: "inline-block",
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: "clamp(4rem, 12vw, 9rem)",
            lineHeight: 1,
            background: gradients[i],
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            filter: "drop-shadow(0 4px 12px rgba(0, 229, 255, 0.4)) drop-shadow(0 0 40px rgba(0, 229, 255, 0.2))",
            textShadow: "none",
            cursor: "default",
            transformStyle: "preserve-3d" as any,
          }}
        >
          {letter}
        </motion.span>
      ))}
    </div>
  );
}

/* ── Animated Subtitle — acronym letters highlighted ── */
function AnimatedSubtitle() {
  const words: { text: string; isAcronym: boolean }[] = [
    { text: "Adaptive", isAcronym: true },
    { text: "Risk", isAcronym: true },
    { text: "Intelligence", isAcronym: true },
    { text: "for", isAcronym: false },
    { text: "Polypharmacy", isAcronym: false },
    { text: "Assessment", isAcronym: true },
  ];

  return (
    <motion.div
      className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.07, delayChildren: 0.9 } },
      }}
    >
      {words.map((word, i) => (
        <motion.span
          key={i}
          variants={{
            hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
            visible: { opacity: 1, y: 0, filter: "blur(0px)" },
          }}
          transition={{ duration: 0.5 }}
          className={`text-lg sm:text-xl md:text-2xl tracking-wide ${
            word.isAcronym
              ? "font-bold text-gradient-health"
              : "text-text-secondary font-light"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
        >
          {word.text}
        </motion.span>
      ))}
    </motion.div>
  );
}

export default function HomePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.2], [1, 0.96]);

  return (
    <div ref={containerRef} className="relative">
      <GridBackground />
      <ParticleField count={35} />

      {/* ═══ Hero ═══ */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden"
      >
        {/* 3D Background — molecules, DNA helix, particles */}
        <div className="absolute inset-0 z-0" style={{ height: "100vh" }}>
          <Scene camera={{ position: [0, 0, 8], fov: 55 }}>
            <HeroBackground />
          </Scene>
        </div>

        {/* Radial vignette */}
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 25%, var(--background) 75%)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
          {/* Floating medical cross */}
          <motion.div
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mb-8"
            style={{ animation: "float 4s ease-in-out infinite" }}
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(0,229,255,0.12), rgba(124,77,255,0.12))",
                border: "1px solid var(--border-glow)",
                boxShadow: "var(--glow-cyan)",
              }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00e5ff"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
          </motion.div>

          {/* 3D Animated ARIA title */}
          <AnimatedAriaTitle />

          {/* Animated acronym subtitle */}
          <div className="mt-6 mb-8">
            <AnimatedSubtitle />
          </div>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.4 }}
            className="text-text-secondary text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-10"
          >
            An AI agent system that goes beyond detecting drug interactions. It
            reasons through temporal modeling, mechanistic explanation,
            personalized risk scoring, and actionable deprescribing, all within
            a single integrated pipeline.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.7 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Link href="/analyze">
              <button className="btn-primary">Start Analysis</button>
            </Link>
            <a
              href="https://github.com/wiqi-lee/ARIA"
              target="_blank"
              rel="noopener noreferrer"
            >
              <button className="btn-secondary">View on GitHub</button>
            </a>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            className="w-6 h-10 rounded-full border border-[var(--border-glow)] flex items-start justify-center pt-2"
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "var(--primary)",
                boxShadow: "0 0 8px var(--primary)",
              }}
            />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ═══ Stats — CLICKABLE with source links ═══ */}
      <section className="relative py-28 px-6 grid-bg">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.1 } },
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
          >
            {stats.map((stat, i) => (
              <motion.a
                key={i}
                href={stat.url}
                target="_blank"
                rel="noopener noreferrer"
                variants={{
                  hidden: { opacity: 0, y: 30 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.5 }}
                className="rounded-xl bg-surface/60 glow-border p-6 text-center block cursor-pointer"
                style={{ textDecoration: "none" }}
              >
                <p
                  className="text-3xl sm:text-4xl font-bold mb-3 text-gradient"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {stat.value}
                </p>
                <p className="text-sm text-text-secondary leading-relaxed mb-2">
                  {stat.label}
                </p>
                <p
                  className="text-[10px] text-text-muted tracking-wider flex items-center justify-center gap-1"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {stat.source}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </p>
              </motion.a>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ Capabilities — titles in BLUE matching "Eight Capabilities" ═══ */}
      <section className="relative py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2
              className="text-3xl sm:text-4xl font-bold text-gradient mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Eight Capabilities
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto">
              Clinical reasoning features that do not exist in any other tool
              available today.
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08 } },
            }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {capabilities.map((cap, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="rounded-xl bg-surface/50 glow-border p-6 group"
              >
                <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">
                  {cap.icon}
                </div>
                <h3
                  className="font-display font-semibold text-[0.95rem] mb-2"
                  style={{ color: "#00e5ff" }}
                >
                  {cap.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  {cap.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative py-28 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-panel p-12"
          >
            <h2
              className="text-2xl sm:text-3xl font-bold mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="text-gradient">Ready to Analyze?</span>
            </h2>
            <p className="text-text-secondary mb-8 max-w-lg mx-auto">
              Enter a medication list and patient context. ARIA will reason
              through every interaction, calculate personalized risk, and
              generate a structured clinical report.
            </p>
            <Link href="/analyze">
              <button className="btn-primary">Start Analysis</button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="py-8 px-6 border-t border-[var(--border)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-muted">
          <p style={{ fontFamily: "var(--font-mono)" }}>
            ARIA &copy; {new Date().getFullYear()}
          </p>
          <p>
            Built with Rust, Python, Gemini 2.5 Pro, and React Three Fiber
          </p>
        </div>
      </footer>
    </div>
  );
}
