"use client";

import type { PatientContext } from "@/lib/types";

interface PatientContextFormProps {
  value: PatientContext;
  onChange: (ctx: PatientContext) => void;
}

export function PatientContextForm({
  value,
  onChange,
}: PatientContextFormProps) {
  const update = (field: string, val: any) => {
    onChange({ ...value, [field]: val });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {/* Age */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            Age
          </label>
          <input
            type="number"
            min={0}
            max={120}
            value={value.age}
            onChange={(e) => update("age", parseInt(e.target.value) || 0)}
            className="w-full h-11 rounded-lg px-3 text-sm"
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </div>

        {/* Sex */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            Sex
          </label>
          <select
            value={value.sex}
            onChange={(e) => update("sex", e.target.value)}
            className="w-full h-11 rounded-lg px-3 text-sm"
          >
            <option value="unknown">—</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        {/* Weight */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            Weight (kg)
          </label>
          <input
            type="number"
            min={0}
            max={300}
            value={value.weight_kg ?? ""}
            onChange={(e) =>
              update(
                "weight_kg",
                e.target.value ? parseFloat(e.target.value) : undefined,
              )
            }
            placeholder="—"
            className="w-full h-11 rounded-lg px-3 text-sm"
            style={{ fontFamily: "var(--font-mono)" }}
          />
        </div>

        {/* CKD Stage */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            CKD Stage
          </label>
          <select
            value={value.ckd_stage}
            onChange={(e) => update("ckd_stage", parseInt(e.target.value))}
            className="w-full h-11 rounded-lg px-3 text-sm"
          >
            <option value={0}>None</option>
            <option value={1}>Stage 1</option>
            <option value={2}>Stage 2</option>
            <option value={3}>Stage 3</option>
            <option value={4}>Stage 4</option>
            <option value={5}>Stage 5</option>
          </select>
        </div>

        {/* Hepatic */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            Hepatic
          </label>
          <div className="flex gap-2">
            {[false, true].map((val) => (
              <button
                key={String(val)}
                onClick={() => update("hepatic_impairment", val)}
                className="flex-1 h-11 rounded-lg text-sm font-medium transition-all"
                style={{
                  background:
                    value.hepatic_impairment === val
                      ? val
                        ? "rgba(255, 23, 68, 0.1)"
                        : "var(--primary-dim)"
                      : "var(--surface)",
                  border: `1px solid ${
                    value.hepatic_impairment === val
                      ? val
                        ? "rgba(255, 23, 68, 0.3)"
                        : "rgba(0, 229, 255, 0.25)"
                      : "var(--border)"
                  }`,
                  color:
                    value.hepatic_impairment === val
                      ? val
                        ? "var(--danger)"
                        : "var(--primary)"
                      : "var(--text-muted)",
                  boxShadow:
                    value.hepatic_impairment === val
                      ? val
                        ? "0 0 12px rgba(255, 23, 68, 0.12)"
                        : "0 0 12px rgba(0, 229, 255, 0.1)"
                      : "none",
                }}
              >
                {val ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>

        {/* Smoking */}
        <div>
          <label
            className="text-xs mb-1.5 block uppercase tracking-wider"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--text-muted)",
            }}
          >
            Smoking
          </label>
          <div className="flex gap-2">
            {[false, true].map((val) => (
              <button
                key={String(val)}
                onClick={() => update("smoking", val)}
                className="flex-1 h-11 rounded-lg text-sm font-medium transition-all"
                style={{
                  background:
                    value.smoking === val
                      ? val
                        ? "rgba(255, 171, 0, 0.1)"
                        : "var(--primary-dim)"
                      : "var(--surface)",
                  border: `1px solid ${
                    value.smoking === val
                      ? val
                        ? "rgba(255, 171, 0, 0.3)"
                        : "rgba(0, 229, 255, 0.25)"
                      : "var(--border)"
                  }`,
                  color:
                    value.smoking === val
                      ? val
                        ? "var(--warning)"
                        : "var(--primary)"
                      : "var(--text-muted)",
                  boxShadow:
                    value.smoking === val
                      ? val
                        ? "0 0 12px rgba(255, 171, 0, 0.1)"
                        : "0 0 12px rgba(0, 229, 255, 0.1)"
                      : "none",
                }}
              >
                {val ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Comorbidities */}
      <div>
        <label
          className="text-xs mb-1.5 block uppercase tracking-wider"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--text-muted)",
          }}
        >
          Comorbidities (comma-separated)
        </label>
        <input
          type="text"
          value={value.comorbidities.join(", ")}
          onChange={(e) =>
            update(
              "comorbidities",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="e.g. hypertension, diabetes, atrial fibrillation"
          className="w-full h-11 rounded-lg px-3 text-sm"
        />
      </div>

      {/* Allergies */}
      <div>
        <label
          className="text-xs mb-1.5 block uppercase tracking-wider"
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--text-muted)",
          }}
        >
          Drug Allergies (comma-separated)
        </label>
        <input
          type="text"
          value={value.allergies.join(", ")}
          onChange={(e) =>
            update(
              "allergies",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder="e.g. penicillin, sulfa"
          className="w-full h-11 rounded-lg px-3 text-sm"
        />
      </div>
    </div>
  );
}
