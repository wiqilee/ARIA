"""Pydantic models for all ARIA MCP tool inputs and outputs."""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ───────────────────────────────────────────────────


class Severity(str, Enum):
    LOW = "low"
    MODERATE = "moderate"
    HIGH = "high"
    CRITICAL = "critical"


class EvidenceGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class DeprescribingAction(str, Enum):
    DISCONTINUE = "discontinue"
    REDUCE = "reduce"
    SUBSTITUTE = "substitute"


# ── Drug Models ─────────────────────────────────────────────


class Drug(BaseModel):
    name: str
    rxcui: Optional[str] = None
    dose: Optional[str] = None
    frequency: Optional[str] = None
    indication: Optional[str] = None


class NormalizedDrug(BaseModel):
    name: str
    rxcui: str
    normalized_name: str
    dose: Optional[str] = None
    frequency: Optional[str] = None
    indication: Optional[str] = None


# ── Patient Models ──────────────────────────────────────────


class PatientContext(BaseModel):
    age: int = 50
    sex: str = "unknown"
    weight_kg: Optional[float] = None
    height_cm: Optional[float] = None
    ckd_stage: int = 0
    hepatic_impairment: bool = False
    smoking: bool = False
    alcohol_use: str = "none"
    comorbidities: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)


class PatientPhenotype(BaseModel):
    age: int
    sex: str
    weight_kg: Optional[float] = None
    ckd_stage: int = 0
    hepatic_impairment: bool = False
    smoking: bool = False


# ── Interaction Models ──────────────────────────────────────


class Interaction(BaseModel):
    id: str
    drugs: list[str]
    severity: Severity
    interaction_type: str
    description: str
    mechanism: Optional[str] = None
    clinical_significance: Optional[str] = None
    evidence_grade: Optional[EvidenceGrade] = None
    confidence_score: Optional[float] = None
    pubmed_ids: list[str] = Field(default_factory=list)


class InteractionReport(BaseModel):
    interactions: list[Interaction]
    total_interactions: int
    critical_count: int
    high_count: int
    summary: str


class MechanismPathway(BaseModel):
    pathway_name: str
    description: str
    enzymes_involved: list[str] = Field(default_factory=list)
    effect: str


class MechanisticExplanation(BaseModel):
    drug_a: str
    drug_b: str
    mechanism_type: str
    pathways: list[MechanismPathway] = Field(default_factory=list)
    clinical_consequence: str
    management_recommendation: str


# ── Graph Models ────────────────────────────────────────────


class GraphNode(BaseModel):
    drug_name: str
    rxcui: Optional[str] = None
    degree: int = 0
    is_hub: bool = False
    hub_score: float = 0.0


class GraphEdge(BaseModel):
    source: str
    target: str
    severity: Severity
    interaction_type: str
    weight: float = 1.0


class EmergentInteraction(BaseModel):
    drugs: list[str]
    description: str
    mechanism: str
    severity: Severity


class InteractionGraph(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    hub_drugs: list[str] = Field(default_factory=list)
    emergent_interactions: list[EmergentInteraction] = Field(default_factory=list)
    total_edges: int = 0
    graph_density: float = 0.0


# ── Risk Models ─────────────────────────────────────────────


class RiskFactor(BaseModel):
    factor: str
    multiplier: float
    explanation: str


class RiskScore(BaseModel):
    interaction_id: str
    drugs: list[str]
    base_score: float
    adjusted_score: float
    risk_factors: list[RiskFactor] = Field(default_factory=list)
    reasoning: str


class DrugContribution(BaseModel):
    drug_name: str
    contribution: float
    note: str


class BurdenDetail(BaseModel):
    total_score: float
    risk_level: str
    per_drug: list[DrugContribution] = Field(default_factory=list)
    clinical_implication: str


class BurdenScores(BaseModel):
    anticholinergic_burden: BurdenDetail
    sedation_load: BurdenDetail
    qt_prolongation_risk: BurdenDetail
    total_burden_summary: str


class DailyRisk(BaseModel):
    day: int
    risk_score: float
    key_event: Optional[str] = None


class InterventionWindow(BaseModel):
    day_start: int
    day_end: int
    action: str
    urgency: str


class CascadeModel(BaseModel):
    drugs: list[str]
    timeline_days: int
    daily_risk: list[DailyRisk] = Field(default_factory=list)
    peak_risk_day: int
    peak_risk_score: float
    intervention_windows: list[InterventionWindow] = Field(default_factory=list)
    summary: str


class DeprescribingStep(BaseModel):
    priority: int
    drug: str
    action: str
    substitute: Optional[str] = None
    monitoring: list[str] = Field(default_factory=list)
    expected_risk_reduction: float
    timeline: str
    rationale: str


class DeprescribingPlan(BaseModel):
    steps: list[DeprescribingStep] = Field(default_factory=list)
    total_expected_risk_reduction: float
    summary: str
    warnings: list[str] = Field(default_factory=list)


# ── Alternative Models ──────────────────────────────────────


class Alternative(BaseModel):
    drug_name: str
    reason: str
    trade_offs: str
    evidence_support: str


class Alternatives(BaseModel):
    original_drug: str
    removal_reason: str
    alternatives: list[Alternative] = Field(default_factory=list)


# ── Report Models ───────────────────────────────────────────


class ClinicalReport(BaseModel):
    patient_summary: str
    medication_count: int
    interaction_summary: str
    critical_findings: list[str] = Field(default_factory=list)
    risk_scores: list[RiskScore] = Field(default_factory=list)
    burden_scores: Optional[BurdenScores] = None
    temporal_summary: Optional[str] = None
    deprescribing_plan: Optional[DeprescribingPlan] = None
    evidence_citations: list[str] = Field(default_factory=list)
    overall_risk_level: str
    report_text: str


class PubMedCitation(BaseModel):
    pmid: str
    title: str
    authors: str
    journal: str
    year: str
    abstract_text: Optional[str] = None


# ── API Request/Response Models ─────────────────────────────


class AnalyzeRequest(BaseModel):
    medications: list[str] | list[Drug]
    patient: Optional[PatientContext] = None


class AnalyzeResponse(BaseModel):
    report: ClinicalReport
    interaction_graph: Optional[InteractionGraph] = None
    temporal_model: Optional[CascadeModel] = None
    deprescribing_plan: Optional[DeprescribingPlan] = None
    raw_interactions: Optional[InteractionReport] = None
