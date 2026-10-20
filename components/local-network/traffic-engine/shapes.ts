// Traffic Engine: this family's geometry, imported by the loaded views and their skeletons.
// Restated from the IP Passthrough and Tailscale families, never imported across families.

import type { BadgeVariant } from "@/components/ui/badge";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] min-w-0 flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

/** The rest tone for a ghost pill in the page header. */
export const HEADER_PILL =
  "bg-surface-container text-on-surface-variant hover:bg-surface-container-high";

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

/** The Engine card, then the two mode cards. */
export const STACK = "flex flex-col gap-5";

/** The Video Optimizer / Masquerade pair: one height per row (Symmetric-Pair Rule). */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @4xl/main:grid-cols-2 *:data-[slot=card]:h-full";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor: the Engine card, one per route. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-[1.625rem] shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-7";

/** Header: title block left, chip and Back on the header's right edge. */
export const CARD_HEAD = "gap-1.5";
export const CARD_TITLE = "min-w-0 text-lg leading-tight font-semibold";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Chips and Back share the header's right edge; wraps under the title on a phone. */
export const CARD_ACTION = "flex flex-wrap items-center justify-end gap-2";

/** The one region inside a stretched card that absorbs the slack. */
export const CARD_BODY = "flex min-h-0 flex-1 flex-col gap-5";

/** An in-card view: replaces the card body and keeps the card's place in the grid. */
export const VIEW = "flex min-h-0 min-w-0 flex-1 flex-col";

/** The Back pill in `CardAction`. */
export const BACK_BUTTON = "text-on-surface-variant -mr-2";

/** A label above a control or group (Label style, `on-surface-variant`). */
export const LABEL = "text-on-surface-variant text-[0.8125rem] leading-5 font-medium";

/** The setting label, its one-line hint, and the reason a control is locked. */
export const FIELD = {
  ROW: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
  TEXT: "min-w-0 flex-[1_1_12rem]",
  LABEL_ROW: "flex items-center gap-1.5",
  LABEL: "text-on-surface text-sm font-medium",
  HINT: "text-on-surface-variant mt-0.5 text-[0.8125rem] leading-5",
  ERROR: "mt-1.5",
  /** The disguise-domain input: mono, a comfortable measure on a wide card. */
  INPUT_WRAP: "w-full min-w-0 @md/card:w-auto @md/card:flex-[0_1_17rem]",
  INPUT: "font-mono text-[0.8125rem]",
} as const;

// -----------------------------------------------------------------------------
// Metric rows
// -----------------------------------------------------------------------------

/** 40px pill rows on `surface-container` (DESIGN.md > Metric rows). */
const ROW_HEIGHT = "h-10";

export const ROWS = "flex flex-col gap-1.5";

/** Package view: three across once a row would span too far (Row-Span Rule). */
export const ROWS_3 = "grid grid-cols-1 gap-1.5 @3xl/card:grid-cols-3 @3xl/card:gap-x-2.5";

export const METRIC = {
  ROOT: `flex ${ROW_HEIGHT} min-w-0 items-center justify-between gap-3 rounded-pill bg-surface-container px-4 text-[0.8125rem] leading-5 font-semibold`,
  KEY: "text-on-surface-variant flex-none whitespace-nowrap",
  VALUE: "flex min-w-0 items-center justify-end gap-1.5 truncate text-right tabular-nums",
  VALUE_ON: "text-on-surface",
  VALUE_QUIET: "text-on-surface-variant",
  MONO: "font-mono text-[0.78125rem] font-medium",
  GLYPH: "size-3.5 flex-none",
  /** The drill row is the same pill, made a button with a trailing chevron. */
  DRILL:
    "w-full cursor-pointer text-left transition-[background-color] duration-[var(--duration-quick)] ease-out hover:bg-surface-container-high focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none",
  CHEVRON:
    "text-on-surface-variant size-4 flex-none transition-transform duration-[var(--duration-quick)] ease-out group-hover/drill:translate-x-0.5 motion-reduce:transition-none",
} as const;

// -----------------------------------------------------------------------------
// Engine card
// -----------------------------------------------------------------------------

/** Controls left, the live chart right, once the card is wide enough (5/7). */
export const ENGINE_GRID =
  "grid grid-cols-1 gap-[1.375rem] @[46rem]/card:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @[46rem]/card:gap-7";

/** The control column is its own card container so the mode control can fall back to a Select. */
export const CONTROL_COL = "@container/card flex min-w-0 flex-col gap-2";

export const MODE_REASON = "text-on-surface-variant text-[0.8125rem] leading-5";

/** The rows sit a step below the mode control; Hotspot bypass a step below them. */
export const ENGINE_ROWS = "mt-2.5";
export const HOTSPOT_ROW = "mt-3";

/** Hotspot bypass's On/Off pill keeps its natural width. */
export const HOTSPOT_CTL = "flex-none";

// -----------------------------------------------------------------------------
// Live chart
// -----------------------------------------------------------------------------

/** The plot's pinned height, shared with its skeleton. */
export const CHART_HEIGHT_PX = 172;
const CHART_HEIGHT = "h-[10.75rem]";

/** The rate never draws against a ceiling under this, so the wash marks a real level. */
export const CHART_FLOOR = 500;

export const LIVE = {
  ROOT: "flex min-w-0 flex-col gap-2.5",
  HEAD: "flex flex-wrap items-end justify-between gap-x-4 gap-y-2",
  LEGEND: "text-on-surface-variant inline-flex items-center gap-[0.4375rem] text-xs font-medium",
  LEGEND_DOT: "size-2 flex-none rounded-pill bg-uplink-on-surface",
  NUMERAL: "flex items-baseline gap-1.5 tabular-nums",
  ARROW:
    "text-uplink-on-surface size-5 self-center transition-opacity duration-[var(--duration-standard)] ease-standard",
  /** 40px line box: the skeleton reads the same height. */
  RATE: "text-[2.5rem] leading-10 font-semibold tracking-[-0.02em] transition-[color] duration-[var(--duration-standard)] ease-standard",
  RATE_ON: "text-uplink-on-surface",
  RATE_OFF: "text-on-surface-variant",
  UNIT: "text-on-surface-variant text-sm font-medium",
  PLOT: `relative ${CHART_HEIGHT} min-w-0`,
  GRIDLINE: "stroke-border",
  LINE: "fill-none stroke-uplink-on-surface",
  ENDPOINT: "fill-uplink-on-surface",
  /** The page's one ambient loop, only while packets are flowing. */
  ENDPOINT_RING:
    "fill-uplink-on-surface origin-center [transform-box:fill-box] animate-live-ping",
  Y_LABEL:
    "text-on-surface-variant pointer-events-none absolute left-0 -translate-y-[115%] text-[0.6875rem] leading-none tabular-nums",
  EMPTY:
    "text-on-surface-variant absolute inset-0 grid place-items-center text-[0.8125rem] font-medium",
  X_AXIS: "text-on-surface-variant mt-1.5 flex justify-between text-[0.6875rem]",
} as const;

/** The wash under the line, top to bottom. */
export const CHART_WASH = { TOP: 0.32, BOTTOM: 0 } as const;

// -----------------------------------------------------------------------------
// What the carrier sees
// -----------------------------------------------------------------------------

/** The card's one inner container (One-Nest Rule). */
export const STRIP = {
  TILE: "@container/tile flex flex-col gap-3 rounded-tile bg-surface-container px-4 pt-3.5 pb-3",
  HEAD: "flex min-h-5 items-center justify-between gap-2",
  EYEBROW: "text-on-surface-variant inline-flex items-center gap-1.5 text-xs font-medium",
  ROW: "flex h-16 items-stretch gap-1",
  BLOCK:
    "flex min-w-0 origin-left flex-col justify-center gap-0.5 overflow-hidden rounded-inline px-2.5 transition-[background-color,color] duration-[var(--duration-standard)] ease-standard",
  BLOCK_REST: "bg-surface-container-high text-on-surface-variant",
  /** The blocks the carrier reads, promoted while the mode runs (Highlight-by-Container). */
  BLOCK_READ: "bg-primary-container text-on-primary-container",
  FRAGMENT: "min-w-[0.5625rem] flex-[0_1_1.875rem] items-center px-0",
  DECOY: "flex-1",
  REAL: "min-w-[5.75rem] flex-[1.3_1_0]",
  TITLE: "truncate text-[0.6875rem] font-semibold",
  FRAGMENT_TITLE: "truncate text-[0.625rem] font-semibold @max-[22rem]/tile:hidden",
  MONO: "truncate font-mono text-[0.71875rem]",
  AXIS: "text-on-surface-variant flex items-center gap-2 text-[0.6875rem]",
  AXIS_RULE: "relative h-px flex-1 bg-border",
  AXIS_HEAD:
    "absolute top-1/2 -right-px size-0 -translate-y-1/2 border-y-[3.5px] border-l-[5px] border-y-transparent border-l-border",
} as const;

// -----------------------------------------------------------------------------
// Desync strength stepper
// -----------------------------------------------------------------------------

export const STEPPER = {
  ROOT: "inline-flex h-[2.625rem] flex-none items-center gap-1 rounded-pill bg-surface-container p-[3px]",
  BUTTON: "text-on-surface hover:bg-surface-container-high focus-visible:ring-offset-surface-container",
  VALUE: "min-w-[2.125rem] text-center text-base font-semibold tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// Check row (Verify / Test injection)
// -----------------------------------------------------------------------------

export const CHECK = {
  ROOT: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5",
  TEXT: "min-w-0 flex-[1_1_14rem]",
  RESULT:
    "text-on-surface-variant animate-banner-in flex basis-full flex-wrap items-center gap-2 text-[0.8125rem] leading-5",
  RESULT_FIGURE: "text-on-surface font-semibold tabular-nums",
  RESULT_MONO: "text-on-surface font-mono text-[0.78125rem]",
} as const;

// -----------------------------------------------------------------------------
// Hostnames view
// -----------------------------------------------------------------------------

export const HOSTS = {
  /** Add-domain field and its button on one line; wraps under on a phone. */
  TOOLBAR: "flex flex-wrap items-start gap-2",
  INPUT_WRAP: "min-w-0 flex-[1_1_14rem]",
  INPUT: "font-mono text-[0.8125rem]",
  /** The list scrolls inside the card so the pair keeps one height. */
  SCROLL:
    "-mr-2 min-h-0 flex-1 overflow-y-auto pr-2 [scrollbar-width:thin] @4xl/main:max-h-[25rem]",
  LIST: "flex flex-col gap-4",
  GROUP_HEAD:
    "text-on-surface-variant flex items-baseline gap-2 px-1 pb-1 text-xs font-medium",
  GROUP_COUNT: "tabular-nums opacity-80",
  ROW: "flex h-10 min-w-0 items-center gap-2 rounded-field pr-1 pl-3 transition-[background-color] duration-[var(--duration-quick)] ease-out hover:bg-surface-container",
  NAME: "text-on-surface min-w-0 flex-1 truncate font-mono text-[0.8125rem]",
  REMOVE: "text-on-surface-variant hover:text-on-surface",
  EMPTY:
    "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-tile bg-surface-container px-5 py-7 text-center",
  EMPTY_TITLE: "text-base font-semibold",
  EMPTY_TEXT: "text-on-surface-variant max-w-sm text-sm text-pretty",
} as const;

// -----------------------------------------------------------------------------
// Conditions (load failure, not installed)
// -----------------------------------------------------------------------------

export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-1 flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-xl font-semibold tracking-[-0.01em]",
  DESC: "max-w-[42ch] text-sm leading-relaxed text-pretty opacity-90",
  ACTIONS: "mt-2.5 flex flex-wrap items-center justify-center gap-2.5",
  /** Install progress: the step dots beside the step in flight. */
  STEP: "text-on-surface-variant inline-flex min-h-5 items-center gap-2.5 text-[0.8125rem]",
  /** The notice under the actions keeps a readable measure. */
  NOTES: "flex w-full max-w-md flex-col gap-2 text-left",
} as const;

export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-on-surface-variant text-surface",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

/** Step progress dots (Loader-and-Dots Rule). */
export const DOTS = {
  ROOT: "inline-flex items-center gap-1",
  DOT: "size-1.5 rounded-pill transition-[background-color] duration-[var(--duration-quick)] ease-out",
  ON: "bg-primary",
  OFF: "bg-surface-container-high",
} as const;

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/** A result notice: a solid tonal container, never a wash. */
export const NOTICE =
  "rounded-field flex items-start gap-2.5 px-3.5 py-2.5 text-xs leading-[1.45] font-medium";
export const NOTICE_GLYPH = "mt-px size-3.5 flex-none";
export const NOTICE_BODY = "min-w-0 flex-1 break-words";
export const NOTICE_DETAIL = "mt-0.5 block font-normal opacity-85";

export type NoticeTone = Extract<
  BadgeVariant,
  "success" | "warning" | "destructive" | "info"
>;

/** Info is brand: it takes the primary container, there is no separate info hue. */
export const NOTICE_TONE = {
  success: "bg-success-container text-on-success-container",
  warning: "bg-warning-container text-on-warning-container",
  destructive: "bg-destructive-container text-on-destructive-container",
  info: "bg-primary-container text-on-primary-container",
} satisfies Record<NoticeTone, string>;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every placeholder reads its geometry from the loaded view's own constant. */
export const SKELETON = {
  TITLE: "h-[1.375rem] w-28 rounded-inline",
  DESC: "h-5 w-52 max-w-full rounded-inline",
  BADGE: "h-6 w-28 rounded-pill",
  LABEL: "h-5 w-12 rounded-inline",
  CONTROL: "h-[2.625rem] w-full rounded-pill",
  ROW: `${ROW_HEIGHT} w-full rounded-pill`,
  LEGEND: "h-4 w-32 rounded-inline",
  RATE: "h-10 w-36 rounded-inline",
  CHART: `${CHART_HEIGHT} w-full rounded-tile`,
  STRIP: "h-[8.25rem] w-full rounded-tile",
  FIELD: "h-[2.625rem] w-full rounded-pill",
  FOOT_STATUS: "h-5 w-32 rounded-inline",
  FOOT_ACTION: "h-9 w-40 rounded-pill",
} as const;
