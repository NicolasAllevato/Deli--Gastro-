import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type MaxWidth = "md" | "lg" | "xl" | "2xl" | "full";

interface PageContainerProps {
  children: ReactNode;
  maxWidth?: MaxWidth;
  padding?: boolean;
  fade?: boolean;
  className?: string;
}

const maxWidthClasses: Record<MaxWidth, string> = {
  md: "max-w-md mx-auto",
  lg: "max-w-lg mx-auto",
  xl: "max-w-xl mx-auto",
  "2xl": "max-w-2xl mx-auto",
  full: "w-full",
};

export function PageContainer({
  children,
  maxWidth = "full",
  padding = true,
  fade = true,
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        maxWidthClasses[maxWidth],
        padding && "p-6 md:p-8",
        fade && "page-fade",
        className
      )}
    >
      {children}
    </div>
  );
}
