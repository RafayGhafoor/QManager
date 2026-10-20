"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// RevealButton — an icon button that reveals its label on hover or focus
// =============================================================================
// Used where a row of text buttons would crowd the edge (Band Locking's
// select/deselect, Tower Locking's clear / keep-after-reboot). In a flex row an expanding
// button pushes its neighbour along instead of covering it. The width change is
// a container size change, so it runs on `standard` / `--ease-standard`; reduced
// motion shows the label with no transition. Touch has no hover, so those
// buttons stay icon-only and keep their aria-label.
//
// `blockedReason` blocks the click without `disabled`, so the reason stays
// focusable and tooltipped (same contract as `SaveButton`).
// =============================================================================

export interface RevealButtonProps
  extends Omit<ComponentProps<typeof Button>, "children" | "size"> {
  glyph: MaterialSymbolName;
  label: string;
  /** Label type size. `xs` suits a dense toolbar; `sm` matches a neighbouring `size="action"` button. */
  labelSize?: "xs" | "sm";
  blockedReason?: string | null;
}

export function RevealButton({
  glyph,
  label,
  labelSize = "xs",
  blockedReason = null,
  variant = "tonal-neutral",
  className,
  onClick,
  ...props
}: RevealButtonProps) {
  const blocked = Boolean(blockedReason);

  const button = (
    <Button
      type="button"
      variant={variant}
      aria-label={blockedReason ? `${label} — ${blockedReason}` : label}
      aria-disabled={blocked || undefined}
      data-blocked={blocked || undefined}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(
        "group/reveal h-[2.625rem] gap-0 px-3 data-[blocked]:cursor-not-allowed data-[blocked]:opacity-55",
        className,
      )}
      {...props}
    >
      <MaterialSymbol name={glyph} size={18} className="flex-none" />
      <span className="max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-[var(--duration-standard)] ease-[var(--ease-standard)] group-hover/reveal:max-w-40 group-hover/reveal:opacity-100 group-focus-visible/reveal:max-w-40 group-focus-visible/reveal:opacity-100 motion-reduce:transition-none">
        <span
          className={cn(
            "block whitespace-nowrap pl-2 pr-0.5 font-semibold",
            labelSize === "sm" ? "text-sm" : "text-xs",
          )}
        >
          {label}
        </span>
      </span>
    </Button>
  );

  if (!blockedReason) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent className="max-w-72">{blockedReason}</TooltipContent>
    </Tooltip>
  );
}
