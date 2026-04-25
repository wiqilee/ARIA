"use client";

import { useMemo, useEffect, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789αβγδεζηθ";

interface DataStreamProps {
  position?: "top-right" | "bottom-left" | "top-left" | "bottom-right";
  lines?: number;
}

export function DataStream({
  position = "top-right",
  lines = 8,
}: DataStreamProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 120);
    return () => clearInterval(interval);
  }, []);

  const streamLines = useMemo(() => {
    return Array.from({ length: lines }, (_, i) => ({
      id: i,
      length: 12 + Math.floor(Math.random() * 20),
      speed: 1 + Math.random() * 2,
      offset: Math.floor(Math.random() * 30),
    }));
  }, [lines]);

  const positionClasses: Record<string, string> = {
    "top-right": "top-20 right-4",
    "bottom-left": "bottom-4 left-4",
    "top-left": "top-20 left-4",
    "bottom-right": "bottom-4 right-4",
  };

  return (
    <div
      className={`fixed ${positionClasses[position]} pointer-events-none -z-10 font-mono text-[10px] leading-tight opacity-[0.06]`}
    >
      {streamLines.map((line) => {
        const charIndex = Math.floor(tick * line.speed + line.offset);
        const text = Array.from(
          { length: line.length },
          (_, j) => CHARS[(charIndex + j * 3) % CHARS.length],
        ).join("");

        return (
          <div key={line.id} className="text-primary whitespace-nowrap">
            {text}
          </div>
        );
      })}
    </div>
  );
}
