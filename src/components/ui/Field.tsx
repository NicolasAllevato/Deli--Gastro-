"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface FieldBase {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  icon?: ReactNode;
}

interface InputFieldProps
  extends FieldBase,
    Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  as?: "input";
}

interface TextareaFieldProps
  extends FieldBase,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  as: "textarea";
  rows?: number;
}

type FieldProps = InputFieldProps | TextareaFieldProps;

export function Field(props: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const { label, hint, error, required, icon, as, className, ...rest } = props;

  const labelEl = (
    <label
      htmlFor={id}
      className="block text-xs font-bold text-gray-600 ml-4 mb-2 uppercase tracking-widest"
    >
      {label}
      {required && (
        <span className="ml-1 text-red-500" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );

  const controlClasses = cn(
    "w-full px-6 py-4 rounded-2xl neumorphic-inset text-gray-800 outline-none focus:ring-2 focus:ring-brand-orange/50 transition-all font-bold",
    as === "textarea" && "resize-none",
    className
  );

  const ariaProps = {
    id,
    required,
    "aria-invalid": error ? ("true" as const) : undefined,
    "aria-describedby":
      [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined,
  };

  const controlEl =
    as === "textarea" ? (
      <textarea
        {...(rest as Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">)}
        {...ariaProps}
        rows={(props as TextareaFieldProps).rows}
        className={controlClasses}
      />
    ) : (
      <input
        {...(rest as Omit<InputHTMLAttributes<HTMLInputElement>, "id">)}
        {...ariaProps}
        className={controlClasses}
      />
    );

  return (
    <div className="w-full">
      {labelEl}
      <div className="relative">
        {controlEl}
        {icon !== undefined && (
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none">
            {icon}
          </span>
        )}
      </div>
      {error !== undefined && (
        <p
          id={errorId}
          role="alert"
          className="text-[11px] font-bold text-red-500 ml-4 mt-1"
        >
          {error}
        </p>
      )}
      {hint !== undefined && (
        <p id={hintId} className="text-[11px] text-gray-500 ml-4 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
