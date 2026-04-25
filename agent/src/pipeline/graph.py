"""LangGraph state machine for the ARIA clinical reasoning pipeline.

Pipeline stages:
  intake -> normalize -> graph_build -> phenotype_score ->
  temporal_model -> evidence_grade -> plan_generate -> report_build
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from mcp_client.client import MCPClient
from pipeline.evidence_grader import evidence_grade
from pipeline.graph_builder import graph_build
from pipeline.intake import intake
from pipeline.normalize import normalize
from pipeline.phenotype_scorer import phenotype_score
from pipeline.plan_generator import plan_generate
from pipeline.report_builder import report_build
from pipeline.temporal_modeler import temporal_model

logger = logging.getLogger(__name__)


# ── Pipeline State ──────────────────────────────────────────


class PipelineState(TypedDict, total=False):
    """State passed through all pipeline stages."""

    # Input
    raw_medications: list[str | dict]
    patient_context: dict[str, Any]

    # After intake
    drugs: list[dict[str, Any]]
    patient: dict[str, Any]

    # After normalize
    normalized_drugs: list[dict[str, Any]]

    # After graph_build
    interactions: dict[str, Any]
    interaction_graph: dict[str, Any]

    # After phenotype_score
    risk_scores: list[dict[str, Any]]

    # After temporal_model
    temporal: dict[str, Any]

    # After evidence_grade
    evidence: list[dict[str, Any]]
    graded_interactions: list[dict[str, Any]]

    # After plan_generate
    deprescribing_plan: dict[str, Any]

    # After report_build
    report: dict[str, Any]

    # MCP client reference (not serialized)
    mcp: Any

    # Error tracking
    errors: list[str]


# ── Graph Builder ───────────────────────────────────────────


def build_pipeline() -> StateGraph:
    """Build and compile the LangGraph state machine."""

    graph = StateGraph(PipelineState)

    # Add nodes
    graph.add_node("intake", intake)
    graph.add_node("normalize", normalize)
    graph.add_node("graph_build", graph_build)
    graph.add_node("phenotype_score", phenotype_score)
    graph.add_node("temporal_model", temporal_model)
    graph.add_node("evidence_grade", evidence_grade)
    graph.add_node("plan_generate", plan_generate)
    graph.add_node("report_build", report_build)

    # Define edges (linear pipeline)
    graph.set_entry_point("intake")
    graph.add_edge("intake", "normalize")
    graph.add_edge("normalize", "graph_build")
    graph.add_edge("graph_build", "phenotype_score")
    graph.add_edge("phenotype_score", "temporal_model")
    graph.add_edge("temporal_model", "evidence_grade")
    graph.add_edge("evidence_grade", "plan_generate")
    graph.add_edge("plan_generate", "report_build")
    graph.add_edge("report_build", END)

    return graph.compile()


async def run_pipeline(
    medications: list[str | dict],
    patient_context: dict[str, Any] | None,
    mcp_client: MCPClient,
) -> dict[str, Any]:
    """Execute the full ARIA pipeline and return the result."""

    pipeline = build_pipeline()

    initial_state: PipelineState = {
        "raw_medications": medications,
        "patient_context": patient_context or {},
        "mcp": mcp_client,
        "errors": [],
    }

    logger.info(
        "Starting ARIA pipeline with %d medications",
        len(medications),
    )

    result = await pipeline.ainvoke(initial_state)

    logger.info("Pipeline complete. Errors: %d", len(result.get("errors", [])))

    return {
        "report": result.get("report"),
        "interaction_graph": result.get("interaction_graph"),
        "temporal_model": result.get("temporal"),
        "deprescribing_plan": result.get("deprescribing_plan"),
        "raw_interactions": result.get("interactions"),
        "errors": result.get("errors", []),
    }
