"use client";

import { useEffect, useRef, useState } from "react";

// Ticks a number up from 0 on mount. Skips straight to the value when the
// user prefers reduced motion.
export function CountUp({
  value,
  decimals = 1,
  suffix = "",
  durationMs = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce ? 0 : durationMs;
    const start = performance.now();
    const tick = (now: number) => {
      const t = dur === 0 ? 1 : Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, durationMs]);

  return (
    <span className="font-mono tabular-nums">
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
