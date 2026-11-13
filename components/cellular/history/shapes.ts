// Cell History: this family's geometry, tone and label contract, imported by
// the loaded views AND their skeletons. Restated here, never imported across
// families (the pattern `components/monitoring/latency-monitoring/shapes.ts`
// established).
//
// The one map that is NOT restated is the availability tier: `TIER` is keyed onto
// `AvailabilityTier` from ./derive, so the legend and the strip read the same
// object and cannot drift.

import type { BadgeVariant } from "@/components/ui/badge";
import type { MaterialSymbolName } from "@/components/ui/material-symbol";

import type { AvailabilityTier } from "./derive";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** The range pill, the refresh action and the coverage notes, above the cards. */
export const CONTROLS = {
  ROOT: "flex flex-col gap-3",
  ROW: "flex flex-wrap items-center gap-2.5",
  NOTES: "text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 tabular-nums",
  NOTE: "text-on-surface-variant text-xs leading-5",
} as const;

/** One card per band of the page; never a two-up grid, every card is a strip. */
export const STACK = "flex flex-col gap-5";

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

export const EYEBROW =
  "text-on-surface-variant text-[0.6875rem] leading-[0.875rem] font-semibold tracking-[0.06em] uppercase";

// -----------------------------------------------------------------------------
// Availability (the page's hero)
// -----------------------------------------------------------------------------

/**
 * The four tiers, keyed onto the derivation's own type so a tier without a tone
 * is a build failure. Colour never carries the verdict alone: each tier also
 * owns a BAR HEIGHT inside the track, and the legend draws those same heights,
 * so the shape of the strip survives greyscale, sunlight and deuteranopia.
 */
export const TIER = {
  up: {
    fill: "bg-success",
    height: "h-full",
    labelKey: "history.availability.tier.up",
  },
  partial: {
    fill: "bg-warning",
    height: "h-3/5",
    labelKey: "history.availability.tier.partial",
  },
  down: {
    fill: "bg-destructive",
    height: "h-2/5",
    labelKey: "history.availability.tier.down",
  },
  // The recessed track itself: a bucket nobody determined draws nothing on it.
  unknown: {
    fill: "bg-transparent",
    height: "h-0",
    labelKey: "history.availability.tier.unknown",
  },
} as const satisfies Record<
  AvailabilityTier,
  { fill: string; height: string; labelKey: string }
>;

export const HERO = {
  HEADLINE:
    "text-[1.75rem] leading-9 font-bold tracking-[-0.02em] tabular-nums",
  SUB: "text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] leading-5 tabular-nums",
  STRIP: {
    ROOT: "flex flex-col gap-1.5",
    /** The readout holds its line height so hovering never shifts the strip. */
    READOUT:
      "text-on-surface-variant min-h-5 text-xs leading-5 tabular-nums",
    TRACK: "flex h-11 items-end gap-px overflow-hidden rounded-tile bg-surface-container-high",
    /** Past ~180 cells the gutters are wider than the cells; drop them. */
    TRACK_DENSE: "gap-0",
    CELL: "min-h-[2px] min-w-0 flex-1 self-end rounded-[1px]",
    TICKS: "relative h-4",
    TICK:
      "text-on-surface-variant absolute -translate-x-1/2 text-[0.6875rem] leading-4 tabular-nums",
    LEGEND: "flex flex-wrap items-center gap-4",
    LEGEND_ITEM:
      "text-on-surface-variant inline-flex items-center gap-1.5 text-xs leading-4 font-medium",
    LEGEND_TRACK:
      "bg-surface-container-high flex h-3.5 w-3.5 items-end overflow-hidden rounded-[2px]",
    LEGEND_SWATCH: "w-full rounded-[1px]",
  },
} as const;

/** Outage spans, as receipt rows under the strip. */
export const OUTAGES = {
  LIST: "mt-1 flex flex-col",
  ROW: "border-border flex items-center justify-between gap-4 border-t py-2 text-[0.8125rem] leading-5 first:border-t-0",
  WHEN: "flex min-w-0 items-center gap-2 tabular-nums",
  DURATION: "text-on-surface-variant tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Serving cell timeline
// -----------------------------------------------------------------------------

export const TIMELINE = {
  STRIP: "flex h-12 w-full overflow-hidden rounded-tile",
  RUN: "relative flex min-w-0 flex-col justify-center overflow-hidden px-1.5",
  RUN_LABEL:
    "truncate text-[0.6875rem] leading-4 font-semibold tabular-nums",
  /** The availability rule under a run: the run's own verdict, not the cell's. */
  RUN_RULE: "absolute inset-x-0 bottom-0 h-[3px]",
  /** A run too narrow for a label still gets a tick, so it is visibly present. */
  RUN_TICK: "mx-auto block h-1.5 w-1 rounded-pill",
  TICKS: "relative mt-1 h-4",
  TICK:
    "text-on-surface-variant absolute -translate-x-1/2 text-[0.6875rem] leading-4 tabular-nums",
  LEGEND: "mt-1 flex flex-wrap items-center gap-4",
  LEGEND_ITEM:
    "text-on-surface-variant inline-flex items-center gap-1.5 text-xs leading-4 font-medium",
  LEGEND_SWATCH: "h-[3px] w-3.5 flex-none rounded-pill",
} as const;

/** The per-cell table: key left, values right, one row per cell. */
export const TABLE = {
  ROOT: "w-full border-collapse text-[0.8125rem] leading-5",
  HEAD:
    "text-on-surface-variant pb-2 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase",
  ROW: "border-border border-t",
  CELL: "py-2",
  CELL_FIRST: "py-2 text-start",
  FIGURE: "text-end tabular-nums",
  QUIET: "text-on-surface-variant",
} as const;

// -----------------------------------------------------------------------------
// Cell changes
// -----------------------------------------------------------------------------

export const EVENTS = {
  LIST: "flex flex-col",
  ROW: "border-border flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t py-2 first:border-t-0",
  WHEN: "text-on-surface-variant w-24 shrink-0 text-xs leading-5 tabular-nums",
  CHANGE: "flex flex-wrap items-center gap-1.5 text-[0.8125rem] leading-5",
  QUIET: "text-on-surface-variant font-semibold",
  EMPTY: "text-on-surface-variant text-sm",
  FOOT: "text-on-surface-variant pt-2 text-xs leading-5 tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// States
// -----------------------------------------------------------------------------

export const SKELETON = {
  HERO: "h-56 rounded-card",
  CARD: "h-48 rounded-card",
} as const;

/**
 * The availability card's status chip: a verdict, so a filled `Badge` with a
 * glyph — never `variant="outline"`, and never a fill without the glyph, because
 * success/partial/down containers sit ~1.03:1 apart to a reader with
 * deuteranopia.
 */
export const VERDICT = {
  up: { variant: "success", glyph: "check_circle", labelKey: "history.verdict.up" },
  partial: {
    variant: "warning",
    glyph: "warning",
    labelKey: "history.verdict.partial",
  },
  down: {
    variant: "destructive",
    glyph: "error",
    labelKey: "history.verdict.down",
  },
  unknown: {
    variant: "muted",
    glyph: "help",
    labelKey: "history.verdict.unknown",
  },
} as const satisfies Record<
  AvailabilityTier,
  { variant: BadgeVariant; glyph: MaterialSymbolName; labelKey: string }
>;

/**
 * A serving run's availability rule, keyed onto the same tier type as the strip:
 * a cell that held 5G the whole run reads success, one that held none reads
 * destructive, a mixed run reads warning, and a run nobody determined reads as
 * plain ink (not a verdict — nobody looked).
 */
export const RUN_TONE = {
  up: "bg-success",
  partial: "bg-warning",
  down: "bg-destructive",
  unknown: "bg-on-surface-variant/40",
} as const satisfies Record<AvailabilityTier, string>;

/** A run's tier from its own percentage, so the rule and the table agree. */
export function runTier(pct: number | null): AvailabilityTier {
  if (pct === null) return "unknown";
  if (pct >= 100) return "up";
  if (pct <= 0) return "down";
  return "partial";
}
