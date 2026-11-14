// SmartDNS: this family's geometry, imported by the loaded cards and their
// skeletons. Restated from the Custom DNS family, never imported across
// families — the two pages sit next to each other in the sidebar and one must be
// free to re-space without moving the other.

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
  ACTIONS: "ml-auto flex flex-wrap items-center gap-2",
} as const;

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";
export const CARD_PAD = "px-6";
export const CARD_TITLE = "min-w-0 text-lg leading-tight";
/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

// -----------------------------------------------------------------------------
// Setting rows
// -----------------------------------------------------------------------------

const ROW_MIN_H = "min-h-[2.625rem]";
const KEY_LH = "leading-5";
/** A 42px control, the field and the segmented track alike. */
const CONTROL_H = "h-[2.625rem]";

export const SETTING = {
  /** One card's rows, single column: every row here holds a control that needs
   *  a sentence beside it, and two columns would put the sentence a card away
   *  from the thing it explains. */
  GROUP: "flex min-w-0 flex-col gap-5",
  /** Key left, control right; on a narrow card the control wraps, still right-aligned. */
  ROW: `flex ${ROW_MIN_H} flex-wrap items-center justify-between gap-x-4 gap-y-2`,
  /** Shrinks beside its control down to 12rem before the control wraps beneath it. */
  KEY: "flex min-w-0 flex-[1_1_12rem] flex-col gap-px transition-opacity duration-[var(--duration-standard)] ease-standard",
  KEY_LINE: `inline-flex items-center gap-1.5 text-sm ${KEY_LH} font-medium`,
  KEY_SUB: "text-on-surface-variant text-xs text-pretty",
  /** A held row dims its text; the disabled control dims itself, so the two never compound. */
  HELD: "opacity-55",
  CONTROL: "ml-auto flex max-w-full flex-col items-end gap-1.5",
} as const;

/** A rule under a row group: groups the list without a second container. */
export const ROW_DIVIDER = "border-outline-variant/40 border-t pt-5";

// -----------------------------------------------------------------------------
// Status readouts
// -----------------------------------------------------------------------------

/**
 * The readout strip: key above value, three across from a 36rem column. Not a
 * table — these are unrelated single facts (pid, memory, uptime), and a table
 * would imply a relationship between them.
 */
export const READOUT = {
  GRID: "grid grid-cols-2 gap-3 @2xl/card:grid-cols-3 @5xl/card:grid-cols-4",
  ROOT: "flex min-w-0 flex-col gap-0.5 rounded-tile bg-surface-container px-3 py-2",
  KEY: "text-on-surface-variant truncate text-[0.6875rem] font-medium uppercase tracking-[0.06em]",
  VALUE: "truncate text-[0.875rem] font-semibold tabular-nums",
  /** Opaque strings — a path, an address — take the machine voice. */
  VALUE_MONO: "truncate font-mono text-[0.8125rem] font-medium",
} as const;

/** A section label above a sub-list inside a card. */
export const SECTION_LABEL =
  "text-on-surface-variant text-[0.6875rem] font-medium uppercase tracking-[0.06em]";

// -----------------------------------------------------------------------------
// The daemon log tail
// -----------------------------------------------------------------------------

export const LOG = {
  VIEWPORT:
    "max-h-40 overflow-y-auto rounded-tile bg-surface-container px-3 py-2",
  BODY: "flex flex-col gap-0.5 font-mono text-[0.75rem] leading-[1.5] text-on-surface-variant",
  EMPTY: "text-on-surface-variant text-[0.8125rem]",
} as const;

// -----------------------------------------------------------------------------
// Upstream selection
// -----------------------------------------------------------------------------

/**
 * The pooled upstreams: a checkbox each. A Select would hide how many are
 * chosen and a multi-select list has no visible state on a phone, and "how many
 * resolvers is this racing" is the number that decides how the feature behaves.
 */
export const UPSTREAM = {
  GRID: "grid grid-cols-1 gap-x-6 gap-y-1 @2xl/card:grid-cols-2",
  ROW: "flex min-h-9 items-center gap-2.5 text-sm",
  ROW_HELD: "opacity-55",
  COUNT: "text-on-surface-variant text-xs tabular-nums",
} as const;

// -----------------------------------------------------------------------------
// The not-installed state
// -----------------------------------------------------------------------------

export const INSTALL = {
  ROOT: "flex flex-col gap-4",
  LEAD: "flex items-start gap-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-col gap-1",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-on-surface-variant text-[0.8125rem] text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5",
  /** The consequence list under the lead: three short facts, not prose. */
  LIST: "flex flex-col gap-1.5 rounded-tile bg-surface-container px-4 py-3",
  LIST_ITEM: "flex items-start gap-2 text-[0.8125rem] text-on-surface-variant",
  LIST_GLYPH: "mt-0.5 size-3.5 flex-none",
} as const;

// -----------------------------------------------------------------------------
// A failed read
// -----------------------------------------------------------------------------

/** One horizontal block in place of a card's rows. */
export const CONDITION = {
  ROOT: "flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-tile bg-surface-container px-4 py-3.5 text-on-surface",
  DISC: "grid size-11 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-on-surface-variant text-[0.8125rem] text-pretty",
  ACTION: "ml-auto h-9 bg-on-surface/10 px-4 text-on-surface hover:bg-on-surface/15",
} as const;

/** The foot status: a block reason or a failure, in destructive ink. */
export const FOOT = {
  BLOCKED: "text-destructive-on-surface text-xs",
  FAILED: "text-destructive-on-surface inline-flex items-center gap-1.5 text-xs",
  GLYPH: "size-3.5 shrink-0",
  /** A non-blocking statement of consequence (e.g. what the save will do). */
  NOTE: "text-on-surface-variant text-xs",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own line box. */
export const SKELETON = {
  ROW_KEY: "h-5 w-24 rounded-inline",
  ROW_SUB: "h-4 w-48 max-w-full rounded-inline",
  PILL: `${CONTROL_H} rounded-pill`,
  ACTION: `${CONTROL_H} w-40 rounded-pill`,
  READOUT: "h-12 w-full rounded-tile",
} as const;
