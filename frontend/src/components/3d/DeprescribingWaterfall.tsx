"use client";

import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { DeprescribingPlan, DeprescribingStep } from "@/lib/types";

const ACTION_COLORS: Record<string, string> = {
  discontinue: "#ef4444",
  reduce: "#f59e0b",
  substitute: "#06b6d4",
  monitor: "#10b981",
};

const ACTION_ICONS: Record<string, string> = {
  discontinue: "✕",
  reduce: "↓",
  substitute: "⇄",
  monitor: "◉",
};

export interface DeprescribingClickPayload {
  index: number;
  step: DeprescribingStep;
  color: string;
}

interface DeprescribingWaterfallProps {
  data: DeprescribingPlan;
  onStepClick?: (payload: DeprescribingClickPayload | null) => void;
}

export function DeprescribingWaterfall({
  data,
  onStepClick,
}: DeprescribingWaterfallProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  const steps = data?.steps ?? [];

  // ALL hooks must be called unconditionally, BEFORE any early return,
  // to satisfy the Rules of Hooks. The animation tick runs even when
  // there are no steps — it's cheap and avoids hook-order violations.
  useFrame(({ clock }) => {
    const t = Math.min(clock.getElapsedTime() * 0.3, 1);
    setAnimProgress(t);
  });

  if (steps.length === 0) {
    return (
      <group>
        <EmptyWaterfall />
      </group>
    );
  }

  const barHeight = 0.5;
  const barGap = 0.55; // larger gap — drug name now sits above the bar and needs room
  const maxWidth = 5.5;
  const maxReduction = Math.max(
    ...steps.map((s) => s.expected_risk_reduction ?? 0),
    1,
  );

  const totalHeight = steps.length * (barHeight + barGap);
  const startY = totalHeight / 2;

  // Running cumulative reduction for waterfall effect
  let cumulativeReduction = 0;

  return (
    <>
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={4}
        maxDistance={16}
        maxPolarAngle={Math.PI * 0.85}
        minPolarAngle={Math.PI * 0.15}
      />
      <group ref={groupRef}>
        {/* Title */}
        <Text position={[0, startY + 0.7, 0]} fontSize={0.3} color="#f1f5f9" anchorX="center" fontWeight="bold"
          outlineWidth={0.012} outlineColor="#020817">
          Deprescribing Plan
        </Text>
        <Text position={[0, startY + 0.35, 0]} fontSize={0.14} color="#cbd5e1" anchorX="center"
          outlineWidth={0.008} outlineColor="#020817">
          Ordered by clinical priority — {steps.length} step{steps.length > 1 ? "s" : ""}
        </Text>

      {steps.map((step, i) => {
        const y = startY - i * (barHeight + barGap) - barHeight / 2;
        const reduction = step.expected_risk_reduction ?? 0;
        const width = (reduction / maxReduction) * maxWidth * 0.8;
        const color = ACTION_COLORS[step.action] || "#64748b";
        const stepProgress = Math.max(0, Math.min((animProgress - i * 0.1) / 0.3, 1));
        const animatedWidth = width * stepProgress;
        const isHovered = hoveredStep === i;

        cumulativeReduction += reduction;

        // Layout: priority label on the far left, drug name just above the
        // bar (not to its left, which was overlapping with the priority).
        const priorityX = -maxWidth / 2 - 1.6;

        return (
          <group key={i}>
            {/* Priority number — pushed far left so it can't overlap drug name */}
            <Text position={[priorityX, y, 0]} fontSize={0.32} color={color} anchorX="center" fontWeight="bold"
              outlineWidth={0.014} outlineColor="#020817">
              {`#${step.priority ?? i + 1}`}
            </Text>

            {/* Drug name — above the bar, not to its left */}
            <Text
              position={[-maxWidth / 2 + 0.05, y + barHeight * 0.55, 0]}
              fontSize={isHovered ? 0.24 : 0.22}
              color={isHovered ? "#ffffff" : "#eaf0fa"}
              anchorX="left" anchorY="bottom"
              fontWeight={isHovered ? 800 : 700}
              outlineWidth={0.012} outlineColor="#020817"
            >
              {step.drug ?? "Unknown"}
            </Text>

            {/* Bar background (track) — 3D box with depth */}
            <mesh position={[-maxWidth / 2 + maxWidth * 0.4, y, -0.1]}>
              <boxGeometry args={[maxWidth * 0.8, barHeight * 0.7, 0.25]} />
              <meshStandardMaterial color="#0f172a" transparent opacity={0.5} />
            </mesh>

            {/* Animated bar — 3D box with visible depth */}
            <mesh
              position={[-maxWidth / 2 + animatedWidth / 2, y, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onStepClick?.({ index: i, step, color });
              }}
              onPointerOver={(e) => { e.stopPropagation(); setHoveredStep(i); }}
              onPointerOut={() => setHoveredStep(null)}
            >
              <boxGeometry args={[animatedWidth, barHeight * 0.7, 0.35]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isHovered ? 0.6 : 0.3}
                transparent
                opacity={stepProgress * (isHovered ? 0.98 : 0.9)}
                metalness={0.2}
                roughness={0.4}
              />
            </mesh>

            {/* Action label inside bar */}
            {stepProgress > 0.5 && animatedWidth > 0.8 && (
              <Text position={[-maxWidth / 2 + animatedWidth / 2, y, 0.2]} fontSize={0.16} color="#020817" anchorX="center" anchorY="middle" fontWeight="bold">
                {(step.action ?? "").toUpperCase()}
              </Text>
            )}

            {/* Reduction percentage */}
            {stepProgress > 0.8 && (
              <Text position={[-maxWidth / 2 + animatedWidth + 0.32, y, 0]} fontSize={0.24} color={color} anchorX="left" anchorY="middle" fontWeight="bold"
                outlineWidth={0.014} outlineColor="#020817">
                {`-${reduction.toFixed(0)}%`}
              </Text>
            )}

            {/* Substitute info (smaller, below the bar) */}
            {stepProgress > 0.9 && step.substitute && (
              <Text position={[-maxWidth / 2 + 0.05, y - barHeight * 0.55, 0]} fontSize={0.13} color="#94a8c8" anchorX="left" anchorY="top"
                outlineWidth={0.008} outlineColor="#020817">
                {`→ ${step.substitute}`}
              </Text>
            )}

            {/* Inline 3D tooltip is deliberately omitted. The parent renders
                an HTML side-panel overlay via onStepClick (never clipped,
                anchored top-right of the canvas). */}
          </group>
        );
      })}

      {/* Total reduction summary. The paragraph summary and warnings that
          used to live here have moved out of the 3D scene — Three.js Text
          with maxWidth wraps to an unpredictable number of lines, and
          fixed-position elements below it (the warnings list) inevitably
          overlapped the wrapped text. The summary prose and warnings are
          rendered by the parent's HTML "Deprescribing Interpretation"
          card, which handles reflow properly. We keep ONLY the single-line
          total reduction here as a clean visual anchor for the waterfall. */}
      {animProgress > 0.8 && (
        <group>
          {/* Separator line */}
          <mesh position={[0, -startY - 0.35, 0]}>
            <planeGeometry args={[maxWidth * 1.2, 0.01]} />
            <meshBasicMaterial color="#1e3a5f" transparent opacity={0.5} />
          </mesh>
          <Text
            position={[0, -startY - 0.75, 0]}
            fontSize={0.28}
            color="#10b981"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
            outlineWidth={0.014}
            outlineColor="#020817"
          >
            {`Total risk reduction: -${(data?.total_expected_risk_reduction ?? 0).toFixed(0)}%`}
          </Text>
        </group>
      )}
      </group>
    </>
  );
}

function EmptyWaterfall() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.z = clock.getElapsedTime() * 0.2;
  });
  return (
    <group>
      <mesh ref={ref}>
        <ringGeometry args={[0.8, 1, 6]} />
        <meshStandardMaterial color="#1e3a5f" transparent opacity={0.2} wireframe />
      </mesh>
      <Text position={[0, 0, 0]} fontSize={0.22} color="#4a6080" anchorX="center">
        No deprescribing data available
      </Text>
      <Text position={[0, -0.4, 0]} fontSize={0.1} color="#334155" anchorX="center">
        Run an analysis to see deprescribing plan
      </Text>
    </group>
  );
}
