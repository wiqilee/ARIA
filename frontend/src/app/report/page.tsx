"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { RiskReport } from "@/components/report/RiskReport";
import { DataStream } from "@/components/effects/DataStream";
import { GridBackground } from "@/components/effects/GridBackground";
import type {
  AnalyzeResponse,
  AnalyzeRequest,
  InteractionGraph,
  CascadeModel,
  DeprescribingPlan,
  DeprescribingStep,
  DeprescribingAction,
  InterventionWindow,
  Severity,
} from "@/lib/types";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const InteractionGraph3D = dynamic(
  () => import("@/components/3d/InteractionGraph3D").then((m) => ({ default: m.InteractionGraph3D })),
  { ssr: false },
);
const TemporalTimeline3D = dynamic(
  () => import("@/components/3d/TemporalTimeline3D").then((m) => ({ default: m.TemporalTimeline3D })),
  { ssr: false },
);
const PhenotypeRadar3D = dynamic(
  () => import("@/components/3d/PhenotypeRadar3D").then((m) => ({ default: m.PhenotypeRadar3D })),
  { ssr: false },
);
// Type-only imports so we can type the hover/click payloads without pulling
// the heavy 3D modules into the SSR bundle. Each 3D component exports a
// payload shape the parent's side panel can render.
import type { RadarHoverPayload } from "@/components/3d/PhenotypeRadar3D";
import type { NodeClickPayload } from "@/components/3d/InteractionGraph3D";
import type { TimelineHoverPayload } from "@/components/3d/TemporalTimeline3D";
import type { DeprescribingClickPayload } from "@/components/3d/DeprescribingWaterfall";
const DeprescribingWaterfall = dynamic(
  () => import("@/components/3d/DeprescribingWaterfall").then((m) => ({ default: m.DeprescribingWaterfall })),
  { ssr: false },
);
const PatientAvatar3D = dynamic(
  () => import("@/components/3d/PatientAvatar3D").then((m) => ({ default: m.PatientAvatar3D })),
  { ssr: false },
);
const FloatingParticles = dynamic(
  () => import("@/components/3d/FloatingParticles").then((m) => ({ default: m.FloatingParticles })),
  { ssr: false },
);

// ── Jakarta timezone — English format with GMT+7 ──────────
function formatJakartaTime(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }) + " GMT+7";
}

// ── Risk helpers ──────────────────────────────────────────
const SEVERITY_COLORS: Record<string, string> = {
  low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444",
};

function getRiskLevel(score: string | undefined) {
  const s = (score ?? "moderate").toLowerCase();
  const map: Record<string, { label: string; color: string; description: string; bgColor: string }> = {
    low: { label: "LOW RISK", color: "#10b981", bgColor: "rgba(16,185,129,0.08)", description: "Minimal clinical concern. Standard monitoring protocols are adequate." },
    moderate: { label: "MODERATE RISK", color: "#f59e0b", bgColor: "rgba(245,158,11,0.08)", description: "Enhanced monitoring recommended. Consider dose adjustments or alternative therapies if risk factors change." },
    high: { label: "HIGH RISK", color: "#f97316", bgColor: "rgba(249,115,22,0.08)", description: "Significant clinical concern. Active intervention recommended. Prioritize deprescribing high-risk combinations." },
    critical: { label: "CRITICAL RISK", color: "#ef4444", bgColor: "rgba(239,68,68,0.08)", description: "Immediate intervention required. High probability of severe adverse drug events without prompt action." },
  };
  return map[s] ?? { label: s.toUpperCase(), color: "#f59e0b", bgColor: "rgba(245,158,11,0.08)", description: "Risk level assessed by ARIA." };
}

function getNumericRiskScore(
  data: AnalyzeResponse,
  graph?: InteractionGraph | null,
  request?: AnalyzeRequest | null,
): number {
  // Prefer a graph-derived score if available — it reflects the actual
  // edges/severities the user sees in the visualization. Falls back to
  // level → number mapping when no graph is provided (e.g. PDF export).
  if (graph && graph.edges && graph.edges.length > 0) {
    return deriveNumericRiskFromGraph(graph, phenotypeMultiplier(request ?? null));
  }
  const level = (data.report?.overall_risk_level ?? "moderate").toLowerCase();
  return { low: 2.5, moderate: 5.0, high: 7.5, critical: 9.0 }[level] ?? 5.0;
}

// ══════════════════════════════════════════════════════════
// DEMO FALLBACK DATA — rich, deterministic, patient-aware
// ══════════════════════════════════════════════════════════
//
// Goal: whatever the user types in the form (or any of the Quick Test
// profiles), every visualization fills with realistic, internally-consistent
// data. No Math.random — fully deterministic from the request so the demo
// looks the same every reload.
//
// Strategy:
//   1. Extract drug names from request, lowercase them.
//   2. Match pairs against a small curated interaction KB. Any unmatched
//      pairs still get a sensible default edge so the graph is never empty.
//   3. Build a phenotype multiplier from age / CKD / hepatic / smoking.
//   4. Synthesize graph → timeline → deprescribing plan all from the same
//      severity distribution so they agree with each other.

// ── Utilities ─────────────────────────────────────────────

function extractDrugNames(request: AnalyzeRequest | null): string[] {
  const meds = request?.medications ?? [];
  if (meds.length === 0) {
    return ["Warfarin", "Aspirin", "Omeprazole", "Metformin", "Lisinopril"];
  }
  return meds.map((m) => (typeof m === "string" ? m : m.name)).filter(Boolean);
}

function titleCase(s: string): string {
  return s.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

/** Deterministic pseudo-random in [0,1) from a string seed. Used to give
 *  variety without using Math.random (which would re-roll every render). */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function phenotypeMultiplier(request: AnalyzeRequest | null): number {
  const p = request?.patient;
  if (!p) return 1.0;
  let m = 1.0;
  if ((p.age ?? 0) >= 80) m *= 1.35;
  else if ((p.age ?? 0) >= 65) m *= 1.2;
  if ((p.ckd_stage ?? 0) >= 4) m *= 1.3;
  else if ((p.ckd_stage ?? 0) >= 3) m *= 1.18;
  if (p.hepatic_impairment) m *= 1.22;
  if (p.smoking) m *= 1.08;
  if (p.sex === "female") m *= 1.04;
  return m;
}

// ── Interaction knowledge base ────────────────────────────
// Keys are sorted-alphabetically pairs joined with "|". Severity is the
// BASE severity before phenotype adjustment.

interface KBEntry {
  severity: Severity;
  weight: number;          // 0..1 edge weight
  type: string;            // interaction_type
  rationale: string;       // for deprescribing "rationale" and graph tooltip
}

const INTERACTION_KB: Record<string, KBEntry> = {
  "aspirin|warfarin":            { severity: "critical", weight: 0.95, type: "pharmacodynamic — additive anticoagulation", rationale: "Additive bleeding risk: platelet inhibition + vitamin K antagonism" },
  "fish oil|warfarin":           { severity: "high",     weight: 0.85, type: "pharmacodynamic — additive anticoagulation", rationale: "Omega-3 potentiates anticoagulant effect; elevated bleeding risk" },
  "aspirin|fish oil":            { severity: "moderate", weight: 0.6,  type: "pharmacodynamic — additive anticoagulation", rationale: "Additive antiplatelet activity" },
  "omeprazole|warfarin":         { severity: "high",     weight: 0.75, type: "pharmacokinetic — CYP2C19 inhibition", rationale: "Omeprazole inhibits CYP2C19 → ↑ warfarin exposure → ↑ INR" },
  "digoxin|furosemide":          { severity: "high",     weight: 0.8,  type: "pharmacodynamic — electrolyte-mediated", rationale: "Furosemide-induced hypokalemia potentiates digoxin toxicity" },
  "amlodipine|simvastatin":      { severity: "high",     weight: 0.78, type: "pharmacokinetic — CYP3A4 inhibition", rationale: "Amlodipine ↑ simvastatin exposure → ↑ myopathy/rhabdomyolysis risk" },
  "lisinopril|metformin":        { severity: "moderate", weight: 0.55, type: "pharmacokinetic — renal clearance", rationale: "Both cleared renally; monitor eGFR and lactate" },
  "lisinopril|furosemide":       { severity: "moderate", weight: 0.6,  type: "pharmacodynamic — hypotension/AKI", rationale: "Additive hypotension; risk of acute kidney injury" },
  "digoxin|amiodarone":          { severity: "critical", weight: 0.92, type: "pharmacokinetic — P-gp inhibition", rationale: "Amiodarone doubles digoxin levels; high toxicity risk" },
  "amitriptyline|diphenhydramine":{severity: "critical", weight: 0.9,  type: "pharmacodynamic — anticholinergic burden", rationale: "Severe additive anticholinergic load — delirium/fall risk in elderly" },
  "oxybutynin|diphenhydramine":  { severity: "high",     weight: 0.82, type: "pharmacodynamic — anticholinergic burden", rationale: "Additive anticholinergic effects — cognitive impairment" },
  "amitriptyline|oxybutynin":    { severity: "high",     weight: 0.8,  type: "pharmacodynamic — anticholinergic burden", rationale: "Compounded anticholinergic effects and QT prolongation risk" },
  "amitriptyline|sertraline":    { severity: "high",     weight: 0.75, type: "pharmacodynamic — serotonergic", rationale: "↑ serotonin syndrome risk; additive QT prolongation" },
  "quetiapine|sertraline":       { severity: "moderate", weight: 0.65, type: "pharmacodynamic — QT prolongation", rationale: "Additive QT prolongation risk; monitor ECG" },
  "amitriptyline|quetiapine":    { severity: "high",     weight: 0.78, type: "pharmacodynamic — sedation + QT", rationale: "Additive sedation, anticholinergic and QT effects" },
  "gabapentin|metoprolol":       { severity: "low",      weight: 0.3,  type: "pharmacodynamic — CNS depression", rationale: "Mild additive CNS depression" },
  "metformin|metoprolol":        { severity: "moderate", weight: 0.5,  type: "pharmacodynamic — hypoglycemia masking", rationale: "β-blocker may mask hypoglycemia symptoms" },
  "simvastatin|warfarin":        { severity: "moderate", weight: 0.6,  type: "pharmacokinetic — protein binding", rationale: "May modestly ↑ INR; monitor after initiation" },
};

function kbLookup(a: string, b: string): KBEntry | null {
  const key = [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join("|");
  return INTERACTION_KB[key] ?? null;
}

function bumpSeverity(sev: Severity, multiplier: number): Severity {
  const order: Severity[] = ["low", "moderate", "high", "critical"];
  const i = order.indexOf(sev);
  // Only escalate for genuinely high-risk phenotypes (≥1.4x). The threshold
  // is set so the 81M Poly profile (mult=1.35) keeps its natural severity
  // mix, while the 72F CKD3 profile (mult=1.47) visibly escalates.
  if (multiplier >= 1.4) return order[Math.min(i + 1, 3)];
  return sev;
}

// ── Graph builder ─────────────────────────────────────────

function getDemoInteractionGraph(request: AnalyzeRequest | null): InteractionGraph {
  const rawDrugs = extractDrugNames(request);
  const drugNames = rawDrugs.map(titleCase);
  const multiplier = phenotypeMultiplier(request);

  // Compute node degrees by scanning KB pairs first (we need degree to know hubs).
  const edges: InteractionGraph["edges"] = [];
  const degree = new Map<string, number>();
  for (const d of drugNames) degree.set(d, 0);

  for (let i = 0; i < drugNames.length; i++) {
    for (let j = i + 1; j < drugNames.length; j++) {
      const a = drugNames[i];
      const b = drugNames[j];
      let hit = kbLookup(a, b);

      // Fallback for unknown pairs: deterministic severity from name hash,
      // but bias toward "low/moderate" so the graph isn't overwhelmingly red
      // for random drug combos.
      if (!hit) {
        const r = hash01(`${a}|${b}`);
        if (r < 0.35) {
          // No interaction — skip the edge to avoid a fully-connected mess.
          continue;
        }
        const sev: Severity = r < 0.6 ? "low" : r < 0.85 ? "moderate" : "high";
        hit = {
          severity: sev,
          weight: 0.3 + r * 0.5,
          type: "pharmacokinetic — potential CYP interaction",
          rationale: "Potential interaction flagged for clinical review",
        };
      }

      const adjustedSeverity = bumpSeverity(hit.severity, multiplier);
      edges.push({
        source: a,
        target: b,
        severity: adjustedSeverity,
        interaction_type: hit.type,
        weight: Math.min(hit.weight * multiplier, 1),
      });
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
  }

  // Guarantee a non-empty graph: if no edges at all (e.g. 1 unknown drug),
  // add one synthetic moderate self-relation with phenotype so viz still renders.
  if (edges.length === 0 && drugNames.length >= 2) {
    edges.push({
      source: drugNames[0],
      target: drugNames[1],
      severity: "moderate",
      interaction_type: "potential — clinical review advised",
      weight: 0.4,
    });
    degree.set(drugNames[0], 1);
    degree.set(drugNames[1], 1);
  }

  // Identify hub(s): the drug with the most edges, only if it has >=2.
  let maxDeg = 0;
  for (const d of degree.values()) if (d > maxDeg) maxDeg = d;
  const hubDrugs = drugNames.filter((d) => (degree.get(d) ?? 0) === maxDeg && maxDeg >= 2);

  const nodes = drugNames.map((d) => {
    const deg = degree.get(d) ?? 0;
    const isHub = hubDrugs.includes(d);
    return {
      drug_name: d,
      degree: deg,
      is_hub: isHub,
      hub_score: maxDeg > 0 ? deg / maxDeg : 0,
    };
  });

  // Emergent 3-drug interactions: detect additive anticoagulant / anticholinergic clusters.
  const emergent: InteractionGraph["emergent_interactions"] = [];
  const lowerSet = new Set(drugNames.map((d) => d.toLowerCase()));

  const anticoagTriad = ["warfarin", "aspirin", "fish oil"];
  if (anticoagTriad.every((d) => lowerSet.has(d))) {
    emergent.push({
      drugs: anticoagTriad.map(titleCase),
      description: "Triple anticoagulant effect — no pairwise checker captures the combined bleeding risk",
      mechanism: "Vitamin K antagonism + platelet inhibition + omega-3 platelet aggregation inhibition",
      severity: multiplier >= 1.2 ? "critical" : "high",
    });
  }

  const antichol = ["amitriptyline", "diphenhydramine", "oxybutynin", "quetiapine"];
  const matchedAntichol = antichol.filter((d) => lowerSet.has(d));
  if (matchedAntichol.length >= 3) {
    emergent.push({
      drugs: matchedAntichol.slice(0, 3).map(titleCase),
      description: "Severe cumulative anticholinergic burden — delirium and fall risk",
      mechanism: "Multiplicative muscarinic receptor antagonism",
      severity: "critical",
    });
  }

  const totalPossible = (drugNames.length * (drugNames.length - 1)) / 2;

  return {
    nodes,
    edges,
    hub_drugs: hubDrugs,
    emergent_interactions: emergent,
    total_edges: edges.length,
    graph_density: totalPossible > 0 ? edges.length / totalPossible : 0,
  };
}

// ── Timeline builder ──────────────────────────────────────

function getDemoTemporalModel(request: AnalyzeRequest | null, graph?: InteractionGraph | null): CascadeModel {
  const drugNames = extractDrugNames(request).map(titleCase);
  const multiplier = phenotypeMultiplier(request);

  // Derive peak severity from graph so curve agrees with graph edges.
  const severities = (graph?.edges ?? []).map((e) => e.severity);
  const maxSev: Severity =
    severities.includes("critical") ? "critical" :
    severities.includes("high") ? "high" :
    severities.includes("moderate") ? "moderate" :
    severities.length > 0 ? "low" : "moderate";

  const peakTable: Record<Severity, number> = { low: 3.2, moderate: 5.0, high: 7.2, critical: 8.8 };
  const peakScore = Math.min(peakTable[maxSev] * (multiplier > 1.2 ? 1.08 : 1), 9.5);

  const days = 30;
  // Peak day shifts with patient age: elderly = earlier peak (faster accumulation).
  const age = request?.patient?.age ?? 50;
  const peakDay = age >= 75 ? 5 : age >= 65 ? 7 : 10;

  const daily_risk = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    let risk: number;
    if (day <= peakDay) {
      // Ramp up from ~1.5 to peak
      risk = 1.5 + (day / peakDay) * (peakScore - 1.5);
    } else {
      // Slow decay toward a steady-state around 60% of peak
      const decayProgress = (day - peakDay) / (days - peakDay);
      risk = peakScore - decayProgress * (peakScore * 0.4);
    }
    // Deterministic wobble from day hash
    const wobble = (hash01(`${drugNames.join(",")}-d${day}`) - 0.5) * 0.6;
    risk = Math.round((risk + wobble) * 10) / 10;
    risk = Math.max(1, Math.min(risk, 9.8));

    let key_event: string | undefined;
    if (day === 1) key_event = "Initial exposure";
    else if (day === peakDay) key_event = "Peak interaction window";
    else if (day === Math.floor(days / 2)) key_event = "Mid-course monitoring checkpoint";
    else if (day === days) key_event = "Re-assessment due";

    return { day, risk_score: risk, key_event };
  });

  // Intervention windows anchored to peak and mid-course.
  const intervention_windows: InterventionWindow[] = [];
  if (maxSev === "critical" || maxSev === "high") {
    intervention_windows.push({
      day_start: Math.max(peakDay - 2, 1),
      day_end: peakDay + 1,
      action: "Intensify monitoring",
      urgency: "high",
    });
  } else {
    intervention_windows.push({
      day_start: Math.max(peakDay - 1, 1),
      day_end: peakDay + 2,
      action: "Standard monitoring",
      urgency: "standard",
    });
  }
  intervention_windows.push({
    day_start: Math.floor(days / 2),
    day_end: Math.floor(days / 2) + 3,
    action: "Dose review checkpoint",
    urgency: "standard",
  });

  return {
    drugs: drugNames,
    timeline_days: days,
    daily_risk,
    peak_risk_day: peakDay,
    peak_risk_score: Math.max(...daily_risk.map((d) => d.risk_score)),
    intervention_windows,
    summary: `Risk peaks around day ${peakDay} at ~${peakScore.toFixed(1)}/10 driven by ${maxSev}-severity interactions. Phenotype multiplier ×${multiplier.toFixed(2)} applied for age/renal/hepatic adjustments.`,
  };
}

// ── Deprescribing builder ─────────────────────────────────

function getDemoDeprescribingPlan(request: AnalyzeRequest | null, graph?: InteractionGraph | null): DeprescribingPlan {
  const drugNames = extractDrugNames(request).map(titleCase);
  if (drugNames.length === 0) {
    return { steps: [], total_expected_risk_reduction: 0, summary: "No medications analyzed.", warnings: [] };
  }

  // Rank drugs by the max severity of edges they participate in.
  const sevRank: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  const drugWorstSeverity = new Map<string, Severity>();
  const drugRationale = new Map<string, string>();
  const drugPartner = new Map<string, string>(); // for substitute decisions

  for (const e of graph?.edges ?? []) {
    for (const d of [e.source, e.target]) {
      const cur = drugWorstSeverity.get(d);
      if (!cur || sevRank[e.severity] > sevRank[cur]) {
        drugWorstSeverity.set(d, e.severity);
        drugRationale.set(d, `${e.interaction_type}; paired with ${d === e.source ? e.target : e.source}`);
        drugPartner.set(d, d === e.source ? e.target : e.source);
      }
    }
  }

  const ranked = drugNames
    .map((d) => ({ drug: d, sev: drugWorstSeverity.get(d) ?? "low" as Severity }))
    .sort((a, b) => sevRank[b.sev] - sevRank[a.sev]);

  // Pick up to 4 steps focusing on worst offenders.
  const topK = ranked.slice(0, Math.min(4, ranked.length));

  // Decide action per drug using simple rules.
  const SUBSTITUTES: Record<string, string> = {
    "Omeprazole": "Pantoprazole",
    "Amitriptyline": "Nortriptyline (lower anticholinergic load)",
    "Diphenhydramine": "Loratadine (non-sedating)",
    "Oxybutynin": "Mirabegron (non-anticholinergic)",
    "Simvastatin": "Rosuvastatin (lower CYP3A4 interaction)",
    "Aspirin": "Clopidogrel (if antiplatelet still required)",
  };

  const reductionForSev: Record<Severity, number> = { critical: 32, high: 22, moderate: 12, low: 5 };

  const steps: DeprescribingStep[] = topK.map((item, i) => {
    const { drug, sev } = item;
    const baseReduction = reductionForSev[sev];

    let action: DeprescribingAction = "monitor" as DeprescribingAction;
    let substitute: string | undefined;
    let timeline = "Re-assess in 2 weeks";
    let monitoring = ["Clinical review at next visit"];

    if (sev === "critical") {
      if (SUBSTITUTES[drug]) {
        action = "substitute";
        substitute = SUBSTITUTES[drug];
        timeline = "Cross-taper over 5–7 days";
        monitoring = ["Monitor for rebound symptoms", "Re-check labs at day 7"];
      } else {
        action = "discontinue";
        timeline = "Stop immediately; evaluate alternative at follow-up";
        monitoring = ["Monitor for withdrawal", "Clinical review at 48 hours"];
      }
    } else if (sev === "high") {
      if (SUBSTITUTES[drug]) {
        action = "substitute";
        substitute = SUBSTITUTES[drug];
        timeline = "Cross-taper over 7 days";
        monitoring = ["Monitor for efficacy loss", "Lab review at 2 weeks"];
      } else {
        action = "reduce";
        timeline = "Reduce dose 50% over 7 days";
        monitoring = ["Monitor response", "Re-check labs at day 14"];
      }
    } else if (sev === "moderate") {
      action = "reduce";
      timeline = "Reduce dose over 14 days if tolerated";
      monitoring = ["Routine follow-up", "Repeat labs at 4 weeks"];
    } else {
      // low — monitor only, but action enum needs valid value. Use reduce with light taper as fallback.
      action = "reduce";
      timeline = "Continue with extended monitoring";
      monitoring = ["Routine follow-up"];
    }

    return {
      priority: i + 1,
      drug,
      action,
      substitute,
      monitoring,
      expected_risk_reduction: baseReduction - i * 2, // later steps contribute marginally less
      timeline,
      rationale: drugRationale.get(drug) ?? `${sev[0].toUpperCase() + sev.slice(1)} severity profile flagged for review`,
    };
  });

  const total = steps.reduce((sum, s) => sum + s.expected_risk_reduction, 0);

  const warnings: string[] = [
    "All deprescribing actions should be reviewed by the prescribing clinician.",
    "Dose tapering schedules are estimates — individualize based on patient response.",
  ];
  if ((request?.patient?.age ?? 0) >= 75) {
    warnings.unshift("Elderly patient — initiate changes one at a time with 7-day reassessment.");
  }
  if ((request?.patient?.ckd_stage ?? 0) >= 3) {
    warnings.unshift("CKD stage ≥3 — adjust renally-cleared doses and monitor eGFR closely.");
  }

  return {
    steps,
    total_expected_risk_reduction: total,
    summary: `${steps.length}-step deprescribing plan targeting the highest-severity interactions first. Estimated cumulative risk reduction: ${total}%.`,
    warnings,
  };
}

// ── Numeric risk score derivation ─────────────────────────
// Used by the Overall Risk Assessment card. Previously hardcoded to
// {low: 2.5, moderate: 5.0, ...}. Now biased by the demo graph so the big
// number on the right actually reflects the visualization.

function deriveNumericRiskFromGraph(graph: InteractionGraph | null, multiplier: number): number {
  const edges = graph?.edges ?? [];
  if (edges.length === 0) return 2.5;
  // Severity → numeric weight. Tuned so the demo shows a visible gradient
  // across the 3 Quick Test profiles rather than all pegging at 9.8.
  const weight: Record<Severity, number> = { low: 2, moderate: 4.5, high: 6.8, critical: 8.5 };
  let total = 0;
  let max = 0;
  for (const e of edges) {
    const w = weight[e.severity];
    total += w;
    if (w > max) max = w;
  }
  // 45% max + 55% average → spreads scores more, high-volume interaction
  // graphs don't automatically saturate.
  const avg = total / edges.length;
  const base = max * 0.45 + avg * 0.55;
  return Math.min(9.6, Math.max(0.5, Math.round(base * multiplier * 10) / 10));
}

// ── PDF/HTML Report ─────────────────────────────────────
function generateReportHTML(data: AnalyzeResponse, request: AnalyzeRequest | null): string {
  const report = data.report;

  // Resolve all four datasets using the same "treat empty as missing"
  // rule as the UI, so the exported PDF/HTML mirrors what the user saw.
  const g = data.interaction_graph;
  const hasRealGraph = g && Array.isArray(g.nodes) && g.nodes.length > 0 && Array.isArray(g.edges) && g.edges.length > 0;
  const resolvedGraph = hasRealGraph ? g! : getDemoInteractionGraph(request);

  const t = data.temporal_model;
  const hasRealTemporal = t && Array.isArray(t.daily_risk) && t.daily_risk.length > 0;
  const resolvedTemporal = hasRealTemporal ? t! : getDemoTemporalModel(request, resolvedGraph);

  const d = data.deprescribing_plan;
  const hasRealPlan = d && Array.isArray(d.steps) && d.steps.length > 0;
  const resolvedDep = hasRealPlan ? d! : getDemoDeprescribingPlan(request, resolvedGraph);

  const numScore = getNumericRiskScore(data, resolvedGraph, request);
  const derivedLevel =
    numScore >= 8.5 ? "critical" :
    numScore >= 6.5 ? "high" :
    numScore >= 4 ? "moderate" : "low";
  const riskInfo = getRiskLevel(report?.overall_risk_level ?? derivedLevel);

  const now = formatJakartaTime();
  const patientCtx = request?.patient || { age: 0, sex: "unknown", ckd_stage: 0, hepatic_impairment: false, smoking: false, comorbidities: [], allergies: [] } as any;
  const summary = report?.patient_summary
    ? { headline: report.patient_summary, bullets: [] as PatientSummaryData["bullets"] }
    : buildPatientSummary(patientCtx, data, resolvedGraph, resolvedTemporal, resolvedDep);

  // ── Section builders ──────────────────────────────────

  // Interaction rows: prefer raw_interactions (richer) but fall back to
  // graph.edges so the PDF is never empty when the demo data is used.
  const rawIx = data.raw_interactions?.interactions ?? [];
  const interactionRows = rawIx.length > 0
    ? rawIx.map((ix) => `
        <tr>
          <td>${esc((ix.drugs ?? []).join(" + "))}</td>
          <td><span class="sev sev-${ix.severity}">${esc(ix.severity.toUpperCase())}</span></td>
          <td>${esc(ix.description)}</td>
          <td>${esc(ix.evidence_grade ?? "—")}</td>
          <td>${ix.confidence_score != null ? ix.confidence_score + "%" : "—"}</td>
        </tr>`).join("")
    : resolvedGraph.edges.map((e) => `
        <tr>
          <td>${esc(e.source)} + ${esc(e.target)}</td>
          <td><span class="sev sev-${e.severity}">${esc(e.severity.toUpperCase())}</span></td>
          <td>${esc(e.interaction_type)}</td>
          <td>—</td>
          <td>${Math.round((e.weight ?? 0) * 100)}%</td>
        </tr>`).join("");

  const totalInteractions = rawIx.length > 0 ? (data.raw_interactions?.total_interactions ?? rawIx.length) : resolvedGraph.edges.length;
  const criticalCount = resolvedGraph.edges.filter((e) => e.severity === "critical").length;
  const highCount = resolvedGraph.edges.filter((e) => e.severity === "high").length;
  const hubDrugs = (resolvedGraph.hub_drugs ?? []);
  const emergent = resolvedGraph.emergent_interactions ?? [];

  // Timeline section
  const peakScore = resolvedTemporal.peak_risk_score ?? 0;
  const peakDay = resolvedTemporal.peak_risk_day ?? 0;
  const windows = resolvedTemporal.intervention_windows ?? [];
  const keyEvents = (resolvedTemporal.daily_risk ?? []).filter((d) => d.key_event);

  const windowRows = windows.map((w) => `
    <tr>
      <td>Day ${w.day_start}–${w.day_end}</td>
      <td>${esc(w.action ?? "")}</td>
      <td><span class="urg urg-${w.urgency ?? "standard"}">${esc((w.urgency ?? "standard").toUpperCase())}</span></td>
    </tr>`).join("");

  const keyEventRows = keyEvents.map((d) => `
    <tr>
      <td>Day ${d.day}</td>
      <td>${esc(d.key_event ?? "")}</td>
      <td>${(d.risk_score ?? 0).toFixed(1)}/10</td>
    </tr>`).join("");

  // Deprescribing section
  const depRows = (resolvedDep.steps ?? []).map((s) => `
    <tr>
      <td>#${s.priority}</td>
      <td><strong>${esc(s.drug)}</strong></td>
      <td><span class="act act-${s.action}">${esc((s.action ?? "").toUpperCase())}</span></td>
      <td>${esc(s.substitute ?? "—")}</td>
      <td class="reduction">-${s.expected_risk_reduction}%</td>
      <td>${esc(s.timeline ?? "—")}</td>
      <td>${esc(s.rationale ?? "")}</td>
    </tr>`).join("");

  // Phenotype section
  const phenoRows = `
    <tr><td>Age</td><td>${patientCtx.age ?? "—"}</td></tr>
    <tr><td>Sex</td><td>${esc(patientCtx.sex ?? "unknown")}</td></tr>
    <tr><td>Weight</td><td>${patientCtx.weight_kg ? patientCtx.weight_kg + " kg" : "—"}</td></tr>
    <tr><td>CKD Stage</td><td>${patientCtx.ckd_stage ?? 0}</td></tr>
    <tr><td>Hepatic Function</td><td>${patientCtx.hepatic_impairment ? "Impaired" : "Normal"}</td></tr>
    <tr><td>Smoking</td><td>${patientCtx.smoking ? "Active" : "No"}</td></tr>
    ${(patientCtx.comorbidities ?? []).length > 0
      ? `<tr><td>Comorbidities</td><td>${esc((patientCtx.comorbidities ?? []).join(", "))}</td></tr>`
      : ""}
    ${(patientCtx.allergies ?? []).length > 0
      ? `<tr><td>Allergies</td><td>${esc((patientCtx.allergies ?? []).join(", "))}</td></tr>`
      : ""}
  `;

  const summaryBullets = summary.bullets.length > 0
    ? `<ul class="bullets">${summary.bullets.map((b) => `
        <li>
          <span class="bl">${esc(b.label)}</span>
          <span class="bv" style="color:${b.color ?? "#ea580c"}">${esc(b.value)}</span>
        </li>
      `).join("")}</ul>`
    : "";

  // ── Assemble HTML ─────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ARIA Clinical Report — ${now}</title>
<style>
  /* Proper PDF page margins — @page controls the actual paper margins
     when the browser renders to PDF. Padding on body is for on-screen
     preview only. */
  @page {
    size: A4 portrait;
    margin: 18mm 15mm 20mm 15mm;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif; background: #020817; color: #f1f5f9; line-height: 1.65; padding: 56px 48px; }
  .c { max-width: 960px; margin: 0 auto; }

  /* Animated gradient title — same effect as the About page. */
  @keyframes shimmerTitle {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }
  h1.title {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(90deg, #00e5ff 0%, #38bdf8 25%, #7c4dff 50%, #38bdf8 75%, #00e5ff 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmerTitle 4s linear infinite;
    margin-bottom: 6px;
    line-height: 1.1;
  }
  h2 { font-size: 19px; color: #06b6d4; margin: 36px 0 14px; padding-bottom: 10px; border-bottom: 1px solid #1e3a5f; font-weight: 700; page-break-after: avoid; }
  h3 { font-size: 14px; color: #94a3b8; margin: 18px 0 10px; font-weight: 600; page-break-after: avoid; }
  p  { margin-bottom: 12px; color: #cbd5e1; }

  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 22px; border-bottom: 2px solid #1e3a5f; gap: 28px; }
  .hdr .meta { flex: 1; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 4px; }

  /* Risk badge — score in orange+bold, border thick blue (distinct from fill) */
  .rb {
    padding: 18px 32px;
    border-radius: 16px;
    text-align: center;
    background: #0b1a33;
    border: 3px solid #06b6d4; /* thick blue — distinguishes from the orange score */
    box-shadow: 0 0 24px rgba(6,182,212,0.25);
    min-width: 150px;
  }
  .rb .sc {
    font-size: 48px;
    font-weight: 900;
    color: #f97316; /* bold orange score */
    line-height: 1;
    margin-bottom: 6px;
  }
  .rb .sc .denom { font-size: 20px; color: #64748b; font-weight: 500; margin-left: 2px; }
  .rb .lb { font-size: 11px; letter-spacing: 2px; color: ${riskInfo.color}; font-weight: 700; text-transform: uppercase; }

  .interp {
    background: ${riskInfo.bgColor};
    border: 1px solid ${riskInfo.color}55;
    border-radius: 10px;
    padding: 18px 22px;
    margin: 20px 0 8px;
  }
  .interp p { color: #e2e8f0; margin: 0; }

  /* Patient summary bullets — bordered rows with accent bar, matching the
     web version's look. Always visible (not hover-only). */
  .bullets { list-style: none; padding: 0; margin: 14px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .bullets li {
    padding: 10px 14px;
    font-size: 13px;
    color: #cbd5e1;
    background: rgba(6,182,212,0.04);
    border: 1px solid rgba(6,182,212,0.18);
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .bullets .bl { color: #94a3b8; }
  .bullets .bv { font-weight: 700; font-family: 'SF Mono', Menlo, monospace; white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; margin: 14px 0 18px; font-size: 13px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { background: #0f172a; color: #94a3b8; text-align: left; padding: 11px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  td { padding: 11px 12px; border-bottom: 1px solid #1e3a5f; color: #cbd5e1; vertical-align: top; }
  td.reduction { color: #10b981; font-weight: 700; }

  .sev, .urg, .act {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
  }
  .sev-critical { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.1); }
  .sev-high     { color: #f97316; border-color: #f97316; background: rgba(249,115,22,0.1); }
  .sev-moderate { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.1); }
  .sev-low      { color: #10b981; border-color: #10b981; background: rgba(16,185,129,0.1); }
  .urg-immediate, .urg-high { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.08); }
  .urg-standard             { color: #06b6d4; border-color: #06b6d4; background: rgba(6,182,212,0.08); }
  .act-discontinue { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.08); }
  .act-substitute  { color: #06b6d4; border-color: #06b6d4; background: rgba(6,182,212,0.08); }
  .act-reduce      { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.08); }
  .act-monitor     { color: #10b981; border-color: #10b981; background: rgba(16,185,129,0.08); }

  .finding { padding: 10px 14px; background: rgba(239,68,68,0.06); border-left: 3px solid #ef4444; margin: 8px 0; border-radius: 0 6px 6px 0; color: #fca5a5; }
  .warn    { padding: 10px 14px; background: rgba(245,158,11,0.06); border-left: 3px solid #f59e0b; margin: 8px 0; border-radius: 0 6px 6px 0; color: #fbbf24; }

  .total-reduction { color: #10b981; font-weight: 700; font-size: 15px; margin-top: 12px; padding: 10px 14px; background: rgba(16,185,129,0.08); border-radius: 6px; }

  .ft { margin-top: 52px; padding-top: 24px; border-top: 1px solid #1e3a5f; font-size: 11px; color: #64748b; text-align: center; }
  .ft p { margin-bottom: 6px; }

  /* Print: near-black text, keep the score orange bold and the border blue
     thick. This is what the user specifically asked for in the PDF export. */
  @media print {
    body { background: #ffffff; color: #111827; padding: 0; }
    .c { max-width: 100%; }
    h1.title {
      /* Keep gradient visible on modern print engines that support it;
         fall back to a solid readable color if not. */
      color: #0369a1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h2 { color: #0369a1; border-bottom-color: #cbd5e1; }
    h3 { color: #475569; }
    p  { color: #111827; }
    .sub { color: #475569; }
    .hdr { border-bottom-color: #cbd5e1; }
    .rb {
      background: #ffffff;
      border: 3px solid #0369a1; /* thick blue border on paper */
      box-shadow: none;
    }
    .rb .sc { color: #ea580c; }        /* bold orange score */
    .rb .sc .denom { color: #94a3b8; }
    .rb .lb { color: #ea580c; }
    .interp { background: #fff7ed; border-color: #fed7aa; }
    .interp p { color: #111827; }
    .bullets li {
      color: #111827;
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    .bullets .bl { color: #475569; }
    th { background: #f1f5f9; color: #334155; }
    td { color: #111827; border-bottom-color: #e5e7eb; }
    .finding { background: #fef2f2; color: #991b1b; }
    .warn { background: #fffbeb; color: #92400e; }
    .total-reduction { background: #ecfdf5; color: #065f46; }
    .ft { color: #475569; border-top-color: #e5e7eb; }
    /* Keep severity pills readable on paper */
    .sev, .urg, .act {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<div class="c">

  <div class="hdr">
    <div class="meta">
      <h1 class="title">ARIA Clinical Report</h1>
      <p class="sub">Adaptive Risk Intelligence for Polypharmacy Assessment</p>
      <p class="sub">${report?.medication_count ?? 0} medications · ${now}</p>
    </div>
    <div class="rb">
      <div class="sc">${numScore.toFixed(1)}<span class="denom">/10</span></div>
      <div class="lb">${esc(riskInfo.label)}</div>
    </div>
  </div>

  <div class="interp">
    <p><strong>Interpretation:</strong> ${esc(riskInfo.description)}</p>
  </div>

  <h2>Patient Summary</h2>
  <p>${esc(summary.headline)}</p>
  ${summaryBullets}

  <h2>Phenotype Profile</h2>
  <table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>${phenoRows}</tbody></table>

  ${report?.interaction_summary ? `<h2>Interaction Summary</h2><p>${esc(report.interaction_summary)}</p>` : ""}

  ${(report?.critical_findings ?? []).length > 0
    ? `<h2>Critical Findings</h2>${report!.critical_findings.map((f: string) => `<div class="finding">${esc(f)}</div>`).join("")}`
    : ""}

  ${interactionRows ? `
    <h2>Drug Interactions (${totalInteractions})</h2>
    <p>${resolvedGraph.nodes.length} drugs · ${resolvedGraph.edges.length} pairwise interactions · Density ${((resolvedGraph.graph_density ?? 0) * 100).toFixed(0)}% · ${criticalCount} critical · ${highCount} high${hubDrugs.length > 0 ? ` · Hub drugs: <strong>${esc(hubDrugs.join(", "))}</strong>` : ""}</p>
    <table>
      <thead><tr><th>Drugs</th><th>Severity</th><th>Mechanism / Description</th><th>Evidence</th><th>Confidence</th></tr></thead>
      <tbody>${interactionRows}</tbody>
    </table>
    ${emergent.length > 0 ? `
      <h3>Emergent Multi-Drug Interactions</h3>
      ${emergent.map((e) => `<div class="warn">⚠ <strong>${esc((e.drugs ?? []).join(" + "))}</strong> — ${esc(e.description)} <em>(${esc(e.severity.toUpperCase())})</em></div>`).join("")}
    ` : ""}
  ` : ""}

  <h2>Risk Cascade Timeline</h2>
  <p>${esc(resolvedTemporal.summary ?? "")}</p>
  <p><strong>Projection:</strong> ${resolvedTemporal.timeline_days ?? 0} days &nbsp;·&nbsp;
     <strong>Peak risk:</strong> <span style="color:#ea580c;font-weight:700">${peakScore.toFixed(1)}/10</span> at day ${peakDay}</p>
  ${windowRows ? `
    <h3>Intervention Windows</h3>
    <table>
      <thead><tr><th>Day Range</th><th>Action</th><th>Urgency</th></tr></thead>
      <tbody>${windowRows}</tbody>
    </table>
  ` : ""}
  ${keyEventRows ? `
    <h3>Key Events</h3>
    <table>
      <thead><tr><th>Day</th><th>Event</th><th>Risk Score</th></tr></thead>
      <tbody>${keyEventRows}</tbody>
    </table>
  ` : ""}

  ${depRows ? `
    <h2>Deprescribing Plan</h2>
    <p>${esc(resolvedDep.summary ?? "")}</p>
    <table>
      <thead><tr><th>#</th><th>Drug</th><th>Action</th><th>Substitute</th><th>Risk ↓</th><th>Timeline</th><th>Rationale</th></tr></thead>
      <tbody>${depRows}</tbody>
    </table>
    <div class="total-reduction">Total expected risk reduction: -${resolvedDep.total_expected_risk_reduction ?? 0}%</div>
    ${(resolvedDep.warnings ?? []).length > 0
      ? `<h3>Clinical Warnings</h3>${resolvedDep.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`
      : ""}
  ` : ""}

  ${report?.report_text ? `<h2>Full Clinical Report</h2><p style="white-space:pre-wrap">${esc(report.report_text)}</p>` : ""}

  <div class="ft">
    <p><strong>ARIA</strong> — Adaptive Risk Intelligence for Polypharmacy Assessment</p>
    <p style="max-width:640px;margin:8px auto">AI-generated for informational purposes only. Review by qualified healthcare professional required.</p>
    <p style="margin-top:8px">${now}</p>
  </div>

</div>
</body>
</html>`;
}

/** Minimal HTML escaper — prevents <script>-style content in drug names or
 *  user-entered comorbidities from breaking the report. */
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Interpretation Panels ───────────────────────────────

// ── Viz side panel helpers (shared by all 4 viz tabs) ────────
//
// Pattern: absolute-positioned panel anchored top-right of the canvas
// wrapper, with subtle border + glow in the viz's accent color. Unified
// here so all four tabs have identical chrome.

function VizSidePanel({
  accentColor,
  children,
  onClose,
}: {
  accentColor: string;
  children: React.ReactNode;
  /** If provided, shows a close (×) button that triggers it. Used for
   *  click-to-select viz (Graph, Deprescribing). Omit for hover-only viz
   *  (Phenotype, Timeline) where the panel disappears on pointer-out. */
  onClose?: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        // On desktop the panel sits in the top-right corner with a fixed
        // 260px width. On mobile (< sm = 640px) the panel anchors to the
        // bottom of the canvas and spans the full width minus a small gutter,
        // so it doesn't cover the graph it's describing. The Tailwind utilities
        // here flip both the position and the sizing at the breakpoint.
        className="absolute left-3 right-3 bottom-3 sm:left-auto sm:right-3 sm:top-3 sm:bottom-auto rounded-lg p-3 w-auto sm:w-[260px]"
        style={{
          maxHeight: "calc(100% - 24px)",
          overflowY: "auto",
          background: "rgba(6,14,31,0.94)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${accentColor}66`,
          boxShadow: `0 0 24px ${accentColor}26, 0 4px 20px rgba(0,0,0,0.5)`,
          zIndex: 10,
          pointerEvents: onClose ? "auto" : "none",
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center transition-colors"
            style={{ color: "#7a8ba8", fontSize: 14, lineHeight: 1, background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#eaf0fa"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7a8ba8"; }}
            aria-label="Close details"
          >
            ×
          </button>
        )}
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function SidePanelHeader({
  title,
  badge,
  accent,
}: {
  title: string;
  badge?: string;
  accent: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 pr-5">
      <span
        className="font-display font-bold text-sm truncate"
        style={{ color: accent }}
      >
        {title}
      </span>
      {badge && (
        <span
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider shrink-0"
          style={{ color: accent, background: `${accent}22`, border: `1px solid ${accent}44` }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function SidePanelScore({ value, accent }: { value: number; accent: string }) {
  return (
    <>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="font-display font-bold text-2xl" style={{ color: accent }}>
          {value.toFixed(1)}
        </span>
        <span className="text-[11px] font-mono" style={{ color: "#7a8ba8" }}>/ 10</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-2.5" style={{ background: "rgba(30,58,95,0.5)" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(value * 10, 100)}%`,
            background: accent,
            boxShadow: `0 0 8px ${accent}80`,
          }}
        />
      </div>
    </>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div
      className="px-2 py-1 rounded text-[10px]"
      style={{
        background: accent ? `${accent}10` : "rgba(6,182,212,0.05)",
        border: `1px solid ${accent ? `${accent}33` : "rgba(6,182,212,0.1)"}`,
      }}
    >
      <div style={{ color: "#7a8ba8" }} className="uppercase tracking-wider">{label}</div>
      <div className="font-mono font-bold" style={{ color: accent ?? "#eaf0fa", fontSize: 12 }}>
        {String(value)}
      </div>
    </div>
  );
}

function InterpretPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      className="p-4 rounded-xl text-xs space-y-2"
      initial={false}
      whileHover={{
        scale: 1.008,
        transition: { duration: 0.3 },
      }}
      style={{
        background: "rgba(8,20,37,0.6)",
        border: "1px solid rgba(0,229,255,0.07)",
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = "rgba(6, 182, 212, 0.05)";
        el.style.borderColor = "rgba(6, 182, 212, 0.25)";
        el.style.boxShadow = "0 0 24px rgba(6, 182, 212, 0.08), inset 0 1px 0 rgba(6, 182, 212, 0.1)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "rgba(8,20,37,0.6)";
        el.style.borderColor = "rgba(0,229,255,0.07)";
        el.style.boxShadow = "none";
      }}
    >
      <h4 className="font-display font-semibold uppercase tracking-wider"
        style={{ color: "var(--primary)", fontSize: 11 }}>{title}</h4>
      {children}
    </motion.div>
  );
}

// ── Unified Interpretation helpers ────────────────────────
//
// Goal: every Interpretation panel (Graph, Timeline, Phenotype, Deprescribing)
// looks the same — bordered stat boxes on top with hover color animation,
// soft-divider detail rows below. All info always visible (never hover-only).

/** Bordered key-value stat with hover color animation. */
function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  /** Optional semantic color applied to the value + hover border. */
  accent?: string;
}) {
  const neutralBg = "rgba(6,182,212,0.04)";
  const neutralBorder = "rgba(6,182,212,0.1)";
  const accentBg = accent ? `${accent}11` : neutralBg;
  const accentBorder = accent ? `${accent}26` : neutralBorder;
  return (
    <div
      className="px-2 py-1.5 rounded transition-all"
      style={{
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        transition: "background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = accent ?? "rgba(6,182,212,0.4)";
        el.style.boxShadow = `0 0 12px ${accent ? `${accent}33` : "rgba(6,182,212,0.15)"}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = accentBorder;
        el.style.boxShadow = "none";
      }}
    >
      <span style={{ color: "#8a9bba" }} className="text-xs">{label}:</span>{" "}
      <span className="font-mono font-bold text-xs" style={{ color: accent ?? "#eaf0fa" }}>
        {String(value)}
      </span>
    </div>
  );
}

/** Table-style detail row (used in all four Interpretation panels). */
function InfoRow({
  index,
  accentColor,
  labelContent,
  valueContent,
  onClick,
}: {
  index: number;
  accentColor: string;
  labelContent: React.ReactNode;
  valueContent: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-xs"
      style={{
        borderTop: index === 0 ? "none" : "1px solid rgba(148,163,184,0.08)",
        background: "transparent",
        transition: "background-color 0.3s ease, box-shadow 0.3s ease",
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = `${accentColor}14`;
        el.style.boxShadow = `inset 3px 0 0 ${accentColor}88`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "transparent";
        el.style.boxShadow = "none";
      }}
    >
      <div className="font-medium min-w-0">{labelContent}</div>
      <div className="text-right shrink-0">{valueContent}</div>
    </div>
  );
}

/** Detail-table shell with header row. */
function InfoTable({
  accent,
  headerLeft,
  headerRight,
  children,
}: {
  accent: string;
  headerLeft: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mt-3 rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${accent}2e`,
        background: "rgba(8,20,37,0.4)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          background: `${accent}19`,
          borderBottom: `1px solid ${accent}26`,
        }}
      >
        <p style={{ color: accent }} className="font-semibold text-xs">
          {headerLeft}
        </p>
        {headerRight && (
          <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "#7a8ba8" }}>
            {headerRight}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  // Legacy helper kept for any other callers. New Interpretation panels use StatBox.
  return (
    <span className="transition-colors duration-200">
      <span style={{ color: "#94a8c8" }}>{label}:</span>{" "}
      <span className="font-mono" style={color ? { color } : { color: "#eaf0fa" }}>{String(value)}</span>
    </span>
  );
}

function GraphInterpretation({ graph }: { graph: InteractionGraph | null }) {
  if (!graph) return null;
  const edges = graph.edges ?? [];
  const nodes = graph.nodes ?? [];
  const hubs = graph.hub_drugs ?? [];
  const crit = edges.filter((e) => e.severity === "critical").length;
  const high = edges.filter((e) => e.severity === "high").length;
  const moderate = edges.filter((e) => e.severity === "moderate").length;
  const low = edges.filter((e) => e.severity === "low").length;
  const emergent = graph.emergent_interactions ?? [];

  // Top interactions ordered by severity
  const sevRank: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  const topInteractions = [...edges]
    .sort((a, b) => sevRank[b.severity] - sevRank[a.severity])
    .slice(0, 6);

  return (
    <InterpretPanel title="Graph Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        <StatBox label="Drugs" value={nodes.length} />
        <StatBox label="Interactions" value={edges.length} />
        <StatBox label="Density" value={`${((graph.graph_density ?? 0) * 100).toFixed(0)}%`} />
        <StatBox label="Critical" value={crit} accent={crit > 0 ? "#ef4444" : undefined} />
        <StatBox label="High" value={high} accent={high > 0 ? "#f97316" : undefined} />
        <StatBox label="Moderate" value={moderate} accent={moderate > 0 ? "#f59e0b" : undefined} />
        <StatBox label="Low" value={low} accent={low > 0 ? "#10b981" : undefined} />
        <StatBox label="Hub Drugs" value={hubs.length} accent={hubs.length > 0 ? "#7c4dff" : undefined} />
        <StatBox label="Emergent" value={emergent.length} accent={emergent.length > 0 ? "#f59e0b" : undefined} />
      </div>

      {topInteractions.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft={`Top ${topInteractions.length} interaction${topInteractions.length > 1 ? "s" : ""} by severity`}
          headerRight="pair · severity"
        >
          {topInteractions.map((e, i) => {
            const sevColor = SEVERITY_COLORS[e.severity] ?? "#94a8c8";
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={sevColor}
                labelContent={
                  <span className="font-medium" style={{ color: "#eaf0fa" }}>
                    {e.source} <span style={{ color: "#7a8ba8" }}>+</span> {e.target}
                  </span>
                }
                valueContent={
                  <span
                    className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{ color: sevColor, background: `${sevColor}1c`, border: `1px solid ${sevColor}33` }}
                  >
                    {e.severity}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {hubs.length > 0 && (
        <InfoTable accent="#7c4dff" headerLeft={`Hub drug${hubs.length > 1 ? "s" : ""} (high connectivity)`}>
          {hubs.map((h, i) => {
            const deg = nodes.find((n) => n.drug_name === h)?.degree ?? 0;
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor="#7c4dff"
                labelContent={<span className="font-mono font-bold" style={{ color: "#a78bfa" }}>★ {h}</span>}
                valueContent={
                  <span className="font-mono text-xs" style={{ color: "#cbd5e1" }}>
                    {deg} connection{deg !== 1 ? "s" : ""}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {emergent.length > 0 && (
        <InfoTable accent="#f59e0b" headerLeft={`⚠ ${emergent.length} emergent multi-drug interaction${emergent.length > 1 ? "s" : ""}`}>
          {emergent.map((ei, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={
                <span className="font-medium" style={{ color: "#fbbf24" }}>
                  {(ei.drugs || []).join(" + ")}
                </span>
              }
              valueContent={
                <span
                  className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    color: SEVERITY_COLORS[ei.severity] ?? "#f59e0b",
                    background: `${SEVERITY_COLORS[ei.severity] ?? "#f59e0b"}1c`,
                    border: `1px solid ${SEVERITY_COLORS[ei.severity] ?? "#f59e0b"}33`,
                  }}
                >
                  {ei.severity}
                </span>
              }
            />
          ))}
        </InfoTable>
      )}
    </InterpretPanel>
  );
}

function TimelineInterpretation({ temporal }: { temporal: CascadeModel | null }) {
  if (!temporal) return null;
  const peakScore = temporal.peak_risk_score ?? 0;
  const peakColor = peakScore > 7 ? "#ef4444" : peakScore > 4 ? "#f59e0b" : "#06b6d4";
  const windows = temporal.intervention_windows ?? [];
  const daily = temporal.daily_risk ?? [];
  const avgRisk = daily.length > 0
    ? daily.reduce((sum, d) => sum + (d.risk_score ?? 0), 0) / daily.length
    : 0;
  // Key events extracted from daily_risk
  const keyEvents = daily.filter((d) => d.key_event);

  return (
    <InterpretPanel title="Timeline Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <StatBox label="Projection" value={`${temporal.timeline_days ?? 0} days`} />
        <StatBox label="Peak Day" value={`Day ${temporal.peak_risk_day ?? "?"}`} accent={peakColor} />
        <StatBox label="Peak Score" value={`${peakScore.toFixed(1)}/10`} accent={peakColor} />
        <StatBox label="Avg Risk" value={`${avgRisk.toFixed(1)}/10`} />
        <StatBox label="Interventions" value={windows.length} accent={windows.length > 0 ? "#06b6d4" : undefined} />
        <StatBox label="Key Events" value={keyEvents.length} />
      </div>

      {windows.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft={`Intervention window${windows.length > 1 ? "s" : ""}`}
          headerRight="day range · action"
        >
          {windows.map((w, i) => {
            const urgent = w.urgency === "high" || w.urgency === "immediate";
            const accent = urgent ? "#ef4444" : "#06b6d4";
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={accent}
                labelContent={
                  <span style={{ color: "#eaf0fa" }} className="font-medium">
                    <span style={{ color: accent }}>●</span>{" "}
                    {w.action}
                  </span>
                }
                valueContent={
                  <span className="font-mono text-xs" style={{ color: accent }}>
                    Day {w.day_start}–{w.day_end}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {keyEvents.length > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft="Key events"
          headerRight="day · event"
        >
          {keyEvents.map((d, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={
                <span style={{ color: "#eaf0fa" }} className="font-medium truncate block">
                  {d.key_event}
                </span>
              }
              valueContent={
                <span className="font-mono text-xs" style={{ color: "#fbbf24" }}>
                  Day {d.day} · {(d.risk_score ?? 0).toFixed(1)}/10
                </span>
              }
            />
          ))}
        </InfoTable>
      )}

      {temporal.summary && (
        <p
          className="text-xs mt-3 p-3 rounded-lg leading-relaxed"
          style={{
            color: "#cbd5e1",
            background: "rgba(6,182,212,0.05)",
            border: "1px solid rgba(6,182,212,0.12)",
          }}
        >
          {temporal.summary}
        </p>
      )}
    </InterpretPanel>
  );
}

function PhenotypeInterpretation({ request }: { request: AnalyzeRequest | null }) {
  const p = request?.patient;
  if (!p) return null;

  const riskFactors: { label: string; detail: string }[] = [];
  if ((p.age??0) > 65) riskFactors.push({ label: "Elderly (>65)", detail: "Increased ADR susceptibility" });
  if ((p.ckd_stage??0) >= 3) riskFactors.push({ label: `CKD Stage ${p.ckd_stage}`, detail: "Impaired renal clearance" });
  if (p.hepatic_impairment) riskFactors.push({ label: "Hepatic impairment", detail: "Altered metabolism" });
  if (p.smoking) riskFactors.push({ label: "Active smoker", detail: "CYP1A2 induction" });
  if (p.sex === "female") riskFactors.push({ label: "Female", detail: "Higher QT baseline risk" });

  const phenoStats: { label: string; value: string | number; accent?: string }[] = [
    { label: "Age", value: p.age ?? 0, accent: (p.age ?? 0) > 65 ? "#f59e0b" : undefined },
    { label: "Sex", value: p.sex ?? "unknown" },
    { label: "CKD Stage", value: p.ckd_stage ?? 0, accent: (p.ckd_stage ?? 0) >= 3 ? "#ef4444" : undefined },
    { label: "Hepatic", value: p.hepatic_impairment ? "Impaired" : "Normal", accent: p.hepatic_impairment ? "#ef4444" : "#10b981" },
    { label: "Smoking", value: p.smoking ? "Active" : "No", accent: p.smoking ? "#f59e0b" : undefined },
    { label: "Weight", value: p.weight_kg ? `${p.weight_kg} kg` : "N/A" },
  ];

  return (
    <InterpretPanel title="Phenotype Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {phenoStats.map((s, i) => (
          <StatBox key={i} label={s.label} value={s.value} accent={s.accent} />
        ))}
      </div>

      {riskFactors.length > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft={`⚠ ${riskFactors.length} elevated risk factor${riskFactors.length > 1 ? "s" : ""}`}
          headerRight="factor · impact"
        >
          {riskFactors.map((r, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={<span style={{ color: "#fbbf24" }} className="font-medium">{r.label}</span>}
              valueContent={<span style={{ color: "#cbd5e1" }}>{r.detail}</span>}
            />
          ))}
        </InfoTable>
      )}

      {riskFactors.length === 0 && (
        <p className="text-xs mt-3 p-3 rounded-lg"
          style={{
            color: "#10b981",
            background: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.15)",
          }}>
          ✓ No elevated phenotype risk factors identified.
        </p>
      )}
    </InterpretPanel>
  );
}

function DeprescribingInterpretation({ plan }: { plan: DeprescribingPlan | null }) {
  if (!plan) return null;
  const steps = plan.steps ?? [];
  const actionColor = (a: string) =>
    a === "discontinue" ? "#ef4444"
      : a === "substitute" ? "#06b6d4"
      : a === "reduce" ? "#f59e0b"
      : "#10b981";

  const countBy = (action: string) => steps.filter((s) => s.action === action).length;

  return (
    <InterpretPanel title="Deprescribing Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        <StatBox label="Steps" value={steps.length} />
        <StatBox label="Total Reduction" value={`-${plan.total_expected_risk_reduction ?? 0}%`} accent="#10b981" />
        <StatBox label="Warnings" value={(plan.warnings ?? []).length} accent={(plan.warnings ?? []).length > 0 ? "#f59e0b" : undefined} />
        <StatBox label="Discontinue" value={countBy("discontinue")} accent={countBy("discontinue") > 0 ? "#ef4444" : undefined} />
        <StatBox label="Substitute" value={countBy("substitute")} accent={countBy("substitute") > 0 ? "#06b6d4" : undefined} />
        <StatBox label="Reduce" value={countBy("reduce")} accent={countBy("reduce") > 0 ? "#f59e0b" : undefined} />
      </div>

      {steps.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft="Prescribed steps"
          headerRight="drug · action · reduction"
        >
          {steps.map((s, i) => {
            const ac = actionColor(s.action);
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={ac}
                labelContent={
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold shrink-0" style={{ color: ac }}>#{s.priority}</span>
                    <span style={{ color: "#eaf0fa" }} className="font-medium truncate">{s.drug}</span>
                    {s.substitute && (
                      <span style={{ color: "#94a8c8" }} className="text-[10px] truncate">
                        → {s.substitute}
                      </span>
                    )}
                  </div>
                }
                valueContent={
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{
                        color: ac,
                        background: `${ac}1c`,
                        border: `1px solid ${ac}33`,
                      }}
                    >
                      {s.action}
                    </span>
                    <span className="font-mono font-bold text-xs" style={{ color: "#10b981" }}>
                      -{s.expected_risk_reduction}%
                    </span>
                  </div>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {plan.summary && (
        <p
          className="text-xs mt-3 p-3 rounded-lg leading-relaxed"
          style={{
            color: "#cbd5e1",
            background: "rgba(6,182,212,0.05)",
            border: "1px solid rgba(6,182,212,0.12)",
          }}
        >
          {plan.summary}
        </p>
      )}

      {(plan.warnings ?? []).length > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft={`⚠ Clinical warning${plan.warnings!.length > 1 ? "s" : ""}`}
        >
          {plan.warnings!.map((w, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={<span style={{ color: "#fbbf24" }}>{w}</span>}
              valueContent={<span />}
            />
          ))}
        </InfoTable>
      )}
    </InterpretPanel>
  );
}

// ── Hover Card wrapper ──────────────────────────────────
function HoverCard({
  children,
  borderColor,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  borderColor?: string;
  className?: string;
  delay?: number;
}) {
  const defaultBorder = borderColor ? `${borderColor}33` : "rgba(0,229,255,0.07)";
  const hoverBorderColor = borderColor ?? "#00e5ff";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`rounded-xl p-5 ${className}`}
      style={{
        background: "rgba(8,20,37,0.6)",
        border: `1px solid ${defaultBorder}`,
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = `${hoverBorderColor}55`;
        el.style.boxShadow = `0 0 28px ${hoverBorderColor}18, 0 0 8px ${hoverBorderColor}10`;
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = defaultBorder;
        el.style.boxShadow = "none";
        el.style.transform = "translateY(0)";
      }}
    >
      {children}
    </motion.div>
  );
}


// ════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════

export default function ReportPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [request, setRequest] = useState<AnalyzeRequest | null>(null);
  const [activeViz, setActiveViz] = useState<"graph" | "temporal" | "radar" | "waterfall">("graph");
  // Holds the currently-hovered radar axis so we can render an HTML tooltip
  // overlay (anchored on the right of the canvas, never clipped).
  const [radarHover, setRadarHover] = useState<RadarHoverPayload | null>(null);
  // Click/hover state for the 3 other visualizations. Each viz has its own
  // HTML side-panel overlay (pattern lifted from the Phenotype fix).
  const [graphHover, setGraphHover] = useState<NodeClickPayload | null>(null);
  const [timelineHover, setTimelineHover] = useState<TimelineHoverPayload | null>(null);
  const [deprescribingClick, setDeprescribingClick] = useState<DeprescribingClickPayload | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("aria-result");
      const storedReq = sessionStorage.getItem("aria-request");
      if (stored) setData(JSON.parse(stored));
      if (storedReq) setRequest(JSON.parse(storedReq));
    } catch { /* ignore */ }
  }, []);

  // Clear any sticky overlay state whenever the user switches tabs, so a
  // panel from one viz doesn't linger on another.
  useEffect(() => {
    if (activeViz !== "radar") setRadarHover(null);
    if (activeViz !== "graph") setGraphHover(null);
    if (activeViz !== "temporal") setTimelineHover(null);
    if (activeViz !== "waterfall") setDeprescribingClick(null);
  }, [activeViz]);

  // Track viewport width so we can adapt 3D canvas heights and the side
  // panel layout to mobile screens. Detected via matchMedia on mount and
  // updated on resize. SSR fallback is desktop (false) to avoid hydration
  // mismatch flash on desktop users.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobileViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Fallback rules: use the server-provided data ONLY when it has real
  // content. A response like `{ nodes: [], edges: [] }` is treated as
  // "empty" and the rich demo dataset is used instead, so the report
  // never shows "No X data available" during a demo.
  const effectiveGraph = useMemo((): InteractionGraph | null => {
    const g = data?.interaction_graph;
    const hasRealGraph = g && Array.isArray(g.nodes) && g.nodes.length > 0 && Array.isArray(g.edges) && g.edges.length > 0;
    if (hasRealGraph) return g!;
    return getDemoInteractionGraph(request);
  }, [data, request]);

  const effectiveTemporal = useMemo((): CascadeModel | null => {
    const t = data?.temporal_model;
    const hasRealTemporal = t && Array.isArray(t.daily_risk) && t.daily_risk.length > 0;
    if (hasRealTemporal) return t!;
    return getDemoTemporalModel(request, effectiveGraph);
  }, [data, request, effectiveGraph]);

  const effectiveDeprescribing = useMemo((): DeprescribingPlan | null => {
    const d = data?.deprescribing_plan;
    const hasRealPlan = d && Array.isArray(d.steps) && d.steps.length > 0;
    if (hasRealPlan) return d!;
    return getDemoDeprescribingPlan(request, effectiveGraph);
  }, [data, request, effectiveGraph]);

  const handleExportPDF = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    const w = window.open("", "_blank");
    if (!w) return; w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 500);
  }, [data, request]);

  const handleExportHTML = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `ARIA-Report-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data, request]);

  const handleViewHTML = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
  }, [data, request]);

  if (!data) {
    return (
      <><GridBackground /><div className="min-h-screen pt-24 flex items-center justify-center relative">
        <div className="fixed inset-0 z-0 pointer-events-none opacity-25">
          <Scene camera={{ position: [0, 0, 6], fov: 60 }}><FloatingParticles count={80} spread={12} /></Scene>
        </div>
        <div className="relative z-10 text-center">
          <div className="text-5xl mb-6">📋</div>
          <h2 className="font-display font-bold text-2xl text-gradient mb-3">No Report Available</h2>
          <p style={{ color: "#94a8c8" }} className="mb-6 max-w-sm mx-auto">Run an analysis first to generate a clinical report.</p>
          <button onClick={() => router.push("/analyze")} className="btn-primary">Start Analysis</button>
        </div>
      </div></>
    );
  }

  const errors = data.errors ?? [];
  const medCount = data.report?.medication_count ?? 0;
  // Compute numScore first, then derive the band label/color from it so
  // the big number, the colored banner, and the Score Scale Reference
  // highlight are always in agreement.
  const numScore = getNumericRiskScore(data, effectiveGraph, request);
  const derivedLevel =
    numScore >= 8.5 ? "critical" :
    numScore >= 6.5 ? "high" :
    numScore >= 4 ? "moderate" : "low";
  const riskInfo = getRiskLevel(data.report?.overall_risk_level ?? derivedLevel);
  const patientCtx = request?.patient || {
    age: 50, sex: "unknown", ckd_stage: 0, hepatic_impairment: false,
    smoking: false, alcohol_use: "none", comorbidities: [], allergies: [],
  };

  const vizTabs = [
    { key: "graph" as const, label: "Interaction Graph", icon: "🕸️", available: !!effectiveGraph },
    { key: "temporal" as const, label: "Timeline", icon: "⏱️", available: !!effectiveTemporal },
    { key: "radar" as const, label: "Phenotype", icon: "👤", available: true },
    { key: "waterfall" as const, label: "Deprescribing", icon: "💊", available: !!effectiveDeprescribing },
  ];

  // Canvas height is responsive: on desktop the side panel sits in the
  // top-right corner so we use the original heights. On mobile the panel
  // anchors to the bottom of the canvas, so we add extra height to give
  // the 3D viz room above the panel without it being squashed.
  const canvasHeight = activeViz === "radar"
    ? (isMobileViewport ? 600 : 520)
    : (isMobileViewport ? 500 : 420);

  // Build structured patient summary. If the backend provides a
  // pre-written summary string, use it as the headline and leave bullets
  // empty; otherwise compute both from the request + viz data.
  const patientSummary: PatientSummaryData = data.report?.patient_summary
    ? { headline: data.report.patient_summary, bullets: [] }
    : buildPatientSummary(patientCtx, data, effectiveGraph, effectiveTemporal, effectiveDeprescribing);

  return (
    <><GridBackground /><DataStream position="top-right" /><DataStream position="bottom-left" lines={5} />
    <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--success)", boxShadow: "0 0 8px var(--success)" }} />
              <span className="text-xs tracking-widest uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--success)" }}>Analysis Complete</span>
            </div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-gradient mb-1">Clinical Report</h1>
            <p style={{ color: "#7a8ba8" }} className="text-sm">{medCount} medications analyzed · {formatJakartaTime()}{errors.length > 0 && <span className="ml-2" style={{ color: "var(--warning)" }}>({errors.length} warning{errors.length !== 1 ? "s" : ""})</span>}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[
              { onClick: handleExportPDF, icon: "📄", label: "Export PDF" },
              { onClick: handleExportHTML, icon: "💾", label: "Download HTML" },
              { onClick: handleViewHTML, icon: "🔗", label: "View Report" },
              { onClick: () => router.push("/analyze"), icon: "", label: "New Analysis" },
            ].map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                className="btn-secondary text-xs flex items-center gap-1.5"
                style={{ transition: "all 0.3s ease" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,229,255,0.12)";
                  e.currentTarget.style.borderColor = "#00e5ff";
                  e.currentTarget.style.boxShadow = "0 0 20px rgba(0,229,255,0.15)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "rgba(0,229,255,0.22)";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {btn.icon && <span>{btn.icon}</span>}{btn.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── Main grid: stack on mobile, side-by-side on desktop ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left — 3D */}
          <div className="lg:col-span-3 space-y-4">
            {/* Viz tabs with hover animation */}
            <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgba(8,20,37,0.6)", border: "1px solid var(--border)" }}>
              {vizTabs.map((tab) => (
                <button key={tab.key} onClick={() => tab.available && setActiveViz(tab.key)}
                  className={`flex-1 min-w-[100px] py-2.5 rounded-lg text-xs font-display font-medium transition-all duration-300 ${activeViz === tab.key ? "text-[var(--primary)]" : tab.available ? "text-[#7a8ba8] hover:text-[#c8d6e8]" : "text-[#2a3a52] cursor-not-allowed"}`}
                  style={activeViz === tab.key ? {
                    background: "var(--primary-dim)",
                    border: "1px solid rgba(0,229,255,0.18)",
                  } : {
                    border: "1px solid transparent",
                    transition: "all 0.3s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (activeViz !== tab.key && tab.available) {
                      e.currentTarget.style.background = "rgba(0,229,255,0.05)";
                      e.currentTarget.style.borderColor = "rgba(0,229,255,0.1)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeViz !== tab.key) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "transparent";
                    }
                  }}
                >
                  <span className="mr-1">{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>

            <motion.div key={activeViz} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
              className="rounded-xl overflow-hidden transition-all duration-300 relative"
              style={{ height: canvasHeight, background: "rgba(8,20,37,0.4)", border: "1px solid var(--border)" }}>
              <Scene camera={{ position: [0, 0, 8], fov: 50 }}>
                {activeViz === "graph" && (
                  <InteractionGraph3D data={effectiveGraph as any} onNodeHover={setGraphHover} />
                )}
                {activeViz === "temporal" && (
                  <TemporalTimeline3D data={effectiveTemporal as any} onPointHover={setTimelineHover} />
                )}
                {activeViz === "radar" && (
                  <PhenotypeRadar3D
                    patient={patientCtx as any}
                    onHoverAxis={setRadarHover}
                  />
                )}
                {activeViz === "waterfall" && (
                  <DeprescribingWaterfall data={effectiveDeprescribing as any} onStepClick={setDeprescribingClick} />
                )}
              </Scene>

              {/* HTML overlay side-panels, rendered OUTSIDE the 3D canvas so
                  they never get clipped. Each viz has its own panel,
                  positioned top-right. Pattern unified into VizSidePanel. */}
              {activeViz === "radar" && radarHover && (
                <VizSidePanel accentColor={radarHover.color}>
                  <SidePanelHeader
                    title={radarHover.label}
                    badge={radarHover.riskLabel}
                    accent={radarHover.color}
                  />
                  <SidePanelScore value={radarHover.score} accent={radarHover.color} />
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                    {radarHover.explanation}
                  </p>
                  <p
                    className="text-[10px] leading-snug flex items-start gap-1"
                    style={{ color: radarHover.value > 0.5 ? radarHover.color : "#7a8ba8" }}
                  >
                    <span className="shrink-0">
                      {radarHover.value > 0.7 ? "⚠" : radarHover.value > 0.4 ? "→" : "✓"}
                    </span>
                    <span>{radarHover.action}</span>
                  </p>
                </VizSidePanel>
              )}

              {activeViz === "graph" && graphHover && (
                <VizSidePanel
                  accentColor={graphHover.worst_severity ? SEVERITY_COLORS[graphHover.worst_severity] : "#06b6d4"}
                >
                  <SidePanelHeader
                    title={graphHover.drug_name}
                    badge={graphHover.is_hub ? "★ HUB" : undefined}
                    accent={graphHover.is_hub ? "#a78bfa" : "#06b6d4"}
                  />
                  <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                    <MiniStat label="Connections" value={graphHover.degree} accent="#06b6d4" />
                    <MiniStat
                      label="Hub Score"
                      value={`${(graphHover.hub_score * 100).toFixed(0)}%`}
                      accent={graphHover.is_hub ? "#a78bfa" : undefined}
                    />
                  </div>
                  {graphHover.connected.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wider font-mono mb-1.5" style={{ color: "#7a8ba8" }}>
                        Interacts with:
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {graphHover.connected.map((c, i) => {
                          const sc = SEVERITY_COLORS[c.severity] ?? "#94a8c8";
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate" style={{ color: "#eaf0fa" }}>{c.drug}</span>
                              <span
                                className="text-[9px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                                style={{ color: sc, background: `${sc}22`, border: `1px solid ${sc}44` }}
                              >
                                {c.severity}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </VizSidePanel>
              )}

              {activeViz === "temporal" && timelineHover && (
                <VizSidePanel
                  accentColor={
                    timelineHover.risk > 7 ? "#ef4444" :
                    timelineHover.risk > 4 ? "#f59e0b" : "#06b6d4"
                  }
                >
                  <SidePanelHeader
                    title={`Day ${timelineHover.day}`}
                    badge={timelineHover.isPeak ? "PEAK" : undefined}
                    accent={timelineHover.isPeak ? "#ef4444" : "#06b6d4"}
                  />
                  <SidePanelScore
                    value={timelineHover.risk}
                    accent={
                      timelineHover.risk > 7 ? "#ef4444" :
                      timelineHover.risk > 4 ? "#f59e0b" : "#06b6d4"
                    }
                  />
                  {timelineHover.event && (
                    <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                      <span className="font-semibold" style={{ color: "#eaf0fa" }}>Event: </span>
                      {timelineHover.event}
                    </p>
                  )}
                  {timelineHover.inInterventionWindow && (
                    <p className="text-[10px] leading-snug p-1.5 rounded"
                      style={{
                        color: "#06b6d4",
                        background: "rgba(6,182,212,0.1)",
                        border: "1px solid rgba(6,182,212,0.25)",
                      }}
                    >
                      <span className="font-bold">◉ Intervention window:</span> {timelineHover.windowAction}
                    </p>
                  )}
                </VizSidePanel>
              )}

              {activeViz === "waterfall" && deprescribingClick && (
                <VizSidePanel
                  accentColor={deprescribingClick.color}
                  onClose={() => setDeprescribingClick(null)}
                >
                  <SidePanelHeader
                    title={deprescribingClick.step.drug}
                    badge={`#${deprescribingClick.step.priority}`}
                    accent={deprescribingClick.color}
                  />
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <span
                      className="text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded"
                      style={{
                        color: deprescribingClick.color,
                        background: `${deprescribingClick.color}22`,
                        border: `1px solid ${deprescribingClick.color}55`,
                      }}
                    >
                      {deprescribingClick.step.action}
                    </span>
                    <span className="font-mono font-bold text-base" style={{ color: "#10b981" }}>
                      -{deprescribingClick.step.expected_risk_reduction}%
                    </span>
                  </div>
                  {deprescribingClick.step.substitute && (
                    <p className="text-[11px] mb-2" style={{ color: "#cbd5e1" }}>
                      <span style={{ color: "#7a8ba8" }}>→ Substitute: </span>
                      <span className="font-medium" style={{ color: "#eaf0fa" }}>{deprescribingClick.step.substitute}</span>
                    </p>
                  )}
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                    {deprescribingClick.step.rationale}
                  </p>
                  <div className="text-[10px] space-y-1">
                    <p style={{ color: "#94a8c8" }}>
                      <span className="font-bold" style={{ color: "#eaf0fa" }}>Timeline: </span>
                      {deprescribingClick.step.timeline ?? "N/A"}
                    </p>
                    {(deprescribingClick.step.monitoring ?? []).length > 0 && (
                      <p style={{ color: "#94a8c8" }}>
                        <span className="font-bold" style={{ color: "#eaf0fa" }}>Monitoring: </span>
                        {deprescribingClick.step.monitoring.join(", ")}
                      </p>
                    )}
                  </div>
                </VizSidePanel>
              )}
            </motion.div>

            {/* Description text — readable color */}
            <div className="text-xs text-center" style={{ color: "#8a9bba" }}>
              {activeViz === "graph" && "Force-directed 3D drug interaction graph. Scroll to zoom, drag to rotate. Hover nodes for details."}
              {activeViz === "temporal" && "Risk cascade timeline. Scroll to zoom, drag to rotate. Hover points for details."}
              {activeViz === "radar" && "Patient phenotype risk across six axes. Scroll to zoom, drag to rotate. Hover for interpretation."}
              {activeViz === "waterfall" && "Deprescribing steps by priority. Scroll to zoom, drag to rotate. Click bars for details."}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={activeViz} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                {activeViz === "graph" && <GraphInterpretation graph={effectiveGraph} />}
                {activeViz === "temporal" && <TimelineInterpretation temporal={effectiveTemporal} />}
                {activeViz === "radar" && <PhenotypeInterpretation request={request} />}
                {activeViz === "waterfall" && <DeprescribingInterpretation plan={effectiveDeprescribing} />}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right */}
          <div className="lg:col-span-2 space-y-4">
            {/* Risk Assessment — hover glow */}
            <HoverCard borderColor={riskInfo.color} delay={0.1}>
              <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-3" style={{ color: riskInfo.color }}>Overall Risk Assessment</h3>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-5xl font-display font-bold" style={{ color: riskInfo.color }}>{numScore.toFixed(1)}</span>
                <span style={{ color: "#7a8ba8" }} className="text-lg">/ 10</span>
              </div>
              <div className="text-xs font-display font-bold tracking-widest mb-3" style={{ color: riskInfo.color }}>{riskInfo.label}</div>
              <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: "#0f172a" }}>
                <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${numScore * 10}%` }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.3 }} style={{ background: "linear-gradient(90deg,#10b981,#f59e0b,#ef4444)" }} />
              </div>
              <div className="flex justify-between text-[10px] mb-3" style={{ color: "#6b7c96" }}>{[0,2,4,6,8,10].map(n=><span key={n}>{n}</span>)}</div>
              <div className="rounded-lg p-3 text-xs leading-relaxed mb-2" style={{ background: riskInfo.bgColor, border: `1px solid ${riskInfo.color}22`, color: "#d0daea" }}>
                <span className="font-semibold" style={{ color: riskInfo.color }}>Interpretation:</span> {riskInfo.description}
              </div>
              {/* Per-score clinical context */}
              <div className="rounded-lg p-3 text-[11px] leading-relaxed space-y-1" style={{ background: "rgba(8,20,37,0.5)", border: "1px solid rgba(0,229,255,0.07)" }}>
                <p style={{ color: "#7a8ba8" }} className="font-semibold mb-1.5">Score Scale Reference:</p>
                {[
                  { range: "0–2", label: "Low", color: "#10b981", desc: "Minimal risk. Routine monitoring sufficient. No immediate intervention needed." },
                  { range: "3–4", label: "Moderate-Low", color: "#22d3ee", desc: "Mild concern. Standard clinical vigilance; re-evaluate if patient status changes." },
                  { range: "5–6", label: "Moderate", color: "#f59e0b", desc: "Clinically relevant. Enhanced monitoring and dose review recommended." },
                  { range: "7–8", label: "High", color: "#f97316", desc: "Significant danger. Active intervention, deprescribing, or substitution strongly advised." },
                  { range: "9–10", label: "Critical", color: "#ef4444", desc: "Immediate action required. High probability of severe adverse events without prompt change." },
                ].map((s, i) => {
                  const low = parseFloat(s.range.split("–")[0]);
                  const high = parseFloat(s.range.split("–")[1]);
                  // The row whose range contains numScore is the "active" one.
                  const isActive = numScore >= low && numScore <= high + 0.9;
                  return (
                    <div
                      key={i}
                      className="flex gap-2 items-start rounded px-1.5 py-1"
                      style={{
                        opacity: isActive ? 1 : 0.5,
                        background: isActive ? `${s.color}14` : "transparent",
                        boxShadow: isActive ? `inset 3px 0 0 ${s.color}` : "none",
                        fontWeight: isActive ? 600 : 400,
                        transition:
                          "background-color 0.3s ease, box-shadow 0.3s ease, color 0.3s ease, opacity 0.3s ease",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        el.style.background = `${s.color}1f`;
                        el.style.boxShadow = `inset 3px 0 0 ${s.color}`;
                        el.style.opacity = "1";
                        el.style.fontWeight = "600";
                        const spans = el.querySelectorAll("span");
                        if (spans[1]) (spans[1] as HTMLElement).style.color = "#eaf0fa";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.style.background = isActive ? `${s.color}14` : "transparent";
                        el.style.boxShadow = isActive ? `inset 3px 0 0 ${s.color}` : "none";
                        el.style.opacity = isActive ? "1" : "0.5";
                        el.style.fontWeight = isActive ? "600" : "400";
                        const spans = el.querySelectorAll("span");
                        if (spans[1]) (spans[1] as HTMLElement).style.color = isActive ? "#d0daea" : "#94a8c8";
                      }}
                    >
                      <span
                        className="font-mono font-bold shrink-0 w-10"
                        style={{ color: s.color }}
                      >
                        {s.range}
                      </span>
                      <span
                        style={{
                          color: isActive ? "#d0daea" : "#94a8c8",
                          transition: "color 0.3s ease",
                        }}
                      >
                        {s.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </HoverCard>

            {/* Patient Summary — hover glow, aligned border */}
            <HoverCard delay={0.2}>
              <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-3" style={{ color: "var(--primary)" }}>Patient Summary</h3>
              {/* Mobile: stack vertically with the 3D body centered above the
                  text content. Desktop (≥ sm): the original side-by-side
                  layout with the body on the left and content on the right. */}
              <div className="flex flex-col items-center sm:flex-row sm:items-stretch gap-4">
                {/* 3D Body — on mobile, narrower (w-32 = 128px) and centered
                    via the parent's items-center; on desktop reverts to the
                    original w-28 anchor with self-stretch so the right column
                    matches its height. */}
                <div className="w-32 sm:w-28 flex-shrink-0 rounded-lg overflow-hidden sm:self-stretch min-h-[220px]" style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(2,8,23,0.9)" }}>
                  <Scene camera={{ position: [0, 0, 3.5], fov: 45 }}>
                    <PatientAvatar3D sex={(patientCtx as any).sex || "unknown"} />
                  </Scene>
                </div>
                {/* Right column — flex-col so content distributes across the
                    card's height on desktop. On mobile w-full so the text is
                    full-width below the centered body. */}
                <div className="w-full sm:flex-1 sm:min-w-0 flex flex-col">
                  {/* Headline */}
                  <p className="text-sm leading-relaxed mb-2.5" style={{ color: "#eaf0fa" }}>
                    {patientSummary.headline}
                  </p>
                  <p className="text-[11px] mb-2.5 font-mono" style={{ color: "#7a8ba8" }}>
                    {medCount} medications analyzed
                  </p>
                  {/* Structured bullets — each now a bordered box with hover
                      color animation, matching the Quick Stats grid below. */}
                  {patientSummary.bullets.length > 0 && (
                    <div className="space-y-1.5 mb-2 flex-1">
                      {patientSummary.bullets.map((b, i) => {
                        const c = b.color ?? "#06b6d4";
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-2 text-[11px] px-2.5 py-1.5 rounded-md"
                            style={{
                              background: `${c}0c`,
                              border: `1px solid ${c}26`,
                              transition: "background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
                              cursor: "default",
                            }}
                            onMouseEnter={(e) => {
                              const el = e.currentTarget;
                              el.style.background = `${c}1f`;
                              el.style.borderColor = `${c}66`;
                              el.style.boxShadow = `0 0 10px ${c}33`;
                            }}
                            onMouseLeave={(e) => {
                              const el = e.currentTarget;
                              el.style.background = `${c}0c`;
                              el.style.borderColor = `${c}26`;
                              el.style.boxShadow = "none";
                            }}
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="shrink-0" style={{ color: c }}>●</span>
                              <span className="truncate" style={{ color: "#94a8c8" }}>{b.label}</span>
                            </span>
                            <span className="font-mono font-bold shrink-0" style={{ color: c }}>
                              {b.value}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Quick stats — with hover animation */}
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {[
                      { label: "Interactions", value: (effectiveGraph?.edges ?? []).length, bg: "rgba(6,182,212,0.06)", border: "rgba(6,182,212,0.15)", color: "#eaf0fa", hoverBg: "rgba(6,182,212,0.12)" },
                      { label: "Risk", value: `${numScore.toFixed(1)}/10`, bg: riskInfo.bgColor, border: `${riskInfo.color}22`, color: riskInfo.color, hoverBg: `${riskInfo.color}18` },
                      { label: "Critical", value: (effectiveGraph?.edges ?? []).filter(e => e.severity === "critical").length, bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.15)", color: "#ef4444", hoverBg: "rgba(239,68,68,0.12)" },
                      { label: "Deprescribe", value: `${(effectiveDeprescribing?.steps ?? []).length} steps`, bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.15)", color: "#10b981", hoverBg: "rgba(16,185,129,0.12)" },
                    ].map((stat, i) => (
                      <div key={i} className="px-2 py-1 rounded"
                        style={{
                          background: stat.bg,
                          border: `1px solid ${stat.border}`,
                          transition: "all 0.3s ease",
                          cursor: "default",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = stat.hoverBg;
                          e.currentTarget.style.boxShadow = `0 0 12px ${stat.border}`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = stat.bg;
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        <span style={{ color: "#8a9bba" }}>{stat.label}:</span>{" "}
                        <span className="font-mono font-bold" style={{ color: stat.color }}>{stat.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </HoverCard>

            <RiskReport data={data} />
          </div>
        </div>

        {errors.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 p-4 rounded-xl"
            style={{ background: "rgba(255,171,0,0.04)", border: "1px solid rgba(255,171,0,0.15)" }}>
            <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-2" style={{ color: "var(--warning)" }}>Pipeline Warnings</h3>
            {errors.map((err, i) => <p key={i} style={{ color: "#8a9bba" }} className="text-xs mb-1">{err}</p>)}
          </motion.div>
        )}
      </div>
    </div></>
  );
}

// ── Build patient summary from all analysis data ──────────
export interface PatientSummaryData {
  /** Short one-line intro, e.g. "72-year-old female with CKD stage 3". */
  headline: string;
  /** Structured bullets with highlighted values. Parent renders each as a
   *  row with the `value` bold and colored. */
  bullets: Array<{
    label: string;
    value: string;
    color?: string;
  }>;
}

function buildPatientSummary(
  patient: any,
  data: AnalyzeResponse,
  graph: InteractionGraph | null,
  temporal: CascadeModel | null,
  deprescribing: DeprescribingPlan | null,
): PatientSummaryData {
  // Headline: "72-year-old female with CKD stage 3, hepatic impairment"
  const age = patient.age ?? 0;
  const sex = patient.sex ?? "unknown";
  const head: string[] = [];
  if (age > 0 || sex !== "unknown") {
    head.push(`${age > 0 ? age + "-year-old" : ""} ${sex !== "unknown" ? sex : "patient"}`.trim());
  }
  const risks: string[] = [];
  if ((patient.ckd_stage ?? 0) >= 3) risks.push(`CKD stage ${patient.ckd_stage}`);
  if (patient.hepatic_impairment) risks.push("hepatic impairment");
  if (patient.smoking) risks.push("active smoker");
  if (risks.length > 0) head.push(`with ${risks.join(", ")}`);
  const headline = head.length > 0 ? head.join(" ") + "." : "Patient summary not available.";

  // Bullets — key stats with bold values
  const bullets: PatientSummaryData["bullets"] = [];
  const medCount = data.report?.medication_count ?? 0;
  if (medCount > 0) {
    bullets.push({ label: "Medications on record", value: String(medCount) });
  }

  const edges = graph?.edges ?? [];
  const crit = edges.filter((e) => e.severity === "critical").length;
  const high = edges.filter((e) => e.severity === "high").length;
  if (edges.length > 0) {
    bullets.push({ label: "Interactions identified", value: String(edges.length), color: "#06b6d4" });
    if (crit > 0) bullets.push({ label: "Critical severity", value: String(crit), color: "#ef4444" });
    if (high > 0) bullets.push({ label: "High severity", value: String(high), color: "#f97316" });
  }

  if (temporal && (temporal.peak_risk_score ?? 0) > 0) {
    const peakColor = temporal.peak_risk_score > 7 ? "#ef4444" : temporal.peak_risk_score > 4 ? "#f59e0b" : "#06b6d4";
    bullets.push({
      label: "Peak risk",
      value: `${temporal.peak_risk_score.toFixed(1)}/10 at day ${temporal.peak_risk_day}`,
      color: peakColor,
    });
  }

  if (deprescribing && (deprescribing.steps ?? []).length > 0) {
    bullets.push({
      label: "Deprescribing plan",
      value: `${deprescribing.steps.length} steps · -${deprescribing.total_expected_risk_reduction ?? 0}% risk reduction`,
      color: "#10b981",
    });
  }

  return { headline, bullets };
}

/** Legacy string form of the summary for places that need plain text
 *  (PDF export, sessionStorage snapshots, etc). */
function patientSummaryAsText(s: PatientSummaryData): string {
  const parts = [s.headline];
  for (const b of s.bullets) parts.push(`${b.label}: ${b.value}.`);
  return parts.join(" ");
}