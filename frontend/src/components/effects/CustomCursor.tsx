"use client";

import { useEffect, useState } from "react";
import { motion, useSpring } from "framer-motion";

export function CustomCursor() {
  const [visible, setVisible] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const springConfig = { stiffness: 300, damping: 25 };
  const cursorX = useSpring(0, springConfig);
  const cursorY = useSpring(0, springConfig);
  const trailX = useSpring(0, { stiffness: 150, damping: 20 });
  const trailY = useSpring(0, { stiffness: 150, damping: 20 });

  useEffect(() => {
    // Only show on desktop
    if (typeof window === "undefined" || "ontouchstart" in window) return;

    const handleMove = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      trailX.set(e.clientX);
      trailY.set(e.clientY);
      if (!visible) setVisible(true);
    };

    const handleEnter = () => setVisible(true);
    const handleLeave = () => setVisible(false);

    // Detect interactive elements for hover state
    const handleOverInteractive = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const interactive =
        target.closest("a, button, [role=button], input, select, textarea, canvas");
      setIsHovering(!!interactive);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseover", handleOverInteractive);
    document.addEventListener("mouseenter", handleEnter);
    document.addEventListener("mouseleave", handleLeave);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseover", handleOverInteractive);
      document.removeEventListener("mouseenter", handleEnter);
      document.removeEventListener("mouseleave", handleLeave);
    };
  }, [visible, cursorX, cursorY, trailX, trailY]);

  if (!visible) return null;

  return (
    <>
      {/* Trail circle */}
      <motion.div
        className="fixed top-0 left-0 pointer-events-none z-[9999] rounded-full border"
        style={{
          x: trailX,
          y: trailY,
          width: isHovering ? 48 : 32,
          height: isHovering ? 48 : 32,
          borderColor: isHovering
            ? "rgba(139, 92, 246, 0.4)"
            : "rgba(6, 182, 212, 0.3)",
          translateX: "-50%",
          translateY: "-50%",
          transition: "width 0.2s, height 0.2s, border-color 0.2s",
        }}
      />

      {/* Dot */}
      <motion.div
        className="fixed top-0 left-0 pointer-events-none z-[9999] rounded-full"
        style={{
          x: cursorX,
          y: cursorY,
          width: 6,
          height: 6,
          backgroundColor: isHovering ? "#8b5cf6" : "#06b6d4",
          translateX: "-50%",
          translateY: "-50%",
          transition: "background-color 0.2s",
        }}
      />
    </>
  );
}
