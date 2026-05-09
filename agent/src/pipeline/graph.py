"""LangGraph state machine for the ARIA clinical reasoning pipeline.

Pipeline stages:
  intake -> normalize -> graph_build -> [parallel fan-out] -> plan_generate -> report_build

The four middle stages (phenotype_score, temporal_model, evidence_grade,
and the burden computation inside phenotype_score) all consume the same
upstream inputs and never mutate shared state, so they run concurrently
via asyncio.gather() in a single fan-out node.

Expected wall-clock saving on a typical two-drug analysis:
    serial:   25 + 16 + 40 + 21 = ~102s
    parallel: max(25, 16, 40, 21) = ~40s
    total saved: ~62s (~177s -> ~115s, 35% reduction)
"""

from __future__ import annotations

import asyncio
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
    fhir_context: dict[str, Any]

    # After intake
    drugs: list[dict[str, Any]]
    patient: dict[str, Any]

    # After normalize
    normalized_drugs: list[dict[str, Any]]

    # After graph_build
    interactions: dict[str, Any]
    interaction_graph: dict[str, Any]

    # After parallel fan-out
    risk_scores: list[dict[str, Any]]
    temporal: dict[str, Any]
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


# ── Parallel Fan-out Node ───────────────────────────────────


async def _safe_node(node_func, state: dict, name: str, errors: list[str]) -> dict:
    """Run a pipeline node and capture exceptions into errors list.

    Returns an empty dict-merge on failure so the rest of the pipeline
    continues with whatever upstream state was already set.
    """
    try:
        return await node_func(state)
    except Exception as e:
        msg = f"{name} failed: {type(e).__name__}: {e}"
        logger.error(msg, exc_info=True)
        errors.append(msg)
        return {}


async def parallel_fanout(state: dict[str, Any]) -> dict[str, Any]:
    """Run phenotype_score, temporal_model, and evidence_grade concurrently.

    All three nodes consume the same upstream inputs (drugs, patient,
    interactions, interaction_graph) and never mutate shared state, so
    they can be launched in parallel. asyncio.gather() turns the longest
    of three into the wall-clock time, instead of the sum.

    Each node returns a dict-merge that LangGraph would normally apply
    automatically; we collect the three dicts and merge them into a
    single dict that LangGraph applies on return.

    A failure in one parallel node is captured and the other two still
    contribute their results, matching the pre-parallel behavior where
    one MCP error did not abort the whole analysis.
    """
    errors = list(state.get("errors", []))

    logger.info("Phase 2 fan-out: launching 3 parallel stages")

    # Each node receives its own shallow copy of the state. Because the
    # nodes do not mutate state in place (they return dict-merges),
    # the shallow copy is enough to keep them isolated.
    phenotype_task = _safe_node(phenotype_score, dict(state), "phenotype_score", errors)
    temporal_task = _safe_node(temporal_model, dict(state), "temporal_model", errors)
    evidence_task = _safe_node(evidence_grade, dict(state), "evidence_grade", errors)

    phenotype_out, temporal_out, evidence_out = await asyncio.gather(
        phenotype_task,
        temporal_task,
        evidence_task,
    )

    logger.info("Phase 2 fan-out: 3 parallel stages joined")

    # Merge all three node outputs into one dict-update for LangGraph.
    merged: dict[str, Any] = {}
    merged.update(phenotype_out)
    merged.update(temporal_out)
    merged.update(evidence_out)

    # Carry forward any errors collected during parallel execution
    if errors != state.get("errors", []):
        merged["errors"] = errors

    return merged


# ── Graph Builder ───────────────────────────────────────────


def build_pipeline() -> StateGraph:
    """Build and compile the LangGraph state machine.

    Topology:

        intake -> normalize -> graph_build -> parallel_fanout -> plan_generate -> report_build

    The parallel_fanout node internally runs phenotype_score,
    temporal_model, and evidence_grade concurrently via asyncio.gather().
    """
    graph = StateGraph(PipelineState)

    # Add nodes
    graph.add_node("intake", intake)
    graph.add_node("normalize", normalize)
    graph.add_node("graph_build", graph_build)
    graph.add_node("parallel_fanout", parallel_fanout)
    graph.add_node("plan_generate", plan_generate)
    graph.add_node("report_build", report_build)

    # Define edges
    graph.set_entry_point("intake")
    graph.add_edge("intake", "normalize")
    graph.add_edge("normalize", "graph_build")
    graph.add_edge("graph_build", "parallel_fanout")
    graph.add_edge("parallel_fanout", "plan_generate")
    graph.add_edge("plan_generate", "report_build")
    graph.add_edge("report_build", END)

    return graph.compile()


async def run_pipeline(
    medications: list[str | dict],
    patient_context: dict[str, Any] | None,
    mcp_client: MCPClient,
    fhir_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute the full ARIA pipeline and return the result.

    Parameters
    ----------
    medications : list[str | dict]
        Medication list as either strings or dicts. The intake node
        normalizes both shapes into a uniform list of drug dicts.
    patient_context : dict | None
        Patient context (age, sex, ckd_stage, etc.).
    mcp_client : MCPClient
        Async MCP client used by every node that calls the MCP server.
    fhir_context : dict | None
        Resolved FHIR context (patient_id, bearer_token, server_url,
        refresh_token, refresh_token_url). When provided, it is forwarded
        to the FHIR MCP tool so the medication list can be populated
        from the patient's EHR. When omitted, only the inline medications
        argument is used.
    """
    pipeline = build_pipeline()

    initial_state: PipelineState = {
        "raw_medications": medications,
        "patient_context": patient_context or {},
        "fhir_context": fhir_context or {},
        "mcp": mcp_client,
        "errors": [],
    }

    logger.info(
        "Starting ARIA pipeline with %d medications (parallel fan-out enabled)",
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