"use client";

import { Canvas } from "@react-three/fiber";
import { Preload } from "@react-three/drei";
import { Suspense } from "react";

interface SceneProps {
  children: React.ReactNode;
  className?: string;
  camera?: {
    position?: [number, number, number];
    fov?: number;
  };
}

export function Scene({
  children,
  className = "",
  camera = { position: [0, 0, 5], fov: 60 },
}: SceneProps) {
  return (
    <Canvas
      className={className}
      camera={camera}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      }}
      style={{ background: "transparent" }}
    >
      <Suspense fallback={null}>
        {/* Global lighting */}
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.5} color="#06b6d4" />
        <pointLight
          position={[-10, -10, -10]}
          intensity={0.3}
          color="#8b5cf6"
        />

        {children}

        <Preload all />
      </Suspense>
    </Canvas>
  );
}
