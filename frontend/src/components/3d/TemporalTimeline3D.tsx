"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Text, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CascadeModel } from "@/lib/types";

export interface TimelineHoverPayload {
  day: number;
  risk: number;
  event?: string;
  isPeak: boolean;
  inInterventionWindow: boolean;
  windowAction?: string;
}

interface TemporalTimeline3DProps {
  data: CascadeModel;
  onPointHover?: (payload: TimelineHoverPayload | null) => void;
}

export function TemporalTimeline3D({ data, onPointHover }: TemporalTimeline3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [animProgress, setAnimProgress] = useState(0);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  const dailyRisk = data?.daily_risk ?? [];
  const timelineDays = data?.timeline_days ?? 0;
  const peakRiskDay = data?.peak_risk_day ?? 0;
  const peakRiskScore = data?.peak_risk_score ?? 0;
  const interventionWindows = data?.intervention_windows ?? [];
  const summary = data?.summary ?? "";

  // Normalize risk data to 3D coordinates
  const points = useMemo(() => {
    if (!dailyRisk.length) return [];

    const maxDay = timelineDays || dailyRisk.length;
    const xScale = 8 / Math.max(maxDay, 1);
    const yScale = 3 / 10;
    // Z depth: higher risk = closer to camera. This is what makes the
    // visualization feel genuinely 3D — peaks literally protrude forward.
    const zScale = 1.2 / 10;

    return dailyRisk.map((dr) => ({
      x: -4 + dr.day * xScale,
      y: -1.5 + (dr.risk_score ?? 0) * yScale,
      z: (dr.risk_score ?? 0) * zScale,
      day: dr.day,
      risk: dr.risk_score ?? 0,
      event: dr.key_event,
    }));
  }, [dailyRisk, timelineDays]);

  useFrame(({ clock }) => {
    const t = Math.min(clock.getElapsedTime() * 0.4, 1);
    setAnimProgress(t);
    // No auto-rotation — OrbitControls in parent handles rotation.
  });

  // Empty state
  // Emit hover payload to parent for the side panel
  useEffect(() => {
    if (!onPointHover) return;
    if (hoveredPoint === null || !points[hoveredPoint]) {
      onPointHover(null);
      return;
    }
    const p = points[hoveredPoint];
    const isPeak = p.day === peakRiskDay;
    const win = interventionWindows.find(
      (w) => p.day >= (w.day_start ?? 0) && p.day <= (w.day_end ?? 0),
    );
    onPointHover({
      day: p.day,
      risk: p.risk,
      event: p.event,
      isPeak,
      inInterventionWindow: !!win,
      windowAction: win?.action,
    });
  }, [hoveredPoint, points, peakRiskDay, interventionWindows, onPointHover]);

  if (dailyRisk.length === 0) {
    return (
      <group>
        <EmptyTimeline />
      </group>
    );
  }

  const visibleCount = Math.floor(animProgress * points.length);
  const visiblePoints = points.slice(0, Math.max(visibleCount, 1));

  const getRiskColor = (risk: number) => {
    if (risk > 7) return "#ef4444";
    if (risk > 4) return "#f59e0b";
    return "#06b6d4";
  };

  return (
    <>
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={4}
        maxDistance={14}
        maxPolarAngle={Math.PI * 0.85}
        minPolarAngle={Math.PI * 0.15}
      />
      <group ref={groupRef}>
        {/* Axes */}
        <Line points={[[-4, -1.5, 0], [4, -1.5, 0]]} color="#1e3a5f" lineWidth={1} />
        <Line points={[[-4, -1.5, 0], [-4, 1.5, 0]]} color="#1e3a5f" lineWidth={1} />

      <Text position={[0, -2.1, 0]} fontSize={0.3} color="#eaf0fa" anchorX="center"
        outlineWidth={0.012} outlineColor="#020817" fontWeight={600}>
        Days
      </Text>
      <Text position={[-4.35, -1.5, 0]} fontSize={0.24} color="#cbd5e1" anchorX="right"
        outlineWidth={0.01} outlineColor="#020817">0</Text>
      <Text position={[4, -1.85, 0]} fontSize={0.24} color="#cbd5e1" anchorX="center"
        outlineWidth={0.01} outlineColor="#020817">
        {timelineDays}
      </Text>
      <Text position={[-5.0, 0, 0]} fontSize={0.28} color="#eaf0fa" anchorX="right"
        outlineWidth={0.012} outlineColor="#020817" fontWeight={600}>
        Risk
      </Text>
      <Text position={[-4.35, 0, 0]} fontSize={0.22} color="#cbd5e1" anchorX="right"
        outlineWidth={0.01} outlineColor="#020817">5</Text>
      <Text position={[-4.35, 1.5, 0]} fontSize={0.22} color="#cbd5e1" anchorX="right"
        outlineWidth={0.01} outlineColor="#020817">10</Text>

      {/* Grid lines */}
      {[0, 0.5, 1].map((frac) => (
        <Line
          key={frac}
          points={[[-4, -1.5 + frac * 3, -0.05], [4, -1.5 + frac * 3, -0.05]]}
          color="#1e3a5f" lineWidth={0.5} transparent opacity={0.2}
        />
      ))}

      {/* Filled area under curve */}
      {visiblePoints.length > 2 && <RiskArea points={visiblePoints} />}

      {/* Risk curve */}
      {visiblePoints.length > 1 && (
        <Line
          points={visiblePoints.map((p) => [p.x, p.y, p.z] as [number, number, number])}
          color="#06b6d4" lineWidth={2.5} transparent opacity={0.8}
        />
      )}

      {/* Peak risk marker */}
      <PeakMarker
        points={points}
        peakDay={peakRiskDay}
        peakScore={peakRiskScore}
        visible={animProgress > (peakRiskDay / Math.max(timelineDays, 1))}
      />

      {/* Intervention windows */}
      {interventionWindows.map((w, i) => {
        const xScale = 8 / Math.max(timelineDays, 1);
        const x1 = -4 + (w.day_start ?? 0) * xScale;
        const x2 = -4 + (w.day_end ?? 0) * xScale;
        const visible = animProgress > ((w.day_start ?? 0) / Math.max(timelineDays, 1));
        if (!visible) return null;
        return (
          <InterventionZone key={i} x1={x1} x2={x2} label={w.action ?? ""} urgency={w.urgency} />
        );
      })}

      {/* Data points — larger + vertical pillar from baseline. The pillar
          gives the chart real volume; the sphere's Z position (proportional
          to risk) makes peaks literally protrude toward the camera. */}
      {visiblePoints.map((pt, i) => {
        const isHov = hoveredPoint === i;
        const riskColor = getRiskColor(pt.risk);
        return (
          <group key={i}>
            {/* Translucent pillar connecting baseline (y=-1.5, z=0) to the data sphere */}
            <mesh position={[pt.x, (pt.y + (-1.5)) / 2, pt.z / 2]}>
              <boxGeometry args={[0.05, Math.max(pt.y - (-1.5), 0.05), 0.05]} />
              <meshStandardMaterial
                color={riskColor}
                transparent
                opacity={isHov ? 0.55 : 0.28}
                emissive={riskColor}
                emissiveIntensity={isHov ? 0.4 : 0.15}
              />
            </mesh>
            {/* Data sphere */}
            <mesh
              position={[pt.x, pt.y, pt.z]}
              onPointerOver={(e) => { e.stopPropagation(); setHoveredPoint(i); }}
              onPointerOut={() => setHoveredPoint(null)}
            >
              <sphereGeometry args={[isHov ? 0.14 : 0.09, 24, 24]} />
              <meshStandardMaterial
                color={riskColor}
                emissive={riskColor}
                emissiveIntensity={isHov ? 1.0 : 0.5}
                metalness={0.25}
                roughness={0.3}
              />
            </mesh>
            {/* Subtle hover ring indicator (XZ plane so it's always facing) */}
            {isHov && (
              <mesh position={[pt.x, pt.y, pt.z]} rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.18, 0.24, 24]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.55} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* Inline tooltip is deliberately omitted here. The parent renders an
          HTML side-panel overlay (never clipped) via onPointHover. */}

      {/* Summary */}
      {animProgress > 0.9 && summary && (
        <Text position={[0, -2.5, 0]} fontSize={0.14} color="#cbd5e1" anchorX="center" maxWidth={8}
          outlineWidth={0.008} outlineColor="#020817">
          {summary}
        </Text>
      )}
      </group>
    </>
  );
}

function EmptyTimeline() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.2;
  });
  return (
    <group>
      <mesh ref={ref}>
        <torusGeometry args={[1.2, 0.04, 8, 32]} />
        <meshStandardMaterial color="#1e3a5f" transparent opacity={0.3} />
      </mesh>
      <Text position={[0, 0, 0]} fontSize={0.22} color="#4a6080" anchorX="center" anchorY="middle">
        No timeline data available
      </Text>
      <Text position={[0, -0.4, 0]} fontSize={0.1} color="#334155" anchorX="center">
        Run an analysis to see risk timeline
      </Text>
    </group>
  );
}

function RiskArea({ points }: { points: { x: number; y: number; z: number }[] }) {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const baseY = -1.5;
    const vertices: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      vertices.push(points[i].x, baseY, -0.02);
      vertices.push(points[i].x, points[i].y, -0.02);
      vertices.push(points[i + 1].x, points[i + 1].y, -0.02);
      vertices.push(points[i].x, baseY, -0.02);
      vertices.push(points[i + 1].x, points[i + 1].y, -0.02);
      vertices.push(points[i + 1].x, baseY, -0.02);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeVertexNormals();
    return geo;
  }, [points]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color="#06b6d4" transparent opacity={0.08} side={THREE.DoubleSide} />
    </mesh>
  );
}

function PeakMarker({
  points, peakDay, peakScore, visible,
}: {
  points: { x: number; y: number; z: number }[];
  peakDay: number; peakScore: number; visible: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const peakPoint = useMemo(() => {
    if (points.length === 0 || peakDay <= 0) return null;
    const idx = Math.min(Math.max(peakDay - 1, 0), points.length - 1);
    return points[idx] || null;
  }, [points, peakDay]);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 3) * 0.2);
    }
  });

  if (!peakPoint || !visible || peakScore <= 0) return null;

  return (
    <group position={[peakPoint.x, peakPoint.y, peakPoint.z]}>
      <mesh><sphereGeometry args={[0.18, 16, 16]} /><meshStandardMaterial color="#ef4444" transparent opacity={0.1} /></mesh>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0.8} transparent opacity={0.9} />
      </mesh>
      <Text position={[0, 0.44, 0]} fontSize={0.26} color="#ef4444" anchorX="center" anchorY="bottom" fontWeight="bold"
        outlineWidth={0.014} outlineColor="#020817">
        {`Peak: ${peakScore.toFixed(1)}/10`}
      </Text>
      <Text position={[0, 0.24, 0]} fontSize={0.18} color="#fca5a5" anchorX="center" anchorY="bottom"
        outlineWidth={0.012} outlineColor="#020817" fontWeight={600}>
        {`Day ${peakDay}`}
      </Text>
      <Line points={[[0, 0, 0], [0, -1.5 - peakPoint.y, 0]]} color="#ef4444" lineWidth={1} transparent opacity={0.3} dashed dashSize={0.05} gapSize={0.05} />
    </group>
  );
}

function InterventionZone({ x1, x2, label, urgency }: { x1: number; x2: number; label: string; urgency?: string }) {
  const width = Math.max(x2 - x1, 0.1);
  const centerX = x1 + width / 2;
  const zoneColor = urgency === "immediate" || urgency === "high" ? "#ef4444" : "#06b6d4";
  return (
    <group>
      <mesh position={[centerX, 0, -0.1]}>
        <planeGeometry args={[width, 3]} />
        <meshBasicMaterial color={zoneColor} transparent opacity={0.06} />
      </mesh>
      <Line points={[[x1, 1.5, 0], [x2, 1.5, 0]]} color={zoneColor} lineWidth={1} transparent opacity={0.4} />
      <Text position={[centerX, 1.9, 0]} fontSize={0.2} color={zoneColor} anchorX="center"
        outlineWidth={0.012} outlineColor="#020817" fontWeight={600}>{label}</Text>
    </group>
  );
}
