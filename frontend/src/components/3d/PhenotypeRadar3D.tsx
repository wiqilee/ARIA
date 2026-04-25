"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PatientContext } from "@/lib/types";

// Shape of the data emitted to the parent via onHoverAxis.
// Parent (page.tsx) renders an HTML side-panel using this payload, so the
// tooltip is never clipped by the 3D canvas.
export interface RadarHoverPayload {
  key: string;
  label: string;
  value: number; // 0-1, multiply by 10 for displayed score
  score: number; // 0-10
  riskLabel: "LOW" | "MODERATE" | "HIGH";
  color: string;
  explanation: string;
  action: string;
}

interface PhenotypeRadar3DProps {
  patient: PatientContext;
  riskMultipliers?: Record<string, number>;
  /** Called when the user hovers an axis point. `null` when no axis hovered. */
  onHoverAxis?: (payload: RadarHoverPayload | null) => void;
}

const AXES = [
  { key: "age", label: "Age", max: 100 },
  { key: "renal", label: "Renal", max: 5 },
  { key: "hepatic", label: "Hepatic", max: 1 },
  { key: "weight", label: "Weight", max: 120 },
  { key: "sex", label: "Sex Risk", max: 1 },
  { key: "smoking", label: "Smoking", max: 1 },
];

const RISK_EXPLANATIONS: Record<string, (v: number) => string> = {
  age: (v) =>
    v > 0.7 ? "Elderly — higher ADR risk, reduced clearance" : v > 0.4 ? "Middle-aged — moderate baseline" : "Young — lower baseline risk",
  renal: (v) =>
    v > 0.6 ? "Impaired clearance — dose adjustment needed" : v > 0.2 ? "Mild reduction — monitor closely" : "Normal renal function",
  hepatic: (v) => (v > 0.5 ? "Impaired metabolism — altered drug exposure" : "Normal hepatic function"),
  weight: (v) =>
    v > 0.8 ? "High BMI — altered volume of distribution" : v < 0.3 ? "Low weight — increased toxicity risk" : "Normal weight range",
  sex: (v) => (v > 0.5 ? "Female — higher QT prolongation risk" : "Male — standard baseline"),
  smoking: (v) => (v > 0.5 ? "Active smoker — CYP1A2 enzyme induction" : "Non-smoker — no CYP induction"),
};

const RISK_ICONS: Record<string, string> = {
  age: "🧓", renal: "🫘", hepatic: "🫁", weight: "⚖️", sex: "♀♂", smoking: "🚬",
};

function normalizeValue(patient: PatientContext, key: string): number {
  switch (key) {
    case "age":
      return Math.min((patient.age ?? 50) / 100, 1);
    case "renal":
      return (patient.ckd_stage ?? 0) / 5;
    case "hepatic":
      return patient.hepatic_impairment ? 1 : 0;
    case "weight":
      return patient.weight_kg ? Math.min(patient.weight_kg / 120, 1) : 0.5;
    case "sex":
      return patient.sex === "female" ? 0.6 : 0.4;
    case "smoking":
      return patient.smoking ? 1 : 0;
    default:
      return 0;
  }
}

function getRiskColor(value: number): string {
  if (value > 0.7) return "#ef4444";
  if (value > 0.4) return "#f59e0b";
  return "#10b981";
}

export function PhenotypeRadar3D({
  patient,
  riskMultipliers = {},
  onHoverAxis,
}: PhenotypeRadar3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredAxis, setHoveredAxis] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState(0);

  // Reduced radius to fit better inside the canvas
  const radius = 2.4;
  const n = AXES.length;

  const axisPositions = useMemo(() => {
    return AXES.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    });
  }, [n]);

  const baseValues = useMemo(
    () => AXES.map((a) => normalizeValue(patient, a.key)),
    [patient],
  );

  const modifiedValues = useMemo(
    () =>
      AXES.map((a, i) => {
        const mult = riskMultipliers[a.key] || 1;
        return Math.min(baseValues[i] * mult, 1);
      }),
    [baseValues, riskMultipliers],
  );

  const overallRisk = useMemo(() => {
    return modifiedValues.reduce((sum, v) => sum + v, 0) / modifiedValues.length;
  }, [modifiedValues]);

  const highRiskFactors = useMemo(() => {
    return AXES.map((a, i) => ({ key: a.key, label: a.label, value: modifiedValues[i] })).filter(
      (f) => f.value > 0.5,
    );
  }, [modifiedValues]);

  // Emit hover payload to parent so the side-panel can show details
  // outside the 3D canvas (no more clipped tooltips).
  useEffect(() => {
    if (!onHoverAxis) return;
    if (hoveredAxis === null) {
      onHoverAxis(null);
      return;
    }
    const axis = AXES[hoveredAxis];
    const value = modifiedValues[hoveredAxis];
    const color = getRiskColor(value);
    const riskLabel: "LOW" | "MODERATE" | "HIGH" =
      value > 0.7 ? "HIGH" : value > 0.4 ? "MODERATE" : "LOW";
    const explanation = RISK_EXPLANATIONS[axis.key]?.(value) ?? "";
    const action =
      value > 0.7
        ? "Requires clinical attention — adjust dosing"
        : value > 0.4
        ? "Monitor this parameter"
        : "Within acceptable range";
    onHoverAxis({
      key: axis.key,
      label: axis.label,
      value,
      score: value * 10,
      riskLabel,
      color,
      explanation,
      action,
    });
  }, [hoveredAxis, modifiedValues, onHoverAxis]);

  useFrame(({ clock }) => {
    setAnimProgress(Math.min(clock.getElapsedTime() * 0.5, 1));
    if (groupRef.current) {
      groupRef.current.rotation.x =
        0.45 + Math.sin(clock.getElapsedTime() * 0.15) * 0.08;
      groupRef.current.rotation.z =
        Math.sin(clock.getElapsedTime() * 0.1) * 0.03;
    }
    if (hoveredAxis !== null) {
      setHoverTime(clock.getElapsedTime());
    }
  });

  const basePolygon = axisPositions.map((pos, i) => {
    const v = baseValues[i] * animProgress * radius;
    return [pos.x * v, pos.y * v, 0] as [number, number, number];
  });

  const modifiedPolygon = axisPositions.map((pos, i) => {
    const v = modifiedValues[i] * animProgress * radius;
    return [pos.x * v, pos.y * v, 0.06] as [number, number, number];
  });

  return (
    <>
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        enableRotate={true}
        minDistance={3.5}
        maxDistance={14}
        maxPolarAngle={Math.PI * 0.75}
        minPolarAngle={Math.PI * 0.15}
      />

      <group ref={groupRef}>
        {/* Background disc */}
        <mesh position={[0, 0, -0.15]}>
          <circleGeometry args={[radius * 1.15, 48]} />
          <meshBasicMaterial color="#070f1e" transparent opacity={0.5} />
        </mesh>

        {/* Grid rings */}
        {[0.25, 0.5, 0.75, 1.0].map((r, ri) => (
          <GridRing
            key={r}
            radius={r * radius}
            axisPositions={axisPositions}
            zOffset={ri * 0.01}
            opacity={r === 1.0 ? 0.35 : 0.2}
          />
        ))}

        {/* Ring scale labels */}
        {[
          { frac: 0.25, label: "2.5" },
          { frac: 0.5, label: "5.0" },
          { frac: 0.75, label: "7.5" },
          { frac: 1.0, label: "10" },
        ].map(({ frac, label }) => (
          <Text
            key={frac}
            position={[0.12, frac * radius + 0.06, 0.02]}
            fontSize={0.09}
            color="#334155"
            anchorX="left"
          >
            {label}
          </Text>
        ))}

        {/* Axis lines + labels */}
        {axisPositions.map((pos, i) => {
          const isHovered = hoveredAxis === i;
          const riskVal = modifiedValues[i];
          const riskColor = getRiskColor(riskVal);
          return (
            <group key={i}>
              {/* Axis line — glows on hover */}
              <Line
                points={[[0, 0, 0], [pos.x * radius, pos.y * radius, 0]]}
                color={isHovered ? riskColor : "#1e3a5f"}
                lineWidth={isHovered ? 1.5 : 0.5}
                transparent
                opacity={isHovered ? 0.9 : 0.5}
              />
              {/* Axis label */}
              <Text
                position={[pos.x * (radius + 0.45), pos.y * (radius + 0.45), 0.02]}
                fontSize={isHovered ? 0.2 : 0.17}
                color={isHovered ? riskColor : "#cbd5e1"}
                anchorX="center"
                anchorY="middle"
                fontWeight={isHovered ? 700 : 500}
              >
                {AXES[i].label}
              </Text>
              {/* Score value at data point */}
              {animProgress > 0.7 && (
                <Text
                  position={[
                    pos.x * (baseValues[i] * radius + 0.3),
                    pos.y * (baseValues[i] * radius + 0.3),
                    0.08,
                  ]}
                  fontSize={0.13}
                  color={riskColor}
                  anchorX="center"
                  anchorY="middle"
                  fontWeight={700}
                >
                  {(riskVal * 10).toFixed(1)}
                </Text>
              )}
            </group>
          );
        })}

        {/* Filled polygon */}
        {basePolygon.length > 2 && animProgress > 0.1 && (
          <RadarFill points={basePolygon} color="#06b6d4" opacity={0.14} />
        )}
        {/* Outline */}
        {basePolygon.length > 2 && (
          <RadarOutline points={basePolygon} color="#06b6d4" opacity={0.75} lineWidth={2.5} />
        )}

        {/* Modified overlay when multipliers present */}
        {modifiedPolygon.length > 2 && Object.keys(riskMultipliers).length > 0 && (
          <>
            <RadarFill points={modifiedPolygon} color="#ef4444" opacity={0.08} />
            <RadarOutline points={modifiedPolygon} color="#ef4444" opacity={0.5} lineWidth={1.5} />
          </>
        )}

        {/* Interactive data points */}
        {basePolygon.map((pt, i) => {
          const isHovered = hoveredAxis === i;
          const riskColor = getRiskColor(modifiedValues[i]);
          return (
            <group key={i}>
              {/* Glow ring on hover */}
              {isHovered && (
                <mesh position={pt}>
                  <ringGeometry args={[0.14, 0.2, 24]} />
                  <meshBasicMaterial color={riskColor} transparent opacity={0.15 + Math.sin(hoverTime * 4) * 0.08} />
                </mesh>
              )}
              <mesh
                position={pt}
                onPointerOver={() => setHoveredAxis(i)}
                onPointerOut={() => setHoveredAxis(null)}
              >
                <sphereGeometry args={[isHovered ? 0.12 : 0.08, 16, 16]} />
                <meshStandardMaterial
                  color={riskColor}
                  emissive={riskColor}
                  emissiveIntensity={isHovered ? 0.9 : 0.5}
                />
              </mesh>
            </group>
          );
        })}

        {/* Center phenotype score */}
        {animProgress > 0.8 && (
          <group position={[0, 0, 0.1]}>
            <Text
              fontSize={0.38}
              color={getRiskColor(overallRisk)}
              anchorX="center"
              anchorY="middle"
              fontWeight={800}
            >
              {(overallRisk * 10).toFixed(1)}
            </Text>
            <Text position={[0, -0.28, 0]} fontSize={0.1} color="#64748b" anchorX="center">
              PHENOTYPE SCORE
            </Text>
          </group>
        )}

        {/* Hover tooltip is now rendered OUTSIDE the 3D canvas as an HTML
            panel in the parent component (page.tsx). This prevents the
            tooltip from being clipped by the canvas bounds. The parent
            receives hover data via the onHoverAxis callback. */}

        {/* High risk warning */}
        {animProgress > 0.9 && highRiskFactors.length > 0 && (
          <Text
            position={[0, -(radius + 0.7), 0.02]}
            fontSize={0.11}
            color="#f59e0b"
            anchorX="center"
            maxWidth={6}
          >
            {`⚠ ${highRiskFactors.length} elevated: ${highRiskFactors.map((f) => f.label).join(", ")}`}
          </Text>
        )}
      </group>
    </>
  );
}

// ── Hover tooltip with animated border glow ─────────────

// ── Sub-components ─────────────────────────────────────

function GridRing({
  radius,
  axisPositions,
  zOffset = 0,
  opacity = 0.25,
}: {
  radius: number;
  axisPositions: { x: number; y: number }[];
  zOffset?: number;
  opacity?: number;
}) {
  const points: [number, number, number][] = axisPositions.map((pos) => [
    pos.x * radius,
    pos.y * radius,
    zOffset,
  ]);
  if (points.length > 0) points.push(points[0]);
  return <Line points={points} color="#1e3a5f" lineWidth={0.5} transparent opacity={opacity} />;
}

function RadarOutline({
  points,
  color,
  opacity,
  lineWidth = 2,
}: {
  points: [number, number, number][];
  color: string;
  opacity: number;
  lineWidth?: number;
}) {
  const closed = [...points, points[0]];
  return <Line points={closed} color={color} lineWidth={lineWidth} transparent opacity={opacity} />;
}

function RadarFill({
  points,
  color,
  opacity,
}: {
  points: [number, number, number][];
  color: string;
  opacity: number;
}) {
  const geometry = useMemo(() => {
    if (points.length < 3) return null;
    const verts: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      verts.push(0, 0, points[0][2]);
      verts.push(points[i][0], points[i][1], points[i][2]);
      verts.push(points[next][0], points[next][1], points[next][2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }, [points]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}
