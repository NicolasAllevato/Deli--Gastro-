import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardSurface = "raised" | "inset";
type CardRadius = "lg" | "xl" | "2xl" | "3xl" | "full-lg";
type CardPadding = "none" | "sm" | "md" | "lg";

interface CardProps extends HTMLAttributes<HTMLElement> {
  surface?: CardSurface;
  radius?: CardRadius;
  padding?: CardPadding;
  hover?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

const surfaceClasses: Record<CardSurface, string> = {
  raised: "neumorphic",
  inset: "neumorphic-inset",
};

const radiusClasses: Record<CardRadius, string> = {
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  "3xl": "rounded-3xl",
  "full-lg": "rounded-[2.5rem]",
};

const paddingClasses: Record<CardPadding, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function Card({
  surface = "raised",
  radius = "2xl",
  padding = "md",
  hover = false,
  as: Component = "div",
  children,
  className,
  ...rest
}: CardProps) {
  return (
    <Component
      className={cn(
        surfaceClasses[surface],
        radiusClasses[radius],
        paddingClasses[padding],
        hover && "card-hover-lift",
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
