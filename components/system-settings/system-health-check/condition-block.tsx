"use client";

import type * as React from "react";
import { RefreshCcwIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  CONDITION,
  CONDITION_TONE,
  FOCUS_RING,
  PILL_GLYPH,
  type ConditionTone,
} from "./shapes";

// The family's state block: geometry and tone from `./shapes`, glyph from
// lucide — this route's icon family.

export interface ConditionBlockProps {
  tone: ConditionTone;
  glyph: LucideIcon;
  ariaRole: "alert" | "status";
  title: string;
  description: string;
  /**
   * Machine-voice text under the sentence — the device's own words. It renders
   * INSIDE the block so the live region announces it with the alert.
   */
  detail?: React.ReactNode;
  /** Omit to render no retry affordance. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ConditionBlock({
  tone,
  glyph: Glyph,
  ariaRole,
  title,
  description,
  detail,
  onRetry,
  retryLabel,
  className,
}: ConditionBlockProps): React.JSX.Element {
  const spec = CONDITION_TONE[tone];

  return (
    <div
      role={ariaRole}
      className={cn(CONDITION.ROOT, spec.container, className)}
    >
      <span className={cn(CONDITION.DISC, spec.disc)}>
        <Glyph className={CONDITION.GLYPH} aria-hidden="true" />
      </span>
      <div className={CONDITION.TEXT}>
        <p className={CONDITION.TITLE}>{title}</p>
        <p className={CONDITION.BODY}>{description}</p>
      </div>
      {detail}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "inline-flex items-center transition-colors duration-[var(--duration-quick)] ease-out",
            FOCUS_RING,
            CONDITION.ACTION,
            spec.action,
          )}
        >
          <RefreshCcwIcon className={PILL_GLYPH} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default ConditionBlock;
