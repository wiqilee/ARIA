"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Text, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { InteractionGraph, Severity } from "@/lib/types";

const SEVERITY_COLORS: Record<Severity, string> = {
  low: "#00e676",
  moderate: "#ffab00",
  high: "#ff6d00",
  critical: "#ff1744",
};

// Payload sent to the parent via onNodeClick, so the side panel in page.tsx
// can render rich node details without any tooltip clipping.
export interface NodeClickPayload {
  drug_name: string;
  is_hub: boolean;
  degree: number;
  hub_score: number;
  connected: Array<{ drug: string; severity: Severity; type: string }>;
  worst_severity: Severity | null;
}

interface InteractionGraph3DProps {
  data: InteractionGraph;
  /** Called when the user hovers over a node. Emits rich payload for the
   *  parent's side panel. Null when no node is hovered. */
  onNodeHover?: (payload: NodeClickPayload | null) => void;
  onEdgeClick?: (source: string, target: string) => void;
}

interface NodePosition {
  drug_name: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  is_hub: boolean;
  hub_score: number;
  degree: number;
}

export function InteractionGraph3D({
  data,
  onNodeHover,
  onEdgeClick,
}: InteractionGraph3DProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  // On touch devices, hover via onPointerOver fires only momentarily during a
  // tap, so we keep an explicit "locked" node that stays selected until the
  // user taps it again or taps the empty canvas. On mouse devices we never
  // touch this state and the original hover behavior is preserved.
  const [lockedNode, setLockedNode] = useState<string | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const [, forceUpdate] = useState(0);

  // Detect coarse pointers (mobile / tablet). We check on mount only because
  // the device class doesn't change mid-session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    setIsTouchDevice(mq.matches);
  }, []);

  // The "active" node is whichever the user has locked on touch, falling back
  // to the hovered node on mouse devices. This single value drives the side
  // panel emission, the highlight ring, and edge highlighting.
  const activeNode = lockedNode ?? hoveredNode;

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const emergentInteractions = data?.emergent_interactions ?? [];

  const nodePositions = useMemo(() => {
    const positions: NodePosition[] = [];
    const n = nodes.length;
    if (n === 0) return positions;

    nodes.forEach((node, i) => {
      // Distribute nodes over a full sphere (Fibonacci-like spread) so the
      // layout reads as genuinely 3D — they occupy depth, not just a plane.
      const phi = Math.acos(-1 + (2 * i + 1) / n);
      const theta = Math.sqrt(n * Math.PI) * phi;
      const radius = 3.2;
      positions.push({
        drug_name: node.drug_name,
        pos: new THREE.Vector3(
          Math.cos(theta) * Math.sin(phi) * radius,
          Math.sin(theta) * Math.sin(phi) * radius,
          Math.cos(phi) * radius * 1.1, // z-spread now ≈ xy-spread (was 0.5) → true 3D shell
        ),
        vel: new THREE.Vector3(0, 0, 0),
        is_hub: node.is_hub,
        hub_score: node.hub_score,
        degree: node.degree,
      });
    });
    return positions;
  }, [nodes]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, NodePosition>();
    nodePositions.forEach((n) => map.set(n.drug_name, n));
    return map;
  }, [nodePositions]);

  // Pre-compute which nodes have at least one edge. Orphan nodes (no
  // edges — e.g. a drug we surfaced for completeness but which has no
  // interactions with the rest of the regimen, like digoxin in some
  // regimens) feel only repulsion from the cluster and would drift to
  // the edge of the canvas without compensating force. We use this set
  // below to apply an extra inward pull just to them.
  const connectedNodes = useMemo(() => {
    const s = new Set<string>();
    for (const edge of edges) {
      s.add(edge.source);
      s.add(edge.target);
    }
    return s;
  }, [edges]);

  // Force-directed simulation + re-render trigger
  const frameCount = useRef(0);
  useFrame(() => {
    if (nodePositions.length === 0) return;

    const damping = 0.92;
    const repulsion = 0.8;
    const attraction = 0.01;
    // Center pull is much stronger than the original 0.005. Weak pull let
    // orphan nodes drift to the canvas boundary; this brings every node
    // back toward the cluster so the whole graph fits in the default view.
    const centerPull = 0.03;
    // Extra inward pull applied only to orphans. Repulsion from a tight
    // cluster of 4+ connected nodes is large, and the orphan needs enough
    // counter-force to settle just outside the cluster instead of fleeing
    // it.
    const isolatedExtraPull = 0.15;
    // Hard cap on radius. Given OrbitControls' minDistance=3.5, anything
    // past ~3.4 brushes the camera frustum. We clamp to keep the layout
    // always inside the visible frame.
    const maxRadius = 3.4;

    for (let i = 0; i < nodePositions.length; i++) {
      for (let j = i + 1; j < nodePositions.length; j++) {
        const a = nodePositions[i];
        const b = nodePositions[j];
        const diff = a.pos.clone().sub(b.pos);
        const dist = Math.max(diff.length(), 0.5);
        const force = diff.normalize().multiplyScalar(repulsion / (dist * dist));
        a.vel.add(force);
        b.vel.sub(force);
      }
    }

    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (a && b) {
        const diff = b.pos.clone().sub(a.pos);
        const force = diff.multiplyScalar(attraction);
        a.vel.add(force);
        b.vel.sub(force);
      }
    }

    for (const node of nodePositions) {
      const toCenter = node.pos.clone().negate().multiplyScalar(centerPull);
      node.vel.add(toCenter);

      // Orphans get an extra inward pull on top of the base centerPull,
      // so they settle near the connected cluster instead of at the rim.
      if (!connectedNodes.has(node.drug_name)) {
        const extra = node.pos.clone().negate().multiplyScalar(isolatedExtraPull);
        node.vel.add(extra);
      }

      node.vel.multiplyScalar(damping);
      node.pos.add(node.vel);

      // Hard boundary clamp. If a node has drifted past maxRadius (can
      // happen on the first few frames when repulsion is large), pull it
      // back onto the boundary and damp its outward velocity so it does
      // not immediately escape again.
      const r = node.pos.length();
      if (r > maxRadius) {
        node.pos.multiplyScalar(maxRadius / r);
        node.vel.multiplyScalar(0.4);
      }
    }

    // No auto-rotation here — the parent canvas has OrbitControls, letting
    // the user rotate and zoom manually. Auto-rotating the group would
    // fight the user's drag gestures.

    // Force React re-render every 3 frames so edges/nodes update visually
    frameCount.current++;
    if (frameCount.current % 3 === 0) {
      forceUpdate((v) => v + 1);
    }
  });

  // Emit payload whenever the active node changes (locked on touch, hovered
  // on mouse). The parent's side panel renders the rich details.
  useEffect(() => {
    if (!onNodeHover) return;
    if (activeNode === null) {
      onNodeHover(null);
      return;
    }
    const node = nodes.find((n) => n.drug_name === activeNode);
    const sevRank: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
    const connected: NodeClickPayload["connected"] = [];
    let worst: Severity | null = null;
    for (const e of edges) {
      if (e.source === activeNode || e.target === activeNode) {
        const other = e.source === activeNode ? e.target : e.source;
        connected.push({ drug: other, severity: e.severity, type: e.interaction_type });
        if (!worst || sevRank[e.severity] > sevRank[worst]) worst = e.severity;
      }
    }
    connected.sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
    onNodeHover({
      drug_name: activeNode,
      is_hub: node?.is_hub ?? false,
      degree: node?.degree ?? connected.length,
      hub_score: node?.hub_score ?? 0,
      connected,
      worst_severity: worst,
    });
  }, [activeNode, nodes, edges, onNodeHover]);

  if (nodes.length === 0) {
    return <group><EmptyGraph /></group>;
  }

  return (
    <>
      <OrbitControls
        enablePan={false}
        enableZoom={true}
        enableRotate={true}
        minDistance={3.5}
        maxDistance={16}
        maxPolarAngle={Math.PI * 0.85}
        minPolarAngle={Math.PI * 0.15}
      />
      {/* On touch devices, tapping the empty canvas (anything that isn't a
          node) clears the lock. We attach this to a large invisible plane
          behind everything so it catches missed taps without blocking
          OrbitControls. */}
      {isTouchDevice && (
        <mesh position={[0, 0, -8]} onPointerDown={() => setLockedNode(null)}>
          <planeGeometry args={[40, 40]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <group ref={groupRef}>
        <pointLight position={[0, 0, 2]} intensity={0.3} color="#06b6d4" distance={6} />

        {edges.map((edge, i) => {
          const a = nodeMap.get(edge.source);
          const b = nodeMap.get(edge.target);
          if (!a || !b) return null;
          const color = SEVERITY_COLORS[edge.severity] || "#1e3a5f";
          const lineWidth = 1 + (edge.weight || 0) * 2;
          const isHighlighted = activeNode === edge.source || activeNode === edge.target;
          return (
            <EdgeLine key={`e-${i}`} a={a} b={b} color={color} lineWidth={lineWidth} highlighted={isHighlighted}
              onClick={() => onEdgeClick?.(edge.source, edge.target)} />
          );
        })}

        {emergentInteractions.map((ei, i) => {
          const triNodes = (ei.drugs || []).map((d) => nodeMap.get(d)).filter(Boolean) as NodePosition[];
          if (triNodes.length < 3) return null;
          return <TriangleConnector key={`em-${i}`} nodes={triNodes} />;
        })}

        {nodePositions.map((node) => (
          <DrugNode key={node.drug_name} node={node}
            isHovered={activeNode === node.drug_name}
            isTouchDevice={isTouchDevice}
            isLocked={lockedNode === node.drug_name}
            onHover={setHoveredNode}
            onTap={(name) => {
              // Toggle lock: tapping the same node again unlocks it; tapping
              // a different node moves the lock there.
              setLockedNode((curr) => (curr === name ? null : name));
            }} />
        ))}
      </group>
    </>
  );
}

function EmptyGraph() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.3;
      ref.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.2) * 0.2;
    }
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshStandardMaterial color="#1e3a5f" wireframe transparent opacity={0.2} />
      </mesh>
      <Text position={[0, -2.2, 0]} fontSize={0.2} color="#4a6080" anchorX="center">
        No interaction data available
      </Text>
      <Text position={[0, -2.6, 0]} fontSize={0.1} color="#334155" anchorX="center">
        Run an analysis to see the drug interaction graph
      </Text>
    </group>
  );
}

function DrugNode({ node, isHovered, isTouchDevice, isLocked, onHover, onTap }: {
  node: NodePosition; isHovered: boolean;
  isTouchDevice: boolean;
  isLocked: boolean;
  onHover: (name: string | null) => void;
  onTap: (name: string) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const baseSize = node.is_hub ? 0.38 : 0.24;
  const size = isHovered ? baseSize * 1.35 : baseSize;
  const color = node.is_hub ? "#7c4dff" : "#00e5ff";

  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.position.copy(node.pos);
      if (node.is_hub) meshRef.current.scale.setScalar(1 + Math.sin(clock.getElapsedTime() * 2) * 0.08);
    }
    if (glowRef.current) glowRef.current.position.copy(node.pos);
  });

  return (
    <group>
      {/* Hub ambient glow (always on hubs) */}
      {node.is_hub && (
        <mesh ref={glowRef} position={node.pos}>
          <sphereGeometry args={[baseSize * 2, 16, 16]} />
          <meshStandardMaterial color={color} transparent opacity={0.08} side={THREE.BackSide} />
        </mesh>
      )}
      {/* Active highlight ring — shown when hovered (mouse) or locked (touch).
          Locked rings are thicker and stay visible to communicate persistence. */}
      {isHovered && (
        <mesh position={node.pos} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[baseSize + 0.1, baseSize + (isLocked ? 0.22 : 0.16), 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={isLocked ? 0.9 : 0.7} />
        </mesh>
      )}
      {/* The node sphere itself — pointer events drive hover (mouse) or tap
          (touch). On touch devices we suppress onPointerOver/Out because they
          fire only briefly during a tap and would race with the lock state. */}
      <mesh ref={meshRef} position={node.pos}
        onPointerOver={isTouchDevice
          ? undefined
          : (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(node.drug_name); }}
        onPointerOut={isTouchDevice
          ? undefined
          : () => onHover(null)}
        onPointerDown={isTouchDevice
          ? (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onTap(node.drug_name); }
          : undefined}>
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial color={color} emissive={color}
          emissiveIntensity={isHovered ? 0.9 : 0.4}
          transparent opacity={0.92} metalness={0.2} roughness={0.35} />
      </mesh>
      <Text position={[node.pos.x, node.pos.y + size + 0.22, node.pos.z]}
        fontSize={isHovered ? 0.26 : 0.22}
        color={isHovered ? "#f1f5f9" : "#cbd5e1"}
        anchorX="center" anchorY="bottom" outlineWidth={0.014} outlineColor="#020817"
        fontWeight={isHovered ? 700 : 500}>
        {node.drug_name}
      </Text>
      {node.is_hub && (
        <Text position={[node.pos.x, node.pos.y - size - 0.22, node.pos.z]}
          fontSize={0.15} color="#a78bfa" anchorX="center" anchorY="top"
          outlineWidth={0.01} outlineColor="#020817"
          fontWeight={700}>★ HUB</Text>
      )}
    </group>
  );
}

function EdgeLine({ a, b, color, lineWidth, highlighted, onClick }: {
  a: NodePosition; b: NodePosition; color: string; lineWidth: number;
  highlighted: boolean; onClick: () => void;
}) {
  // Use current positions directly — re-renders driven by parent forceUpdate
  return (
    <Line
      points={[
        [a.pos.x, a.pos.y, a.pos.z],
        [b.pos.x, b.pos.y, b.pos.z],
      ]}
      color={color}
      lineWidth={highlighted ? lineWidth * 1.5 : lineWidth}
      transparent
      opacity={highlighted ? 0.9 : 0.6}
      onClick={onClick}
    />
  );
}

function TriangleConnector({ nodes }: { nodes: NodePosition[] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (meshRef.current && nodes.length >= 3) {
      const geo = meshRef.current.geometry as THREE.BufferGeometry;
      const positions = new Float32Array([
        nodes[0].pos.x, nodes[0].pos.y, nodes[0].pos.z,
        nodes[1].pos.x, nodes[1].pos.y, nodes[1].pos.z,
        nodes[2].pos.x, nodes[2].pos.y, nodes[2].pos.z,
      ]);
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.computeVertexNormals();
    }
  });
  return (
    <mesh ref={meshRef}>
      <bufferGeometry />
      <meshBasicMaterial color="#7c4dff" transparent opacity={0.12} side={THREE.DoubleSide} />
    </mesh>
  );
}
