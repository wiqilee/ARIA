"""Appropriateness screening step: flag PIMs (Beers/STOPP) and omissions (START).

Calls the deterministic `screen_appropriateness` MCP tool with the medication
list and the patient's age + comorbidities. Runs in the parallel fan-out
alongside phenotype scoring, temporal modelling, evidence grading and renal
adjustment — it depends only on `normalized_drugs` and `patient`, which are
set before the fan-out.

Non-fatal: a failure is captured into `errors` and the rest of the pipeline
continues without an appropriateness section.
"""

from __future__ import annotations

import logging
from typing import Any

from mcp_client.client import MCPClient

logger = logging.getLogger(__name__)


def _as_dict(obj: Any) -> dict | None:
    """Coerce an MCP tool result (dict OR Pydantic model) into a plain dict.

    Mirrors the coercion in `renal_adjuster.py` / `report_builder.py`: the
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


async def appropriateness_screen(state: dict[str, Any]) -> dict[str, Any]:
    """Call MCP screen_appropriateness and attach the structured assessment."""
    drugs = state.get("normalized_drugs", [])
    patient = state.get("patient", {}) or {}
    mcp: MCPClient = state["mcp"]
    errors = state.get("errors", [])

    # Mirror the drug shape the other tools accept.
    drug_dicts = [{"name": d["name"]} for d in drugs if isinstance(d, dict) and d.get("name")]

    # The tool reads age + comorbidities. Send the full patient context and
    # make sure those two fields are present with sane defaults.
    patient_context = dict(patient)
    patient_context.setdefault("age", patient.get("age", 50))
    patient_context.setdefault("comorbidities", patient.get("comorbidities", []) or [])

    appropriateness = None
    if drug_dicts:
        try:
            result = await mcp.screen_appropriateness(drug_dicts, patient_context)
            appropriateness = _as_dict(result)
            if appropriateness:
                pim = appropriateness.get("pim_flags") or []
                omit = appropriateness.get("omissions") or []
                logger.info(
                    "Appropriateness: %d PIM flag(s), %d omission(s) at age %s",
                    len(pim),
                    len(omit),
                    patient_context.get("age"),
                )
        except Exception as e:
            logger.error("screen_appropriateness failed: %s", e)
            errors.append(f"Appropriateness screening failed: {e}")

    return {
        "appropriateness": appropriateness,
        "errors": errors,
    }
