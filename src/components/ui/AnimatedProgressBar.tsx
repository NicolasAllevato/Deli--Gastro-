"use client";

import { useEffect, useState } from "react";

interface AnimatedProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  label?: string;
}

export function AnimatedProgressBar({ value, max = 100, className, label }: AnimatedProgressBarProps) {
  const [width, setWidth] = useState(0);
  const target = Math.min((value / max) * 100, 100);

  useEffect(() => {
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setWidth(target));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [target]);

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-label={label}
      className={className ?? "h-3 rounded-full neumorphic-inset"}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-brand-orange transition-all duration-700 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
