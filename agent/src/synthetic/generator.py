"""Synthetic patient data generator for ARIA demos and testing.

All data is 100% synthetic. No real PHI is used.
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any


# Common drug lists for polypharmacy scenarios
DRUG_POOL = [
    "warfarin", "aspirin", "omeprazole", "metformin", "amlodipine",
    "simvastatin", "lisinopril", "clopidogrel", "furosemide", "digoxin",
    "amitriptyline", "diphenhydramine", "oxybutynin", "gabapentin",
    "fluconazole", "metoprolol", "losartan", "hydrochlorothiazide",
    "atorvastatin", "levothyroxine", "prednisone", "ciprofloxacin",
    "tramadol", "sertraline", "alprazolam", "ibuprofen", "naproxen",
    "acetaminophen", "ranitidine", "pantoprazole", "duloxetine",
    "quetiapine", "risperidone", "haloperidol", "carbamazepine",
    "phenytoin", "valproic acid", "lithium", "spironolactone",
    "potassium chloride", "iron sulfate", "calcium carbonate",
    "fish oil", "vitamin D", "magnesium oxide",
]

COMORBIDITIES_POOL = [
    "hypertension", "type 2 diabetes", "atrial fibrillation",
    "heart failure", "COPD", "osteoarthritis", "depression",
    "anxiety", "chronic kidney disease", "hypothyroidism",
    "gout", "osteoporosis", "GERD", "insomnia",
    "peripheral neuropathy", "coronary artery disease",
]

ALLERGY_POOL = [
    "penicillin", "sulfa", "codeine", "NSAIDs", "latex",
    "iodine", "aspirin", "cephalosporins",
]


class SyntheticPatientGenerator:
    """Generate synthetic patient profiles and medication lists."""

    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)

    def generate_patient(self, patient_id: str | None = None) -> dict[str, Any]:
        """Generate a single synthetic patient profile."""

        age = self.rng.choices(
            population=range(18, 96),
            weights=[1] * 47 + [2] * 15 + [3] * 10 + [2] * 6,  # skew older
            k=1,
        )[0]

        sex = self.rng.choice(["male", "female"])
        ckd_stage = self.rng.choices([0, 0, 0, 1, 2, 3, 4, 5], k=1)[0]
        if age > 70:
            ckd_stage = self.rng.choices([0, 1, 2, 3, 3, 4], k=1)[0]

        n_comorbidities = self.rng.randint(1, 5)
        comorbidities = self.rng.sample(
            COMORBIDITIES_POOL,
            min(n_comorbidities, len(COMORBIDITIES_POOL)),
        )

        n_allergies = self.rng.choices([0, 0, 0, 1, 1, 2], k=1)[0]
        allergies = self.rng.sample(ALLERGY_POOL, n_allergies) if n_allergies else []

        weight = round(self.rng.gauss(72 if sex == "male" else 65, 12), 1)
        height = round(self.rng.gauss(175 if sex == "male" else 162, 8), 1)

        return {
            "id": patient_id or f"patient_{self.rng.randint(1000, 9999)}",
            "age": age,
            "sex": sex,
            "weight_kg": max(40.0, weight),
            "height_cm": max(140.0, height),
            "ckd_stage": ckd_stage,
            "hepatic_impairment": self.rng.random() < 0.1,
            "smoking": self.rng.random() < 0.2,
            "alcohol_use": self.rng.choice(["none", "none", "occasional", "moderate", "heavy"]),
            "comorbidities": comorbidities,
            "allergies": allergies,
        }

    def generate_medication_list(
        self,
        patient: dict[str, Any],
        min_drugs: int = 5,
        max_drugs: int = 10,
    ) -> dict[str, Any]:
        """Generate a medication list for a patient."""

        n_drugs = self.rng.randint(min_drugs, max_drugs)
        drugs = self.rng.sample(DRUG_POOL, min(n_drugs, len(DRUG_POOL)))

        medications = []
        for drug in drugs:
            medications.append({
                "name": drug,
                "dose": self._generate_dose(drug),
                "frequency": self.rng.choice([
                    "once daily", "twice daily", "three times daily", "as needed",
                ]),
            })

        return {
            "patient_id": patient["id"],
            "medications": medications,
        }

    def _generate_dose(self, drug_name: str) -> str:
        """Generate a plausible dose for a drug."""
        dose_map = {
            "warfarin": "5mg", "aspirin": "81mg", "omeprazole": "20mg",
            "metformin": "500mg", "amlodipine": "5mg", "simvastatin": "40mg",
            "lisinopril": "10mg", "clopidogrel": "75mg", "furosemide": "40mg",
            "digoxin": "0.125mg", "amitriptyline": "25mg", "gabapentin": "300mg",
            "metoprolol": "50mg", "atorvastatin": "20mg", "sertraline": "50mg",
            "ibuprofen": "400mg", "acetaminophen": "500mg",
        }
        return dose_map.get(drug_name, f"{self.rng.choice([5, 10, 25, 50, 100, 250, 500])}mg")

    def generate_patients(self, n: int = 10) -> list[dict[str, Any]]:
        """Generate multiple patient profiles."""
        return [
            self.generate_patient(f"patient_{str(i + 1).zfill(3)}")
            for i in range(n)
        ]

    def generate_medication_lists(
        self,
        patients: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Generate medication lists for a set of patients."""
        return [self.generate_medication_list(p) for p in patients]


def generate_fixtures():
    """Generate and save fixture files."""
    gen = SyntheticPatientGenerator(seed=42)

    patients = gen.generate_patients(10)
    med_lists = gen.generate_medication_lists(patients)

    fixtures_dir = Path(__file__).parent / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    with open(fixtures_dir / "patients.json", "w") as f:
        json.dump(patients, f, indent=2)

    with open(fixtures_dir / "medications.json", "w") as f:
        json.dump(med_lists, f, indent=2)

    return patients, med_lists


if __name__ == "__main__":
    patients, meds = generate_fixtures()
    print(f"Generated {len(patients)} patients and {len(meds)} medication lists")
