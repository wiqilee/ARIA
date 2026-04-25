# ARIA — Synthetic Data Schema Reference

ARIA uses 100% synthetic patient data for all demonstrations and testing. No real Protected Health Information (PHI) is used anywhere in this system.

---

## Patient Profile Schema

```json
{
  "id": "patient_001",
  "age": 72,
  "sex": "female",
  "weight_kg": 65.0,
  "height_cm": 160.0,
  "ckd_stage": 3,
  "hepatic_impairment": false,
  "smoking": false,
  "alcohol_use": "occasional",
  "comorbidities": ["hypertension", "atrial_fibrillation", "osteoarthritis"],
  "allergies": ["sulfa"]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique synthetic identifier |
| `age` | integer | Patient age in years (18–95) |
| `sex` | string | `"male"` or `"female"` |
| `weight_kg` | float | Body weight in kilograms |
| `height_cm` | float | Height in centimeters |
| `ckd_stage` | integer | Chronic kidney disease stage (0–5), 0 = no CKD |
| `hepatic_impairment` | boolean | Whether the patient has hepatic impairment |
| `smoking` | boolean | Current smoking status |
| `alcohol_use` | string | `"none"`, `"occasional"`, `"moderate"`, `"heavy"` |
| `comorbidities` | string[] | List of diagnosed conditions |
| `allergies` | string[] | Known drug allergies |

---

## Medication List Schema

```json
{
  "patient_id": "patient_001",
  "medications": [
    {
      "name": "warfarin",
      "rxcui": "11289",
      "dose": "5mg",
      "frequency": "once daily",
      "indication": "atrial fibrillation"
    },
    {
      "name": "aspirin",
      "rxcui": "1191",
      "dose": "81mg",
      "frequency": "once daily",
      "indication": "cardiovascular prophylaxis"
    }
  ]
}
```

### Medication Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Drug name (generic preferred) |
| `rxcui` | string | RxNorm Concept Unique Identifier (optional, resolved at runtime) |
| `dose` | string | Dosage with unit |
| `frequency` | string | Administration frequency |
| `indication` | string | Clinical reason for the medication |

---

## Fixture Files

- `agent/src/synthetic/fixtures/patients.json` — 10 synthetic patient profiles spanning diverse demographics, CKD stages, and comorbidity patterns
- `agent/src/synthetic/fixtures/medications.json` — 50 medication lists designed to trigger a range of interaction types (pairwise, three-drug emergent, high anticholinergic burden, QT risk, etc.)

---

## Generator

The synthetic data generator (`agent/src/synthetic/generator.py`) can produce additional patient profiles on demand with configurable parameters for age range, CKD distribution, polypharmacy severity, and comorbidity patterns.

```python
from synthetic.generator import SyntheticPatientGenerator

gen = SyntheticPatientGenerator(seed=42)
patients = gen.generate_patients(n=100)
med_lists = gen.generate_medication_lists(patients)
```
