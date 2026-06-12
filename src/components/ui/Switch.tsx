"use client";

import type { KeyboardEvent } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  "aria-label": ariaLabel,
  id,
}: SwitchProps) {
  function handleClick() {
    if (!disabled) {
      onChange(!checked);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!disabled) {
        onChange(!checked);
      }
    }
  }

  const track = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        "relative w-12 h-6 rounded-full neumorphic-inset transition-colors shrink-0",
        checked ? "bg-brand-orange/15" : "",
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          "absolute top-1 w-4 h-4 rounded-full transition-all duration-300",
          checked
            ? "left-7 bg-brand-orange shadow-[0_2px_6px_rgba(255,123,0,0.4)]"
            : "left-1 neumorphic bg-[#e2e8f0]",
        ].join(" ")}
      />
    </button>
  );

  if (label) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-bold text-gray-700 leading-snug">
            {label}
          </span>
          {hint && (
            <span className="text-xs text-gray-500 leading-snug">
              {hint}
            </span>
          )}
        </div>
        {track}
      </div>
    );
  }

  return track;
}
