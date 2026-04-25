"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

const COMMON_DRUGS = [
  "warfarin", "aspirin", "omeprazole", "metformin", "amlodipine",
  "simvastatin", "lisinopril", "clopidogrel", "furosemide", "digoxin",
  "amitriptyline", "diphenhydramine", "oxybutynin", "gabapentin",
  "fluconazole", "metoprolol", "losartan", "hydrochlorothiazide",
  "atorvastatin", "levothyroxine", "prednisone", "ciprofloxacin",
  "tramadol", "sertraline", "alprazolam", "ibuprofen", "naproxen",
  "acetaminophen", "pantoprazole", "duloxetine", "quetiapine",
  "carbamazepine", "phenytoin", "valproic acid", "spironolactone",
  "fish oil", "vitamin D", "iron sulfate",
];

interface DrugInputProps {
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  index: number;
}

export function DrugInput({ value, onChange, onRemove, index }: DrugInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (text: string) => {
    onChange(text);
    if (text.length >= 2) {
      const filtered = COMMON_DRUGS.filter((d) =>
        d.toLowerCase().startsWith(text.toLowerCase()),
      ).slice(0, 6);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (drug: string) => {
    onChange(drug);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="relative flex items-center gap-2"
    >
      <span
        className="text-xs w-6 text-right shrink-0"
        style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
      >
        {index + 1}.
      </span>

      <div className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() =>
            value.length >= 2 &&
            suggestions.length > 0 &&
            setShowSuggestions(true)
          }
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Enter drug name..."
          className="w-full h-11 rounded-lg px-4 text-sm"
          style={{ fontFamily: "var(--font-mono)" }}
        />

        {/* Active indicator dot */}
        {value.trim() && (
          <div
            className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
            style={{
              background: "var(--success)",
              boxShadow: "0 0 8px var(--success)",
            }}
          />
        )}

        {/* Autocomplete dropdown */}
        <AnimatePresence>
          {showSuggestions && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute top-full left-0 right-0 mt-1 overflow-hidden z-50 rounded-lg"
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border-glow)",
                boxShadow:
                  "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 16px rgba(0, 229, 255, 0.08)",
              }}
            >
              {suggestions.map((drug) => (
                <button
                  key={drug}
                  onMouseDown={() => selectSuggestion(drug)}
                  className="w-full px-4 py-2.5 text-left text-sm transition-colors"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-secondary)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--primary-dim)";
                    e.currentTarget.style.color = "var(--primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--text-secondary)";
                  }}
                >
                  {drug}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        onClick={onRemove}
        className="h-11 w-11 rounded-lg flex items-center justify-center text-lg transition-all shrink-0"
        style={{
          background: "rgba(255, 23, 68, 0.05)",
          border: "1px solid rgba(255, 23, 68, 0.12)",
          color: "var(--text-muted)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 23, 68, 0.4)";
          e.currentTarget.style.color = "var(--danger)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 23, 68, 0.12)";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
        aria-label="Remove drug"
      >
        ×
      </button>
    </motion.div>
  );
}
