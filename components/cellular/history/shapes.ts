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
  NOTES_BLOCK: "flex flex-col gap-1",
  NOTES: "text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 tabular-nums",
  NOTE: "text-on-surface-variant text-xs leading-5",
} as const;

/** One card per band of the page; a strip, never a two-up tile. */
export const STACK = "flex flex-col gap-5";

/**
 * The page's one grid, for the two cards that are lists rather than strips.
 * `FULL` is how a card takes the whole row back at a narrow column.
 */
export const GRID = "grid grid-cols-1 gap-5 @3xl/main:grid-cols-2";
export const FULL = "@3xl/main:col-span-2";

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
  HEADLINE: "text-[1.75rem] leading-9 font-bold tracking-[-0.02em] tabular-nums",
  SUB: "text-on-surface-variant flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] leading-5 tabular-nums",
} as const;

/** The availability strip, and every other percentage strip on the page. */
export const STRIP = {
  ROOT: "flex flex-col gap-1.5",
  /** The readout holds its line height so hovering never shifts the strip. */
  READOUT: "text-on-surface-variant min-h-5 text-xs leading-5 tabular-nums",
  TRACK:
    "flex h-11 items-end gap-px overflow-hidden rounded-tile bg-surface-container-high",
  /** Past ~180 cells the gutters are wider than the cells; drop them. */
  TRACK_DENSE: "gap-0",
  CELL: "min-h-[2px] min-w-0 flex-1 self-end rounded-[1px]",
  TICKS: "relative h-4",
  TICK: "text-on-surface-variant absolute -translate-x-1/2 text-[0.6875rem] leading-4 tabular-nums whitespace-nowrap",
  LEGEND: "flex flex-wrap items-center gap-4",
  LEGEND_ITEM:
    "text-on-surface-variant inline-flex items-center gap-1.5 text-xs leading-4 font-medium",
  LEGEND_TRACK:
    "bg-surface-container-high flex h-3.5 w-3.5 items-end overflow-hidden rounded-[2px]",
  LEGEND_SWATCH: "w-full rounded-[1px]",
} as const;

/** Outage spans, as receipt rows under the availability strip. */
export const OUTAGES = {
  LIST: "mt-1 flex flex-col",
  ROW: "border-border flex items-center justify-between gap-4 border-t py-2 text-[0.8125rem] leading-5 first:border-t-0",
  WHEN: "flex min-w-0 items-center gap-2 tabular-nums",
  DURATION: "text-on-surface-variant tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// The night pattern (day × hour matrix)
// -----------------------------------------------------------------------------

export const PATTERN = {
  SCROLL: "w-full overflow-x-auto",
  GRID: "grid min-w-[26rem] items-center gap-[3px]",
  ROW_LABEL:
    "text-on-surface-variant pe-2 text-[0.6875rem] leading-4 font-semibold tabular-nums whitespace-nowrap",
  CELL: "aspect-square w-full rounded-[2px]",
  /** An hour nothing was recorded in: the recessed track, no hue. */
  CELL_UNKNOWN: "aspect-square w-full rounded-[2px] bg-surface-container-high",
  HOUR_LABEL:
    "text-on-surface-variant text-center text-[0.625rem] leading-4 font-medium tabular-nums",
  AXIS: "text-on-surface-variant text-[0.6875rem] leading-4 font-semibold",
} as const;

// -----------------------------------------------------------------------------
// The serving-cell gantt
// -----------------------------------------------------------------------------

export const TIMELINE = {
  STRIP: "flex h-12 w-full overflow-hidden rounded-tile",
  RUN: "relative flex min-w-0 flex-col justify-center overflow-hidden px-1.5",
  RUN_LABEL: "truncate text-[0.6875rem] leading-4 font-semibold tabular-nums",
  /** The availability rule under a run: the run's own verdict, not the cell's. */
  RUN_RULE: "absolute inset-x-0 bottom-0 h-[3px]",
  /** A run too narrow for a label still gets a tick, so it is visibly present. */
  RUN_TICK: "mx-auto block h-1.5 w-1 rounded-pill",
  LANES: "flex flex-col gap-2",
  LANE: "flex items-center gap-3",
  LANE_LABEL:
    "text-on-surface-variant w-8 shrink-0 text-[0.6875rem] leading-4 font-semibold tracking-[0.06em] uppercase",
  TRACK:
    "relative h-9 w-full overflow-hidden rounded-tile bg-surface-container-high",
  SEGMENT: "absolute inset-y-0 flex items-center overflow-hidden rounded-[2px] px-1.5",
  SEGMENT_LABEL: "truncate text-[0.6875rem] leading-4 font-semibold tabular-nums",
  TICKS: "relative mt-1 h-4",
  TICK: "text-on-surface-variant absolute -translate-x-1/2 text-[0.6875rem] leading-4 tabular-nums whitespace-nowrap",
  LEGEND: "mt-1 flex flex-wrap items-center gap-4",
  LEGEND_ITEM:
    "text-on-surface-variant inline-flex items-center gap-1.5 text-xs leading-4 font-medium",
  LEGEND_SWATCH: "h-[3px] w-3.5 flex-none rounded-pill",
} as const;

/**
 * A band's tone inside a lane. Both variants of a leg are authored fill/ink
 * pairs — never an alpha wash — because a wash over a light track loses the ink
 * that sits on top of it.
 *
 * The variant is chosen by the band string itself (see `bandVariant`), so the
 * same band always wears the same tone and two adjacent runs of different bands
 * are told apart before the label is read.
 */
export const BAND_TONE = {
  lte: [
    { fill: "bg-lte", ink: "text-lte-foreground" },
    { fill: "bg-lte-container", ink: "text-on-lte-container" },
  ],
  nr: [
    { fill: "bg-primary", ink: "text-primary-foreground" },
    { fill: "bg-primary-container", ink: "text-on-primary-container" },
  ],
  /** No band reported: a band is identity, so its absence has no hue. */
  unknown: { fill: "bg-surface-container-high", ink: "text-on-surface-variant" },
} as const;

// -----------------------------------------------------------------------------
// The band set (combos)
// -----------------------------------------------------------------------------

export const BANDS = {
  TRACK:
    "relative h-9 w-full overflow-hidden rounded-tile bg-surface-container-high",
  SEGMENT: "absolute inset-y-0 flex items-center overflow-hidden rounded-[2px] px-1.5",
  SEGMENT_LABEL: "truncate text-[0.6875rem] leading-4 font-semibold tabular-nums",
  /** A combo key in the table: its strip tone, then the combo string. */
  COMBO: "flex items-center gap-2 text-[0.8125rem] font-semibold tabular-nums",
  SWATCH: "h-3 w-3 shrink-0 rounded-[2px]",
} as const;

/**
 * The tone ramp a band combo is hashed into.
 *
 * Four authored fill/ink pairs, and every one is a role this page already paints
 * with — never a raw hex, never a `--chart-*` stroke. A stroke token has no ink
 * of its own, and the combo's label sits ON the fill, so a stroke would need a
 * foreground invented for it. The order is fixed: it is the hash's modulo, so
 * reordering this array repaints every combo.
 */
export const COMBO_TONE = [
  { fill: "bg-lte", ink: "text-lte-foreground" },
  { fill: "bg-primary", ink: "text-primary-foreground" },
  { fill: "bg-lte-container", ink: "text-on-lte-container" },
  { fill: "bg-primary-container", ink: "text-on-primary-container" },
] as const;

export type ComboTone = (typeof COMBO_TONE)[number];

/**
 * A combo's tone, stable across renders, ranges and reloads.
 *
 * Exported because the legend keys the top combos with the SAME function: a
 * legend swatch that drifted from the strip would be worse than no legend (the
 * two would disagree about what violet means).
 *
 * A djb2 hash of the whole string, seeded with the length so two combos of
 * different widths are not separated by their last character alone. The modulo
 * is the ramp's length; nothing here is random, and nothing reads the clock.
 */
export function comboTone(bands: string | null): ComboTone {
  const text = bands ?? "";
  let hash = 5381 + text.length * 131;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return COMBO_TONE[(hash >>> 0) % COMBO_TONE.length];
}

// -----------------------------------------------------------------------------
// Charts
// -----------------------------------------------------------------------------

/** One chart box, ONE height in every state — loaded, loading, empty, error. */
export const CHART_BOX = "h-[190px] w-full";

export const CHART = {
  ROOT: "flex min-w-0 flex-col gap-2",
  TITLE:
    "text-on-surface-variant flex flex-wrap items-baseline gap-x-2 text-xs leading-4 font-medium",
  UNIT: "text-on-surface-variant text-[0.6875rem] leading-4",
  GRID: "grid grid-cols-1 gap-x-6 gap-y-5 @2xl/card:grid-cols-2",
  /** The "no readings" hole: the chart box's own height, so nothing jumps. */
  EMPTY:
    "grid place-items-center rounded-tile bg-surface-container-high px-4 text-center text-xs leading-5",
  TOOLTIP:
    "border-border bg-card flex flex-col gap-1 rounded-tile border px-3 py-2 text-xs shadow-[var(--shadow-whisper)] tabular-nums",
  TOOLTIP_MOMENT: "font-semibold",
  TOOLTIP_ROW: "flex items-center justify-between gap-3",
  TOOLTIP_KEY: "text-on-surface-variant",
} as const;

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

export const IDENTITY = {
  GRID: "grid grid-cols-2 gap-x-6 gap-y-3 @xl/card:grid-cols-3",
  ROW: "flex min-w-0 flex-col gap-0.5",
  LABEL: "text-on-surface-variant truncate text-xs leading-4 font-medium",
  VALUE: "text-sm leading-5 font-semibold tabular-nums",
  ABSENT: "text-on-surface-variant text-sm leading-5 font-semibold",
  AS_OF: "text-on-surface-variant col-start-1 text-xs leading-5 tabular-nums",
} as const;

/** The page legend: a strip, NOT a card — it may not read as the first panel. */
export const LEGEND = {
  ROOT: "bg-surface-container-high flex flex-col gap-2 rounded-tile px-4 py-3",
  TITLE:
    "text-on-surface-variant text-[0.6875rem] leading-4 font-semibold tracking-[0.06em] uppercase",
  GROUPS: "grid grid-cols-1 gap-x-6 gap-y-2.5 @md/card:grid-cols-2 @4xl/card:grid-cols-3",
  GROUP: "flex min-w-0 flex-col gap-1",
  GROUP_LABEL: "text-on-surface-variant text-[0.6875rem] leading-4 font-semibold",
  ITEMS:
    "text-on-surface-variant flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4",
  ITEM: "inline-flex items-center gap-1.5",
  /** A series key drawn as the stroke itself: a 2px rule, the line's own width. */
  LINE: "h-0.5 w-4 shrink-0 rounded-pill",
  BAND_SWATCH: "h-3 w-3 shrink-0 rounded-[2px]",
  NOTES: "flex flex-col gap-0.5",
  NOTE: "text-on-surface-variant text-[0.6875rem] leading-4",
} as const;

// -----------------------------------------------------------------------------
// Tables and lists
// -----------------------------------------------------------------------------

/** The per-cell table: key left, values right, one row per cell. */
export const TABLE = {
  ROOT: "w-full border-collapse text-[0.8125rem] leading-5",
  HEAD:
    "text-on-surface-variant pb-2 text-[0.6875rem] leading-4 font-semibold tracking-[0.06em] uppercase",
  ROW: "border-border border-t",
  CELL: "py-2",
  CELL_FIRST: "py-2 text-start",
  FIGURE: "text-end tabular-nums",
  QUIET: "text-on-surface-variant",
  PROSE: "text-on-surface-variant pt-1 text-xs leading-5",
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
