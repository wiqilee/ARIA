# ARIA Synthetic Data Schema Reference

ARIA uses 100% synthetic patient data for all demonstrations and testing. No real Protected Health Information (PHI) is used anywhere in this system, in line with the hackathon's safety compliance requirements.

## Table of Contents

- [Patient Profile Schema](#patient-profile-schema)
- [Medication List Schema](#medication-list-schema)
- [Fixture Files](#fixture-files)
- [Generator](#generator)
- [Reproducibility](#reproducibility)

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
| `id` | string | Synthetic identifier, never a real medical record number |
| `age` | integer | Patient age in years, range 18 to 95 |
| `sex` | string | `male` or `female` |
| `weight_kg` | float | Body weight in kilograms |
| `height_cm` | float | Height in centimeters |
| `ckd_stage` | integer | Chronic kidney disease stage 0 to 5, where 0 means no CKD |
| `hepatic_impairment` | boolean | Whether the patient has any hepatic impairment |
| `smoking` | boolean | Current smoking status |
| `alcohol_use` | string | One of `none`, `occasional`, `moderate`, `heavy` |
| `comorbidities` | string[] | Diagnosed conditions in snake_case |
| `allergies` | string[] | Known drug or substance allergies |

## Medication List Schema

```json
{
  "patient_id": "patient_001",
  "medications": [
    {
      "name":       "warfarin",
      "rxcui":      "11289",
      "dose":       "5mg",
      "frequency":  "once daily",
      "indication": "atrial fibrillation"
    },
    {
      "name":       "aspirin",
      "rxcui":      "1191",
      "dose":       "81mg",
      "frequency":  "once daily",
      "indication": "cardiovascular prophylaxis"
    }
  ]
}
```

### Medication Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Drug name, generic preferred |
| `rxcui` | string | RxNorm Concept Unique Identifier. Optional, resolved at runtime via the RxNorm API when missing. |
| `dose` | string | Dosage with unit |
| `frequency` | string | Administration frequency |
| `indication` | string | Clinical reason for the medication |

## Fixture Files

| File | Contents |
|---|---|
| `agent/src/synthetic/fixtures/patients.json` | 10 synthetic patient profiles spanning diverse demographics, CKD stages, and comorbidity patterns |
| `agent/src/synthetic/fixtures/medications.json` | 50 medication lists designed to trigger a range of interaction types: pairwise, three-drug emergent, high anticholinergic burden, QT risk, and renal-pathway competition |

The fixtures power the **Quick Test** presets on the Vercel frontend. Anything you see when you click *72F CKD3*, *81M Cardiac*, or *65F Anticholinergic Burden* comes from these files.

## Generator

The synthetic data generator at `agent/src/synthetic/generator.py` can produce additional patient profiles on demand with configurable parameters for age range, CKD distribution, polypharmacy severity, and comorbidity patterns.

```python
from synthetic.generator import SyntheticPatientGenerator

gen = SyntheticPatientGenerator(seed=42)
patients  = gen.generate_patients(n=100)
med_lists = gen.generate_medication_lists(patients)
```

Constructor options:

| Parameter | Default | Description |
|---|---|---|
| `seed` | `None` | Seeds the underlying RNG. Pass an integer for reproducible output. |
| `min_age` | `18` | Minimum patient age. |
| `max_age` | `95` | Maximum patient age. |
| `ckd_distribution` | `weighted_elderly` | One of `uniform`, `none`, `weighted_elderly`. The `weighted_elderly` profile mirrors real-world prevalence in adults 60 and older. |
| `polypharmacy_target` | `random_5_to_12` | Number of concurrent medications per patient. Use `random_5_to_12` for the realistic polypharmacy band, or pass an integer for a fixed count. |

## Reproducibility

For reviewers and CI runs that need byte-identical output across runs, pass an explicit `seed`:

```python
gen = SyntheticPatientGenerator(seed=2026)
```

The same seed always produces the same set of patient profiles and medication lists. The fixtures shipped in the repo were generated with `seed=2026` and committed verbatim, so the demo presets are stable across deployments.