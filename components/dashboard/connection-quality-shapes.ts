// Connection Quality (dashboard): the card's geometry, shared by the loaded view
// and its skeleton. Restated from the fork's `components/dashboard/shapes.ts`;
// the dashboard composition row (ledger U4.10) folds it into that file.

/** The card shell, as on the fork's dashboard. */
export const CARD_SHELL =
  "@container/card h-full gap-4 rounded-card border-0 px-6 py-6 shadow-[var(--shadow-whisper)]";

export const CARD_TITLE = "text-lg font-semibold";

/** A card's supporting line, in the surface's secondary ink. */
export const CARD_DESC = "text-on-surface-variant text-sm leading-relaxed";

/** The 40px metric row: label left, value right, on a tonal pill. */
export const ROW = {
  ROOT: "flex items-center justify-between gap-3 rounded-pill bg-surface-container px-4 py-2.5",
  /** Mirrors ROOT's resolved height, for the skeleton. */
  HEIGHT: "h-10",
} as const;

/** The figure in a metric row: `on-surface`, never a role colour. */
export const VALUE_CLASS = "text-sm font-semibold text-on-surface";

/** What a value cell renders when the datum is absent. An em dash, never a hyphen. */
export const ABSENT = "—";

/** How often the "n min ago" label re-renders. */
export const CLOCK_TICK_MS = 30_000;

/**
 * BUCKETS is both the cell count and the bucketing divisor; the heights are px
 * for inline styles.
 */
export const QUALITY = {
  BUCKETS: 28,
  /** The window both strips cover, in seconds. */
  WINDOW_S: 1800,
  TRACK_H: 26,
  /** An unmeasured jitter bucket's stub; kept well below MEASURED_MIN_H. */
  STUB_H: 3,
  MEASURED_MIN_H: 7,
  GAP: "gap-[3px]",
  CELL: "min-w-0 flex-1 rounded-[3px]",
  BAR: "min-w-0 flex-1 rounded-[2px]",
  ROW: "flex items-end",
  LABEL_ROW: "flex h-4 items-center justify-between gap-2",
  /** The bar lane between a label and a value column. */
  LANE: "w-11 shrink-0",
  /** Fixed so both latency rows share a right edge whatever their digit counts. */
  VALUE_COL: "w-16 shrink-0 text-right whitespace-nowrap",
  /** The latency tile, shared by the card and its skeleton. */
  TILE: "flex flex-col gap-2 rounded-tile bg-surface-container p-3.5",
} as const;
