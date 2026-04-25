"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

/* ── Central wireframe orb — rotating icosahedron ── */
function CentralOrb() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      ref.current.rotation.y = t * 0.25;
      ref.current.rotation.x = t * 0.12;
      ref.current.rotation.z = Math.sin(t * 0.15) * 0.1;
    }
  });

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.4, 2]} />
        <meshStandardMaterial
          color="#00e5ff"
          emissive="#7c4dff"
          emissiveIntensity={0.25}
          roughness={0.15}
          metalness={0.9}
          wireframe
          transparent
          opacity={0.45}
        />
      </mesh>
    </Float>
  );
}

/* ── DNA Double Helix ── */
function DNAHelix() {
  const groupRef = useRef<THREE.Group>(null);

  const helixData = useMemo(() => {
    const strand1: { pos: [number, number, number]; color: string }[] = [];
    const strand2: { pos: [number, number, number]; color: string }[] = [];
    const bonds: { a: [number, number, number]; b: [number, number, number] }[] = [];
    const count = 40;

    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 5;
      const y = (i / count) * 10 - 5;
      const r = 1.6;

      const p1: [number, number, number] = [Math.cos(t) * r, y, Math.sin(t) * r];
      const p2: [number, number, number] = [Math.cos(t + Math.PI) * r, y, Math.sin(t + Math.PI) * r];

      strand1.push({ pos: p1, color: i % 3 === 0 ? "#00e5ff" : "#38bdf8" });
      strand2.push({ pos: p2, color: i % 3 === 0 ? "#7c4dff" : "#a78bfa" });

      if (i % 4 === 0) {
        bonds.push({ a: p1, b: p2 });
      }
    }

    return { strand1, strand2, bonds };
  }, []);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.12;
    }
  });

  return (
    <group ref={groupRef} position={[5.5, 0, -2]}>
      {/* Strand 1 */}
      {helixData.strand1.map((p, i) => (
        <mesh key={`s1-${i}`} position={p.pos}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial
            color={p.color}
            emissive={p.color}
            emissiveIntensity={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
      {/* Strand 2 */}
      {helixData.strand2.map((p, i) => (
        <mesh key={`s2-${i}`} position={p.pos}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial
            color={p.color}
            emissive={p.color}
            emissiveIntensity={0.5}
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
      {/* Cross bonds */}
      {helixData.bonds.map((b, i) => {
        const pts = [new THREE.Vector3(...b.a), new THREE.Vector3(...b.b)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color: "#00bfa5",
          transparent: true,
          opacity: 0.2,
        });
        return (
          <primitive key={`bond-${i}`} object={new THREE.Line(geo, mat)} />
        );
      })}
    </group>
  );
}

/* ── Floating molecule nodes ── */
function MoleculeNode({
  position,
  color,
  size,
}: {
  position: [number, number, number];
  color: string;
  size: number;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      ref.current.position.y =
        position[1] + Math.sin(t * 0.5 + position[0] * 2) * 0.35;
      ref.current.position.x =
        position[0] + Math.cos(t * 0.3 + position[1]) * 0.15;
      ref.current.rotation.x = t * 0.2;
      ref.current.rotation.z = t * 0.12;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <icosahedronGeometry args={[size, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.35}
        roughness={0.25}
        metalness={0.8}
        transparent
        opacity={0.65}
      />
    </mesh>
  );
}

/* ── Ambient particle cloud ── */
function AmbientParticles({ count = 150 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 24;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 18;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    return arr;
  }, [count]);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = clock.getElapsedTime() * 0.015;
      ref.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.01) * 0.08;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#00e5ff"
        size={0.035}
        transparent
        opacity={0.45}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/* ── Connection lines from molecules to center ── */
function ConnectionLine({
  start,
  end,
}: {
  start: [number, number, number];
  end: [number, number, number];
}) {
  const lineObject = useMemo(() => {
    const pts = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: "#00e5ff",
      transparent: true,
      opacity: 0.1,
    });
    return new THREE.Line(geo, mat);
  }, [start, end]);

  return <primitive object={lineObject} />;
}

/* ── Main Export ── */
export function HeroBackground() {
  const molecules = [
    { pos: [-3.5, 2.2, -1.5] as [number, number, number], color: "#00e5ff", size: 0.28 },
    { pos: [3.8, -1.2, -0.8] as [number, number, number], color: "#7c4dff", size: 0.22 },
    { pos: [-2.5, -2.8, 1.2] as [number, number, number], color: "#00bfa5", size: 0.32 },
    { pos: [4.2, 2.8, -2.5] as [number, number, number], color: "#a78bfa", size: 0.18 },
    { pos: [-4.8, 0.5, -1.8] as [number, number, number], color: "#00e676", size: 0.24 },
    { pos: [1.8, 3.2, -3.5] as [number, number, number], color: "#38bdf8", size: 0.2 },
    { pos: [-1.2, -3.5, -2] as [number, number, number], color: "#7c4dff", size: 0.16 },
  ];

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight position={[6, 5, 5]} intensity={0.7} color="#00e5ff" />
      <pointLight position={[-5, -4, 3]} intensity={0.4} color="#7c4dff" />
      <pointLight position={[0, 0, 6]} intensity={0.25} color="#00bfa5" />

      <CentralOrb />
      <DNAHelix />
      <AmbientParticles />

      {molecules.map((m, i) => (
        <MoleculeNode key={i} position={m.pos} color={m.color} size={m.size} />
      ))}

      {/* Connection lines from molecules to center */}
      {molecules.slice(0, 4).map((m, i) => (
        <ConnectionLine key={`line-${i}`} start={m.pos} end={[0, 0, 0]} />
      ))}
    </>
  );
}
