// IP Passthrough: this family's geometry, imported by the loaded views and their skeletons.
// Restated from the Watchdog and Latency Monitor families, never imported across families.
// Ported from the RM520N fork (ae2fb928); DEVICE_PICK and LOCK_NOTE are target-only.

/** `FF:FF:FF:FF:FF:FF` is the backend's sentinel for "first device to connect". */
export const AUTOMATIC_MAC = "FF:FF:FF:FF:FF:FF";

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

/** The lucide glyph inside a pill. */
export const PILL_GLYPH = "size-4";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor: the Last applied strip. */
export const HERO_SHELL =
  "@container/card gap-0 rounded-hero border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const HERO_PAD = "px-6 @[40rem]/main:px-7";

export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

const EYEBROW_LH = "leading-[0.875rem]";
export const EYEBROW = `text-on-surface-variant text-[0.6875rem] ${EYEBROW_LH} font-semibold tracking-[0.06em] uppercase`;

// -----------------------------------------------------------------------------
// The Last applied strip
// -----------------------------------------------------------------------------

/** The disc carries the mode colour; the card body stays neutral. */
export const DISC_TONE = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  info: "bg-primary text-primary-foreground",
} as const;

/** Scoped to two properties, and every custom property takes `var()`. */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none";

const STATUS_LINE = {
  TITLE: "leading-6",
  BLURB: "leading-5",
} as const;

/** The phase holds the left edge; the one fact that applies sits on the right, wrapping beneath on a narrow card. */
export const STATUS = {
  BODY: "flex flex-wrap items-center justify-between gap-x-6 gap-y-4",
  PHASE: "flex min-w-0 items-center gap-3.5",
  DISC: "grid size-11 flex-none place-items-center rounded-pill",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-col gap-0.5",
  TITLE: `text-xl ${STATUS_LINE.TITLE} font-bold tracking-[-0.01em]`,
  BLURB: `text-on-surface-variant text-[0.8125rem] ${STATUS_LINE.BLURB} text-pretty`,
} as const;

/** A failed read: one horizontal block in place of the strip's body. */
export const CONDITION = {
  ROOT: "flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-tile bg-surface-container px-4 py-3.5 text-on-surface",
  DISC: "grid size-11 flex-none place-items-center rounded-pill bg-surface-container-high text-on-surface-variant",
  GLYPH: "size-[1.375rem]",
  TEXT: "flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-on-surface-variant text-[0.8125rem] text-pretty",
  ACTION: "ml-auto h-9 bg-on-surface/10 px-4 text-on-surface hover:bg-on-surface/15",
} as const;

// -----------------------------------------------------------------------------
// The settings card
// -----------------------------------------------------------------------------

const ROW_MIN_H = "min-h-[2.625rem]";
/** A SegmentedField track: 34px segments in a 4px-padded pill. */
const PILL_H = "h-[2.625rem]";
const KEY_LH = "leading-5";

/** Two peer cards side by side from a 56rem column, stacked below it. */
export const CARD_GRID = "grid grid-cols-1 gap-5 @4xl/main:grid-cols-2";

export const SETTING = {
  /** One card's rows. */
  GROUP: "flex min-w-0 flex-col gap-3.5",
  /** Key left, control right; on a narrow card the control wraps, still right-aligned. */
  ROW: `flex ${ROW_MIN_H} flex-wrap items-center justify-between gap-x-4 gap-y-2`,
  KEY: "flex min-w-0 flex-col gap-px",
  KEY_LINE: `inline-flex items-center gap-1.5 text-sm ${KEY_LH} font-medium`,
  KEY_SUB: "text-on-surface-variant text-xs",
  /** A held row dims its text; the disabled control dims itself, so the two never compound. */
  HELD: "opacity-55",
  CONTROL: "ml-auto flex max-w-full flex-col items-end gap-1.5",
  /** USB: a Select on its own line below a 32rem card, the pill beside the key above it. */
  CONTROL_WIDE: "flex min-w-0 basis-full flex-col items-end gap-1.5 @lg/card:ml-auto @lg/card:basis-auto",
  /** The dirty marker is reserved on every row and fades in on the quick token. */
  DOT: "size-[7px] flex-none rounded-pill bg-primary transition-[opacity,transform] duration-[var(--duration-quick)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  DOT_OFF: "scale-[0.6] opacity-0",
  DOT_ON: "scale-100 opacity-100",
  UNREAD: "text-on-surface-variant py-2.5 text-[0.8125rem]",
} as const;

/** The manual MAC entry: 42px, machine voice, on `fieldVariants`. */
export const MAC_FIELD = {
  WRAP: "flex w-60 max-w-full flex-col items-end gap-1.5",
  INPUT: `${PILL_H} px-3.5 font-mono text-[0.84375rem] font-medium uppercase placeholder:font-sans placeholder:normal-case`,
  ERROR: "text-destructive-on-surface text-right text-xs leading-[1.5]",
} as const;

/**
 * Target-only: the connected-device picker under "Connected device". The list
 * is a Select (an open-ended set, not a short choice); scanning, empty and
 * failed sit in the same 42px lane so the row never jumps.
 */
export const DEVICE_PICK = {
  /** The animated slot owns the width, so `max-w-full` resolves against the row. */
  SLOT: "w-[22rem] max-w-full",
  WRAP: "flex w-full flex-col items-end gap-1.5",
  LINE: "flex w-full items-center gap-2",
  TRIGGER: `${PILL_H} w-full min-w-0 rounded-pill`,
  ITEM: "flex w-full min-w-0 items-center justify-between gap-3",
  ITEM_NAME: "min-w-0 truncate",
  ITEM_MAC: "text-on-surface-variant flex-none font-mono text-xs",
  RESCAN: `${PILL_H} w-[2.625rem] flex-none rounded-pill`,
  /** Scanning, empty or failed: one quiet line in the control's own lane. */
  NOTE: `${ROW_MIN_H} text-on-surface-variant flex w-full items-center justify-end gap-2 text-right text-[0.8125rem] text-pretty`,
  NOTE_ERROR: "text-destructive-on-surface",
  LINKS: "flex flex-wrap items-center justify-end gap-x-4 gap-y-1",
  LINK: "text-primary inline-flex items-center gap-1 text-[0.8125rem] font-semibold underline-offset-2 hover:underline focus-visible:underline",
  GLYPH: "size-3.5 flex-none",
} as const;

/**
 * Target-only: an active Verizon Custom SIM Profile owns passthrough. A fact,
 * not a fault (Fact-Is-Info): primary container, glyph on the strong fill.
 */
export const LOCK_NOTE = {
  ROOT: "flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-tile bg-primary-container px-4 py-3.5 text-on-primary-container",
  DISC: "grid size-9 flex-none place-items-center rounded-pill bg-primary text-primary-foreground",
  GLYPH: "size-[1.125rem]",
  TEXT: "flex min-w-0 flex-[1_1_14rem] flex-col gap-0.5",
  TITLE: "text-[0.9375rem] font-semibold",
  BODY: "text-[0.8125rem] text-pretty",
  ACTION: "ml-auto font-semibold underline underline-offset-2 text-[0.8125rem]",
} as const;

export const FOOT = {
  LINE: "flex min-w-0 items-center gap-2",
  DOT: "size-[7px] flex-none rounded-pill bg-primary",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own line box. */
export const SKELETON = {
  EYEBROW: `h-3.5 w-24 rounded-inline`,
  TITLE: `h-6 w-40 rounded-inline`,
  BLURB: `h-5 w-52 max-w-full rounded-inline`,
  ROW_KEY: `h-5 w-24 rounded-inline`,
  /** One line of the Mode note (12.5px at leading 1.5). */
  PILL: `${PILL_H} rounded-pill`,
} as const;
