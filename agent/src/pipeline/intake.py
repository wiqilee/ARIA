"""Intake step: parse and validate the raw medication list and patient context."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def intake(state: dict[str, Any]) -> dict[str, Any]:
    """Parse raw medication input into structured Drug dicts."""

    raw_meds = state.get("raw_medications", [])
    patient_ctx = state.get("patient_context", {})
    errors = state.get("errors", [])

    drugs = []
    for med in raw_meds:
        if isinstance(med, str):
            # Simple string medication name
            drugs.append({
                "name": med.strip().lower(),
            })
        elif isinstance(med, dict):
            # Already structured
            drug = {"name": med.get("name", "").strip().lower()}
            if "rxcui" in med:
                drug["rxcui"] = med["rxcui"]
            if "dose" in med:
                drug["dose"] = med["dose"]
            if "frequency" in med:
                drug["frequency"] = med["frequency"]
            if "indication" in med:
                drug["indication"] = med["indication"]
            drugs.append(drug)
        else:
            errors.append(f"Invalid medication entry: {med}")

    # Validate patient context with defaults
    patient = {
        "age": patient_ctx.get("age", 50),
        "sex": patient_ctx.get("sex", "unknown"),
        "weight_kg": patient_ctx.get("weight_kg"),
        "height_cm": patient_ctx.get("height_cm"),
        "ckd_stage": patient_ctx.get("ckd_stage", 0),
        "hepatic_impairment": patient_ctx.get("hepatic_impairment", False),
        "smoking": patient_ctx.get("smoking", False),
        "alcohol_use": patient_ctx.get("alcohol_use", "none"),
        "comorbidities": patient_ctx.get("comorbidities", []),
        "allergies": patient_ctx.get("allergies", []),
    }

    if not drugs:
        errors.append("No valid medications provided")

    logger.info("Intake: %d drugs parsed, patient age=%d", len(drugs), patient["age"])

    return {
        "drugs": drugs,
        "patient": patient,
        "errors": errors,
    }
