import type { BadgeVariant } from "@/components/ui/badge";

// Prometheus — the /monitoring/prometheus geometry and tone contract.
// Skeletons import the same constants the loaded views do (Skeleton-Mirror).
// Geometry is RESTATED from the sibling families (system-settings rows,
// watchdog conditions), never imported: what is shared is the system's numbers,
// not a module.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper. Container queries key off `@container/main`. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

// -----------------------------------------------------------------------------
// The card
// -----------------------------------------------------------------------------

export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";
export const CARD_PAD = "px-6";
export const CARD_BODY = "flex min-h-0 flex-1 flex-col";
export const CARD_TITLE = "min-w-0 text-lg leading-tight";
/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/**
 * The card's one inner container. On a wide card the scrape config moves
 * beside the settings rows instead of under them (`@5xl/card:`), but it stays
 * inside this group, so the card never grows a second container.
 */
export const GROUP = {
  ROOT: "grid grid-cols-1 gap-0.5 rounded-tile bg-surface-container p-1.5",
  SPLIT: "@5xl/card:grid-cols-2",
  /**
   * Each column re-declares `@container/card`, so a row's side-by-side flip
   * keys off the column it sits in, not the whole card: on a split card a
   * half-width column would otherwise squeeze its consequence into a sliver.
   */
  COLUMN: "@container/card flex min-w-0 flex-col gap-0.5",
} as const;

/** One setting row; label and consequence left, control right once there is room. */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** A row whose body is a block (token field, config): never flips. */
  STACK_ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4",
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL_LINE: "flex items-center gap-1.5",
  LABEL: "text-[0.9375rem] font-semibold",
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
  /** The facts that apply right now, under the consequence. */
  FACTS: "flex flex-wrap items-center gap-1.5 pt-1",
} as const;

/** A chip's glyph (The Every-Chip-Has-A-Glyph Rule). */
export const CHIP_GLYPH = "size-3";

/** The 42px field height, mirrored by the skeleton. */
const FIELD_HEIGHT = "h-[2.625rem]";

export const TOKEN = {
  LINE: "flex flex-col gap-2.5 @2xl/card:flex-row @2xl/card:items-center",
  FIELD_WRAP: "relative min-w-0 flex-1",
  /** Opaque string: mono (Typography — "a string you compare"). */
  FIELD: `${FIELD_HEIGHT} w-full pr-11 font-mono text-[0.8125rem] tracking-tight`,
  TOGGLE:
    "text-on-surface-variant hover:text-on-surface absolute top-1/2 right-1.5 -translate-y-1/2",
  ACTIONS: "flex flex-none flex-wrap items-center gap-2",
  GLYPH: "size-4",
} as const;

/**
 * The 44px coarse-pointer target as a pseudo-element overlay, so the in-field
 * toggle keeps its painted 32px and the field keeps its baseline.
 */
export const COARSE_TARGET =
  "before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-['']";

/**
 * The scrape config. Its host is the group (`surface-container`), so the block
 * takes one step up (The Field-Step Rule). Raw config text is the one place on
 * this card mono belongs as a block.
 */
export const SNIPPET = {
  ROOT: "flex min-h-[5rem] min-w-0 flex-col gap-3 rounded-field px-4 py-4",
  HEAD: "flex items-start gap-3",
  BLOCK:
    "bg-surface-container-high text-on-surface overflow-x-auto rounded-field px-4 py-3.5 font-mono text-[0.75rem] leading-[1.6] whitespace-pre selection:bg-primary/25",
} as const;

// -----------------------------------------------------------------------------
// Conditions (load error)
// -----------------------------------------------------------------------------

export type ConditionTone = Extract<BadgeVariant, "destructive">;

export const CONDITION = {
  ROOT: "bg-destructive-container text-on-destructive-container flex flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "bg-destructive text-destructive-foreground grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15 mt-1 px-4",
} as const;

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

/** Every box reads the loaded view's own constant. A restated number is a lie. */
export const SKELETON = {
  /** Line boxes (font size × line height) of the text each one stands in for. */
  CARD_TITLE: "h-[1.40625rem] w-44 rounded-inline",
  CARD_DESC: "h-5 w-80 max-w-full rounded-inline",
  ROW: "min-h-[5rem] rounded-field",
  LABEL: "h-[1.40625rem] w-32 rounded-inline",
  CONSEQUENCE: "h-[1.171875rem] w-60 max-w-full rounded-inline",
  /** A SegmentedField track or a `size="action"` button. */
  PILL: `${FIELD_HEIGHT} w-40 rounded-pill`,
  FOOT: "min-h-16",
} as const;
