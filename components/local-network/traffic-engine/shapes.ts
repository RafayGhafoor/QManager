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

/** Column 1 stacks status, tabs and the mode card; column 2 holds the hostlist. */
export const COLS = "grid grid-cols-1 items-stretch gap-5 @3xl/main:grid-cols-2";
export const STACK = "flex flex-col gap-5";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

/** The anchor: the engine status card, one per route. */
export const HERO_SHELL =
  "@container/card gap-5 rounded-hero border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";
export const CARD_TITLE = "min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant text-sm";

/** Title block left, chip pinned right; stacks on a narrow card so the chip
 *  never squeezes the description. */
export const CARD_HEAD = {
  ROOT: "flex flex-col items-start gap-3 @md/card:flex-row @md/card:gap-4",
  TEXT: "flex min-w-0 flex-col gap-1.5",
  ACTIONS: "flex flex-none flex-wrap gap-2 @md/card:ml-auto @md/card:justify-end",
} as const;

/** The one region inside a stretched card that absorbs the slack. */
export const CARD_BODY = "flex flex-1 flex-col gap-5";

const EYEBROW_LH = "leading-[0.875rem]";
export const EYEBROW = `text-on-surface-variant text-[0.6875rem] ${EYEBROW_LH} font-semibold tracking-[0.06em] uppercase`;

/** The pill height every action and its placeholder share. */
const ACTION_HEIGHT = "h-[2.625rem]";

// -----------------------------------------------------------------------------
// Engine status
// -----------------------------------------------------------------------------

/** One line box for a figure, so the transition placeholder never reflows it. */
const STAT_VALUE_LH = "leading-7";

export const STAT = {
  GRID: "grid grid-cols-3 gap-4",
  ROOT: "flex min-w-0 flex-col gap-1.5",
  VALUE_ROW: `flex items-baseline gap-1 ${STAT_VALUE_LH}`,
  VALUE: "text-xl font-semibold tabular-nums",
  VALUE_ON: "text-on-surface",
  VALUE_OFF: "text-on-surface-variant",
  UNIT: "text-on-surface-variant text-xs",
  /** Placeholder sized to the value's line box, not its glyphs. */
  PLACEHOLDER: "h-7 w-14 rounded-inline",
  TRANSITION:
    "transition-[color] duration-[var(--duration-quick)] ease-[var(--ease-standard)] motion-reduce:transition-none",
} as const;

/** The running mode's tab mark. A static dot: the badge carries the live state. */
export const TAB_DOT = "ml-1.5 size-2 flex-none rounded-pill bg-success";

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

/** 66px resting height, kept as a FLOOR so a longer translated helper can wrap. */
const SETTING_MIN_HEIGHT = "min-h-[4.125rem]";

/** A setting's tonal tile. On, it becomes a primary container. */
export const SETTING_ROW = {
  MIN_HEIGHT: SETTING_MIN_HEIGHT,
  /** Text over control on a narrow card; side by side once the pills fit. */
  ROOT: `flex ${SETTING_MIN_HEIGHT} flex-col items-stretch gap-3 rounded-tile px-[1.125rem] py-3.5 @md/card:flex-row @md/card:items-center @md/card:gap-3.5`,
  REST: "bg-surface-container text-on-surface",
  ON: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  TEXT: "min-w-0 flex-1",
  TITLE: "flex items-center gap-2 text-sm font-semibold",
  SPINNER: "size-3.5 motion-safe:animate-spin",
  DESC: "mt-0.5 text-xs opacity-85",
} as const;

/** The draft field under the setting rows: label, helper, input. */
export const FIELD = {
  ROOT: "flex flex-col gap-2",
  LABEL_ROW: "flex items-center gap-1.5",
  LABEL: "text-sm font-semibold text-on-surface",
  HELPER: "text-on-surface-variant text-xs",
  NUMBER: "h-9 w-24 tabular-nums",
  TEXT: "h-9 font-mono text-[0.8125rem] @md/card:max-w-sm",
} as const;

/** A confidence check (verify / test): text left, action right. */
export const CHECK = {
  ROOT: "flex flex-col gap-3",
  HEAD: "flex flex-wrap items-center justify-between gap-3",
  TEXT: "min-w-0 flex-1",
  TITLE_ROW: "flex items-center gap-1.5",
  TITLE: "text-sm font-semibold text-on-surface",
  DESC: "text-on-surface-variant mt-0.5 text-xs",
} as const;

// -----------------------------------------------------------------------------
// Notices
// -----------------------------------------------------------------------------

/** A result or prerequisite notice: a solid tonal container, never a wash. */
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
// Conditions (load failure, not installed)
// -----------------------------------------------------------------------------

export type ConditionTone = Extract<BadgeVariant, "muted" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-1 flex-col items-center justify-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTIONS: "mt-1 flex flex-wrap items-center justify-center gap-2.5",
  /** The notices under the actions keep a readable measure. */
  NOTES: "flex w-full max-w-md flex-col gap-2 text-left",
} as const;

export const CONDITION_TONE = {
  muted: {
    ROOT: "bg-surface-container text-on-surface",
    DISC: "bg-surface-container-high text-on-surface-variant",
    ACTION: "bg-on-surface/10 text-on-surface hover:bg-on-surface/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

// -----------------------------------------------------------------------------
// Remove (idle only)
// -----------------------------------------------------------------------------

/** Low emphasis on purpose: destructive is the button, not the whole surface. */
export const DANGER = {
  ROOT: "flex flex-wrap items-center gap-4 rounded-tile bg-surface-container px-[1.125rem] py-3.5",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "text-on-surface-variant mt-0.5 text-xs leading-[1.5]",
} as const;

// -----------------------------------------------------------------------------
// The hostlist
// -----------------------------------------------------------------------------

export const HOSTLIST = {
  HEAD_TOOLS: "flex items-center gap-1",
  SUMMARY: "text-on-surface-variant text-xs tabular-nums",
  ICON_BUTTON: "size-9 text-on-surface-variant",
  /** The card's one inner container: the scrollable pill field. */
  FIELD:
    "flex min-h-40 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto rounded-tile bg-surface-container p-3",
  PILL: "group/pill inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill py-1 pr-1 pl-3 font-mono text-[0.8125rem]",
  PILL_DEFAULT: "bg-surface-container-high text-on-surface",
  /** A domain the user added: promoted one step, with its own glyph. */
  PILL_CUSTOM: "bg-primary-container text-on-primary-container",
  PILL_GLYPH: "size-3 flex-none",
  PILL_REMOVE: "size-6 flex-none rounded-pill opacity-70 hover:opacity-100",
  EMPTY:
    "flex min-h-40 flex-1 flex-col items-center justify-center gap-3 rounded-tile bg-surface-container px-6 py-10 text-center",
  EMPTY_GLYPH: "text-on-surface-variant size-7",
  EMPTY_TEXT: "text-on-surface-variant text-sm",
} as const;

// -----------------------------------------------------------------------------
// Skeletons
// -----------------------------------------------------------------------------

/** Every placeholder reads its geometry from the loaded view's own constant. */
export const SKELETON = {
  TITLE: "h-7 w-40 rounded-inline",
  DESC: "h-5 w-64 max-w-full rounded-inline",
  BADGE: "h-6 w-24 rounded-pill",
  EYEBROW: "h-3.5 w-16 rounded-inline",
  STAT: STAT.PLACEHOLDER,
  TABS: "h-9 w-full rounded-pill",
  SETTING: `${SETTING_MIN_HEIGHT} w-full rounded-tile`,
  FIELD: "h-9 w-24 rounded-field",
  ACTION: `${ACTION_HEIGHT} w-40 rounded-pill`,
  INPUT: "h-9 w-full rounded-field",
  HOSTLIST: "min-h-40 w-full flex-1 rounded-tile",
} as const;

export const ACTION_PILL = ACTION_HEIGHT;
