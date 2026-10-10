"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export interface SectionTab {
  href: string;
  label: string;
  active: boolean;
}

interface SectionTabsProps {
  label: string;
  tabs: ReadonlyArray<SectionTab>;
}

export function SectionTabs({ label, tabs }: SectionTabsProps) {
  return (
    <nav aria-label={label} className="mb-3 overflow-x-auto custom-scrollbar">
      <ul className="flex gap-1.5 w-max min-w-full p-1.5 neumorphic rounded-2xl">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "block px-4 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-200",
                tab.active
                  ? "neumorphic-inset text-brand-orange font-bold"
                  : "text-gray-500 hover:text-gray-800 hover:bg-white/40",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
