/**
 * ARIA Shared TypeScript Types — mirrors the agent/MCP server schemas.
 */

// ── Enums ───────────────────────────────────────────────────

export type Severity = "low" | "moderate" | "high" | "critical";
export type EvidenceGrade = "A" | "B" | "C" | "D";
export type DeprescribingAction = "discontinue" | "reduce" | "substitute";

// ── Drug ────────────────────────────────────────────────────

export interface Drug {
  name: string;
  rxcui?: string;
  dose?: string;
  frequency?: string;
  indication?: string;
}

// ── Patient ─────────────────────────────────────────────────

export interface PatientContext {
  age: number;
  sex: string;
  weight_kg?: number;
  height_cm?: number;
  ckd_stage: number;
  hepatic_impairment: boolean;
  smoking: boolean;
  alcohol_use: string;
  comorbidities: string[];
  allergies: string[];
}

// ── Interactions ────────────────────────────────────────────

export interface Interaction {
  id: string;
  drugs: string[];
  severity: Severity;
  interaction_type: string;
  description: string;
  mechanism?: string;
  clinical_significance?: string;
  evidence_grade?: EvidenceGrade;
  confidence_score?: number;
  pubmed_ids: string[];
  mechanism_detail?: MechanisticExplanation;
}

export interface InteractionReport {
  interactions: Interaction[];
  total_interactions: number;
  critical_count: number;
  high_count: number;
  summary: string;
}

export interface MechanismPathway {
  pathway_name: string;
  description: string;
  enzymes_involved: string[];
  effect: string;
}

export interface MechanisticExplanation {
  drug_a: string;
  drug_b: string;
  mechanism_type: string;
  pathways: MechanismPathway[];
  clinical_consequence: string;
  management_recommendation: string;
}

// ── Graph ───────────────────────────────────────────────────

export interface GraphNode {
  drug_name: string;
  rxcui?: string;
  degree: number;
  is_hub: boolean;
  hub_score: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  severity: Severity;
  interaction_type: string;
  weight: number;
}

export interface EmergentInteraction {
  drugs: string[];
  description: string;
  mechanism: string;
  severity: Severity;
}

export interface InteractionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hub_drugs: string[];
  emergent_interactions: EmergentInteraction[];
  total_edges: number;
  graph_density: number;
}

// ── Risk ────────────────────────────────────────────────────

export interface RiskFactor {
  factor: string;
  multiplier: number;
  explanation: string;
}

export interface RiskScore {
  interaction_id: string;
  drugs: string[];
  base_score: number;
  adjusted_score: number;
  risk_factors: RiskFactor[];
  reasoning: string;
}

export interface DrugContribution {
  drug_name: string;
  contribution: number;
  note: string;
}

export interface BurdenDetail {
  total_score: number;
  risk_level: string;
  per_drug: DrugContribution[];
  clinical_implication: string;
}

export interface BurdenScores {
  anticholinergic_burden: BurdenDetail;
  sedation_load: BurdenDetail;
  qt_prolongation_risk: BurdenDetail;
  total_burden_summary: string;
}

// ── Temporal ────────────────────────────────────────────────

export interface DailyRisk {
  day: number;
  risk_score: number;
  key_event?: string;
}

export interface InterventionWindow {
  day_start: number;
  day_end: number;
  action: string;
  urgency: string;
}

export interface CascadeModel {
  drugs: string[];
  timeline_days: number;
  daily_risk: DailyRisk[];
  peak_risk_day: number;
  peak_risk_score: number;
  intervention_windows: InterventionWindow[];
  summary: string;
}

// ── Deprescribing ───────────────────────────────────────────

export interface DeprescribingStep {
  priority: number;
  drug: string;
  action: DeprescribingAction;
  substitute?: string;
  monitoring: string[];
  expected_risk_reduction: number;
  timeline: string;
  rationale: string;
}

export interface DeprescribingPlan {
  steps: DeprescribingStep[];
  total_expected_risk_reduction: number;
  summary: string;
  warnings: string[];
}

// ── Report ──────────────────────────────────────────────────

export interface ClinicalReport {
  patient_summary: string;
  medication_count: number;
  interaction_summary: string;
  critical_findings: string[];
  risk_scores: RiskScore[];
  burden_scores?: BurdenScores;
  temporal_summary?: string;
  deprescribing_plan?: DeprescribingPlan;
  evidence_citations: string[];
  overall_risk_level: string;
  report_text: string;
}

// ── API ─────────────────────────────────────────────────────

export interface AnalyzeRequest {
  medications: string[] | Drug[];
  patient?: PatientContext;
}

export interface AnalyzeResponse {
  report: ClinicalReport | null;
  interaction_graph: InteractionGraph | null;
  temporal_model: CascadeModel | null;
  deprescribing_plan: DeprescribingPlan | null;
  raw_interactions: InteractionReport | null;
  errors: string[];
}
