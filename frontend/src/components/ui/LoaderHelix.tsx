"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export function LoaderHelix() {
  const groupRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const helixData = useMemo(() => {
    const strand1: [number, number, number][] = [];
    const strand2: [number, number, number][] = [];
    const bonds: { a: [number, number, number]; b: [number, number, number] }[] = [];
    const count = 60;

    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 6;
      const y = (i / count) * 8 - 4;
      const r = 1.5;
      const p1: [number, number, number] = [Math.cos(t) * r, y, Math.sin(t) * r];
      const p2: [number, number, number] = [
        Math.cos(t + Math.PI) * r,
        y,
        Math.sin(t + Math.PI) * r,
      ];
      strand1.push(p1);
      strand2.push(p2);
      if (i % 4 === 0) bonds.push({ a: p1, b: p2 });
    }
    return { strand1, strand2, bonds };
  }, []);

  const orbPositions = useMemo(() => {
    const pos = new Float32Array(50 * 3);
    for (let i = 0; i < 50; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5;
    }
    return pos;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.35;
      groupRef.current.rotation.x = Math.sin(t * 0.2) * 0.12;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y = -t * 0.08;
    }
  });

  return (
    <>
      <ambientLight intensity={0.12} />
      <pointLight position={[3, 3, 3]} intensity={0.8} color="#00e5ff" />
      <pointLight position={[-3, -2, 2]} intensity={0.5} color="#7c4dff" />

      <group ref={groupRef}>
        {/* Strand 1 (cyan) */}
        {helixData.strand1.map((pos, i) => (
          <mesh key={`s1-${i}`} position={pos}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? "#00e5ff" : "#38bdf8"}
              emissive={i % 2 === 0 ? "#00e5ff" : "#38bdf8"}
              emissiveIntensity={0.6}
              transparent
              opacity={0.75}
            />
          </mesh>
        ))}

        {/* Strand 2 (purple) */}
        {helixData.strand2.map((pos, i) => (
          <mesh key={`s2-${i}`} position={pos}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <meshStandardMaterial
              color={i % 2 === 0 ? "#7c4dff" : "#a78bfa"}
              emissive={i % 2 === 0 ? "#7c4dff" : "#a78bfa"}
              emissiveIntensity={0.6}
              transparent
              opacity={0.75}
            />
          </mesh>
        ))}

        {/* Cross bonds */}
        {helixData.bonds.map((b, i) => {
          const pts = [new THREE.Vector3(...b.a), new THREE.Vector3(...b.b)];
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          return (
            <line key={`bond-${i}`} geometry={geo}>
              <lineBasicMaterial color="#00bfa5" transparent opacity={0.22} />
            </line>
          );
        })}
      </group>

      {/* Ambient particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={orbPositions.length / 3}
            array={orbPositions}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          color="#00e5ff"
          size={0.03}
          transparent
          opacity={0.35}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  );
}
