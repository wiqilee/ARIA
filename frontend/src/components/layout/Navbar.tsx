"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/analyze", label: "Analyze" },
  { href: "/report", label: "Report" },
  { href: "/about", label: "About" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="fixed top-0 left-0 right-0 z-50 glass border-b border-[var(--border)]"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 sm:gap-3 group">
            <div className="relative w-9 h-9">
              {/* Outer rotating ring */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{ border: "1px solid rgba(0, 229, 255, 0.25)" }}
                animate={{ rotate: 360 }}
                transition={{
                  duration: 20,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
              {/* Inner glow */}
              <div
                className="absolute inset-1 rounded-full flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(0,229,255,0.1), rgba(124,77,255,0.1))",
                  border: "1px solid rgba(0, 229, 255, 0.15)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <motion.rect
                    x="5.5"
                    y="1"
                    width="3"
                    height="12"
                    rx="1"
                    fill="url(#navGrad)"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  <motion.rect
                    x="1"
                    y="5.5"
                    width="12"
                    height="3"
                    rx="1"
                    fill="url(#navGrad)"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: 0.3,
                    }}
                  />
                  <defs>
                    <linearGradient
                      id="navGrad"
                      x1="0"
                      y1="0"
                      x2="14"
                      y2="14"
                    >
                      <stop stopColor="#00e5ff" />
                      <stop offset="1" stopColor="#7c4dff" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
            <span
              className="font-display font-bold text-xl tracking-tight"
              style={{
                background: "linear-gradient(135deg, #00e5ff 0%, #38bdf8 40%, #7c4dff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 2px 6px rgba(0, 229, 255, 0.35))",
                transition: "filter 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = "drop-shadow(0 2px 12px rgba(0, 229, 255, 0.6))";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = "drop-shadow(0 2px 6px rgba(0, 229, 255, 0.35))";
              }}
            >
              ARIA
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative px-2.5 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-300 ${
                    isActive
                      ? "text-[var(--primary)]"
                      : "text-text-muted hover:text-[var(--primary)]"
                  }`}
                  style={{ transition: "color 0.3s ease, text-shadow 0.3s ease" }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.textShadow = "0 0 12px rgba(0, 229, 255, 0.5)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.textShadow = "none";
                  }}
                >
                  <span className="relative z-10">{link.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="navbar-indicator"
                      className="absolute inset-0 rounded-lg"
                      style={{
                        background: "var(--primary-dim)",
                        border: "1px solid rgba(0, 229, 255, 0.18)",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 350,
                        damping: 30,
                      }}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </motion.nav>
  );
}
