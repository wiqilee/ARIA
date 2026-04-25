"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface PatientAvatar3DProps {
  sex?: string;
}

/**
 * PatientAvatar3D — Holographic 3D anatomical figure
 * FIXED: Increased opacity and emissive intensity for visibility on dark backgrounds
 */
export function PatientAvatar3D({ sex = "unknown" }: PatientAvatar3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const scanRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const isFemale = sex === "female";
  const bodyColor = "#22b8e8";
  const hologramColor = "#06d6e8";
  const organColor = "#9b7aff";
  const skeletonColor = "#2a5580";

  const particlePositions = useMemo(() => {
    const positions = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.5;
      const y = (Math.random() - 0.5) * 2.8;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    return positions;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.5;
    }
    if (scanRef.current) {
      const cycle = ((t * 0.8) % 2);
      const y = cycle <= 1 ? -1.2 + cycle * 2.4 : 1.2 - (cycle - 1) * 2.4;
      scanRef.current.position.y = y;
      (scanRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.5 + Math.sin(t * 4) * 0.2;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.1;
      (particlesRef.current.material as THREE.PointsMaterial).opacity =
        0.45 + Math.sin(t * 2) * 0.15;
    }
  });

  return (
    <group>
      <ambientLight intensity={0.8} />
      <pointLight position={[2, 3, 2]} intensity={1.2} color="#06d6e8" />
      <pointLight position={[-2, -1, 1]} intensity={0.5} color="#9b7aff" />
      <pointLight position={[0, 0, 3]} intensity={0.7} color="#22b8e8" />
      <pointLight position={[0, 2, -2]} intensity={0.6} color="#06d6e8" />

      {/* Floating data particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[particlePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          color={hologramColor}
          size={0.02}
          transparent
          opacity={0.55}
          sizeAttenuation
        />
      </points>

      <group ref={groupRef} position={[0, -0.2, 0]}>

        {/* ═══ SKELETAL WIREFRAME ═══ */}
        <mesh position={[0, 0.4, -0.02]}>
          <cylinderGeometry args={[0.012, 0.012, 1.5, 4]} />
          <meshBasicMaterial color={skeletonColor} transparent opacity={0.55} />
        </mesh>
        {[0.65, 0.55, 0.45, 0.35].map((y, i) => (
          <mesh key={`rib-${i}`} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.12 + i * 0.02, 0.005, 4, 12, Math.PI]} />
            <meshBasicMaterial color={skeletonColor} transparent opacity={0.35} />
          </mesh>
        ))}
        <mesh position={[0, 0.05, 0]} rotation={[0.1, 0, 0]}>
          <torusGeometry args={[0.12, 0.005, 4, 12, Math.PI]} />
          <meshBasicMaterial color={skeletonColor} transparent opacity={0.48} />
        </mesh>

        {/* ═══ ORGAN SYSTEMS ═══ */}
        <HeartOrgan position={[0.03, 0.7, 0.05]} />
        {/* Lungs */}
        <mesh position={[-0.1, 0.65, 0.02]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color={organColor} transparent opacity={0.42} emissive={organColor} emissiveIntensity={0.9} />
        </mesh>
        <mesh position={[0.1, 0.65, 0.02]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color={organColor} transparent opacity={0.42} emissive={organColor} emissiveIntensity={0.9} />
        </mesh>
        {/* Liver */}
        <mesh position={[0.08, 0.45, 0.04]}>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color="#f5b020" transparent opacity={0.38} emissive="#f5b020" emissiveIntensity={0.8} />
        </mesh>
        {/* Kidneys */}
        <mesh position={[-0.1, 0.35, -0.03]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#f06060" transparent opacity={0.42} emissive="#f06060" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[0.1, 0.35, -0.03]}>
          <sphereGeometry args={[0.035, 8, 6]} />
          <meshStandardMaterial color="#f06060" transparent opacity={0.42} emissive="#f06060" emissiveIntensity={0.8} />
        </mesh>
        {/* Brain glow */}
        <mesh position={[0, 1.25, 0]}>
          <sphereGeometry args={[0.14, 12, 12]} />
          <meshStandardMaterial color={organColor} transparent opacity={0.35} emissive={organColor} emissiveIntensity={0.8} />
        </mesh>

        {/* ═══ BODY SHELL — increased opacity ═══ */}
        {/* Head */}
        <mesh position={[0, 1.25, 0]}>
          <sphereGeometry args={[0.22, 20, 20]} />
          <meshStandardMaterial
            color={bodyColor} transparent opacity={0.55}
            emissive={bodyColor} emissiveIntensity={0.45}
            metalness={0.4} roughness={0.3}
          />
        </mesh>
        <mesh position={[0, 1.25, 0]}>
          <sphereGeometry args={[0.225, 12, 12]} />
          <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.35} />
        </mesh>

        {/* Neck */}
        <mesh position={[0, 1.0, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.12, 8]} />
          <meshStandardMaterial color={bodyColor} transparent opacity={0.48} emissive={bodyColor} emissiveIntensity={0.3} />
        </mesh>

        {/* Torso */}
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[
            isFemale ? 0.2 : 0.25,
            isFemale ? 0.18 : 0.2,
            0.8, 12
          ]} />
          <meshStandardMaterial
            color={bodyColor} transparent opacity={0.48}
            emissive={bodyColor} emissiveIntensity={0.35}
            metalness={0.3} roughness={0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[
            isFemale ? 0.21 : 0.26,
            isFemale ? 0.19 : 0.21,
            0.82, 12
          ]} />
          <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.28} />
        </mesh>

        {/* Hips */}
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[
            isFemale ? 0.18 : 0.2,
            isFemale ? 0.22 : 0.18,
            0.25, 10
          ]} />
          <meshStandardMaterial color={bodyColor} transparent opacity={0.45} emissive={bodyColor} emissiveIntensity={0.28} side={THREE.DoubleSide} />
        </mesh>

        {/* Left arm */}
        <group position={[-0.32, 0.7, 0]} rotation={[0, 0, 0.15]}>
          <mesh position={[0, -0.22, 0]}>
            <cylinderGeometry args={[0.055, 0.045, 0.45, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.45} emissive={bodyColor} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[0, -0.22, 0]}>
            <cylinderGeometry args={[0.058, 0.048, 0.46, 6]} />
            <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.22} />
          </mesh>
          <mesh position={[0, -0.52, 0]}>
            <cylinderGeometry args={[0.045, 0.035, 0.35, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.42} emissive={bodyColor} emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[0, -0.35, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.7, 3]} />
            <meshBasicMaterial color={skeletonColor} transparent opacity={0.4} />
          </mesh>
        </group>

        {/* Right arm */}
        <group position={[0.32, 0.7, 0]} rotation={[0, 0, -0.15]}>
          <mesh position={[0, -0.22, 0]}>
            <cylinderGeometry args={[0.055, 0.045, 0.45, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.45} emissive={bodyColor} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[0, -0.22, 0]}>
            <cylinderGeometry args={[0.058, 0.048, 0.46, 6]} />
            <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.22} />
          </mesh>
          <mesh position={[0, -0.52, 0]}>
            <cylinderGeometry args={[0.045, 0.035, 0.35, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.42} emissive={bodyColor} emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[0, -0.35, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.7, 3]} />
            <meshBasicMaterial color={skeletonColor} transparent opacity={0.4} />
          </mesh>
        </group>

        {/* Left leg */}
        <group position={[-0.1, -0.15, 0]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.07, 0.055, 0.55, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.45} emissive={bodyColor} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.073, 0.058, 0.56, 6]} />
            <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.22} />
          </mesh>
          <mesh position={[0, -0.65, 0]}>
            <cylinderGeometry args={[0.055, 0.04, 0.45, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.42} emissive={bodyColor} emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.85, 3]} />
            <meshBasicMaterial color={skeletonColor} transparent opacity={0.4} />
          </mesh>
        </group>

        {/* Right leg */}
        <group position={[0.1, -0.15, 0]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.07, 0.055, 0.55, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.45} emissive={bodyColor} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.073, 0.058, 0.56, 6]} />
            <meshStandardMaterial color={hologramColor} wireframe transparent opacity={0.22} />
          </mesh>
          <mesh position={[0, -0.65, 0]}>
            <cylinderGeometry args={[0.055, 0.04, 0.45, 8]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.42} emissive={bodyColor} emissiveIntensity={0.25} />
          </mesh>
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.85, 3]} />
            <meshBasicMaterial color={skeletonColor} transparent opacity={0.4} />
          </mesh>
        </group>

        {/* ═══ HOLOGRAPHIC EFFECTS ═══ */}
        <mesh ref={scanRef} position={[0, 0, 0]}>
          <planeGeometry args={[0.9, 0.02]} />
          <meshBasicMaterial
            color={hologramColor} transparent opacity={0.55}
            side={THREE.DoubleSide}
          />
        </mesh>

        <ScanRing />

        {/* Base platform */}
        <mesh position={[0, -1.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.25, 0.35, 24]} />
          <meshBasicMaterial color={hologramColor} transparent opacity={0.22} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -1.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.36, 24]} />
          <meshBasicMaterial color={hologramColor} transparent opacity={0.22} side={THREE.DoubleSide} />
        </mesh>

        {/* Vertical data lines */}
        {[-0.2, 0, 0.2].map((x, i) => (
          <mesh key={`vline-${i}`} position={[x, 0.1, -0.25]}>
            <planeGeometry args={[0.002, 2.2]} />
            <meshBasicMaterial color={hologramColor} transparent opacity={0.1} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ── Pulsing heart organ ─────────────────────────────────

function HeartOrgan({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const t = clock.getElapsedTime();
      const beat = Math.pow(Math.sin(t * 3.77) * 0.5 + 0.5, 3);
      ref.current.scale.setScalar(1 + beat * 0.3);
      (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + beat * 0.7;
    }
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshStandardMaterial
        color="#f06060"
        transparent
        opacity={0.4}
        emissive="#f06060"
        emissiveIntensity={0.9}
      />
    </mesh>
  );
}

// ── Scanning ring effect ────────────────────────────────

function ScanRing() {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (ringRef.current) {
      const t = clock.getElapsedTime();
      const cycle = ((t * 0.8) % 2);
      const y = cycle <= 1 ? -1.2 + cycle * 2.4 : 1.2 - (cycle - 1) * 2.4;
      ringRef.current.position.y = y - 0.2;
      ringRef.current.rotation.x = Math.PI / 2;

      const bodyWidth = 0.2 + Math.abs(Math.sin((y + 0.5) * 1.2)) * 0.15;
      ringRef.current.scale.set(bodyWidth * 3, bodyWidth * 3, 1);

      (ringRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.18 + Math.sin(t * 6) * 0.1;
    }
  });

  return (
    <mesh ref={ringRef}>
      <ringGeometry args={[0.9, 1.0, 32]} />
      <meshBasicMaterial color="#06d6e8" transparent opacity={0.38} side={THREE.DoubleSide} />
    </mesh>
  );
}