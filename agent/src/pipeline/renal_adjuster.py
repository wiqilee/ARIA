"""Renal dosing step: flag drugs needing renal dose adjustment for the patient.

Calls the deterministic `assess_renal_dosing` MCP tool with the medication
list and the patient's CKD stage. Runs in the parallel fan-out alongside
phenotype scoring, temporal modelling, and evidence grading — it depends only
on `normalized_drugs` and `patient`, which are set before the fan-out.

Non-fatal: a failure is captured into `errors` and the rest of the pipeline
continues without a renal section.
"""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


def _as_dict(obj: Any) -> dict | None:
    """Coerce an MCP tool result (dict OR Pydantic model) into a plain dict.

    Mirrors the coercion in `phenotype_scorer.py` / `report_builder.py`: the
    MCP client may deserialise tool I/O into the Pydantic models in
    `mcp_client/schema.py`, and downstream code (report_builder, the artifact
    renderer in main.py) reads this like a dict.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj
    for attr in ("model_dump", "dict"):
        m = getattr(obj, attr, None)
        if callable(m):
            try:
                return m()
            except Exception:  # pragma: no cover - defensive
                pass
    if hasattr(obj, "__dict__"):
        try:
            return dict(vars(obj))
        except Exception:  # pragma: no cover - defensive
            pass
    return None


async def renal_adjust(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP assess_renal_dosing and attach the structured assessment."""
    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {}) or {}
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    # Send the full patient context (the tool reads ckd_stage). Mirror the
    # drug shape the other tools accept.
    drug_dicts = [{"name": d["name"]} for d in drugs if isinstance(d, dict) and d.get("name")]
    patient_context = dict(patient)
    patient_context.setdefault("ckd_stage", patient.get("ckd_stage", 0))

    renal_assessment = None
    if drug_dicts:
        try:
            result = await mcp.assess_renal_dosing(drug_dicts, patient_context)
            renal_assessment = _as_dict(result)
            if renal_assessment:
                flagged = renal_assessment.get("flagged") or []
                logger.info(
                    "Renal dosing: %d drug(s) flagged at CKD stage %s",
                    len(flagged),
                    patient_context.get("ckd_stage"),
                )
        except Exception as e:
            logger.error("assess_renal_dosing failed: %s", e)
            errors.append(f"Renal dosing assessment failed: {e}")

    return {
        "renal_assessment": renal_assessment,
        "errors": errors,
    }
