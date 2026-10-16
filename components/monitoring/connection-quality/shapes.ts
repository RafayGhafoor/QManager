import type { BadgeVariant } from "@/components/ui/badge";
import type { QualityNamedPreset } from "@/types/modem-status";

// Connection Quality: this family's geometry, imported by the loaded views AND
// their skeletons. Restated here, never imported across families.

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route wrapper, as on the other Monitoring pages. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

/** Probe Targets beside Quality Thresholds, one height, stacked below 58rem. */
export const PAIR =
  "grid grid-cols-1 items-stretch gap-5 @[58rem]/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]";

/** A pair cell hands its full height to the card inside it. */
export const CARD_CELL = "flex min-w-0 flex-col";

// -----------------------------------------------------------------------------
// Card shells
// -----------------------------------------------------------------------------

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card flex-1 gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";

export const CARD_PAD = "px-6";

/** The body column. `flex-1` lets a pair card hand its slack to one region. */
export const CARD_BODY = "flex flex-1 flex-col gap-4";

export const CARD_TITLE = "col-start-1 min-w-0 text-lg leading-tight";

/** `CardDescription` hardcodes a retired ink token, so every call site re-inks it. */
export const CARD_DESC = "text-on-surface-variant col-start-1 text-sm";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const PILL_GLYPH = "size-4";

/** The 42px action height every pill button and field shares here. */
const CONTROL_H = "h-[2.625rem]";

// -----------------------------------------------------------------------------
// Groups and eyebrows
// -----------------------------------------------------------------------------

export const EYEBROW =
  "text-on-surface-variant min-w-0 truncate text-[0.6875rem] leading-[1.125rem] font-semibold tracking-[0.02em] uppercase";

/** An eyebrow over its rows: 9px between them, 5px between rows. */
export const GROUP = "flex flex-col gap-[0.5625rem]";
/** min-h-5 is the HintIcon trigger, so a head with or without one keeps one height. */
export const GROUP_HEAD = "flex min-h-5 flex-wrap items-center gap-x-2 gap-y-2 px-1";
export const ROW_STACK = "flex flex-col gap-[0.3125rem]";

/** Eyebrow left, the segmented pill right; below the card breakpoint the Select wraps. */
export const METRIC_HEAD =
  "flex min-h-[2.625rem] flex-wrap items-center gap-x-3 gap-y-[0.5625rem] pl-1";

/** The pending-edit marker in the card foot. */
export const DELTA = "text-primary text-[0.6875rem] font-semibold tracking-[0.06em] uppercase";

/** A failed save, left in the foot until the next edit or save. */
export const FAILED = {
  ROOT: "text-destructive-on-surface inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold",
  GLYPH: "size-3.5 flex-none",
} as const;

// -----------------------------------------------------------------------------
// Probe Targets: the two-leg chain
// -----------------------------------------------------------------------------

/** The chain in PROBE ORDER: IPv6 is tried only when IPv4 did not answer. */
export const SLOT_ORDER = ["target_ipv4", "target_ipv6"] as const;
export type SlotKey = (typeof SLOT_ORDER)[number];

/** One leg: a 28px number disc beside its 42px field, the error under the field. */
export const LEG = {
  ROOT: "flex flex-col gap-1",
  ROW: "flex items-center gap-3",
  DISC: "grid size-7 flex-none place-items-center rounded-pill text-[0.8125rem] leading-none font-semibold tabular-nums transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]",
  DISC_REST: "bg-surface-container-high text-on-surface-variant",
  DISC_ANSWERED: "bg-primary text-primary-foreground",
} as const;

/** A probe target is an identifier the device echoes back verbatim, so mono. */
const FIELD_H = `${CONTROL_H} pointer-coarse:h-11`;
export const FIELD_MONO = `${FIELD_H} min-w-0 flex-1 font-mono text-[0.84375rem] font-medium`;

/** Indented past the disc and gap, so it starts at the field's edge. */
export const FIELD_ERROR = "text-destructive-on-surface pl-10 text-xs leading-relaxed";

// -----------------------------------------------------------------------------
// Pill rows
// -----------------------------------------------------------------------------

export const ROW = {
  ROOT: `flex ${CONTROL_H} min-w-0 items-center justify-between gap-4 rounded-pill bg-surface-container px-4 text-[0.8125rem] leading-5 font-semibold`,
  KEY: "text-on-surface-variant min-w-0 truncate",
  VALUE: "flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums",
  QUIET: "text-on-surface-variant font-medium",
  LINK: "text-primary-on-surface inline-flex items-center gap-1 rounded-inline font-semibold underline-offset-4 hover:underline",
  LINK_GLYPH: "size-3.5",
  /** The over-limit notch, centred on the 20px line box beside its figure. */
  ALERT: "size-3.5 flex-none",
} as const;

/** The custom limit field inside a pill row: a compact numeric input plus its unit. */
export const CUSTOM_FIELD = {
  WRAP: "flex items-center gap-1.5",
  INPUT: "h-8 w-24 rounded-pill bg-card px-3 text-right text-[0.8125rem] font-semibold tabular-nums",
  UNIT: "text-on-surface-variant font-medium",
} as const;

/** The over-limit glyph's ink. */
export const ALERT_INK = {
  warn: "text-warning-on-surface",
  bad: "text-destructive-on-surface",
} as const;

// -----------------------------------------------------------------------------
// Quality Thresholds
// -----------------------------------------------------------------------------

/**
 * The preset table from `resolve_quality_thresholds` in `qmanager_poller`:
 * latency flags above the cut, loss AT it. `custom` takes the user's number
 * with tolerant's debounce.
 */
export const PRESET_LIMIT = {
  latency: {
    standard: { limit: 150, debounce: 3 },
    tolerant: { limit: 250, debounce: 3 },
    "very-tolerant": { limit: 500, debounce: 2 },
  },
  loss: {
    standard: { limit: 15, debounce: 3 },
    tolerant: { limit: 30, debounce: 3 },
    "very-tolerant": { limit: 50, debounce: 2 },
  },
} satisfies Record<
  "latency" | "loss",
  Record<QualityNamedPreset, { limit: number; debounce: number }>
>;

export const CUSTOM_DEBOUNCE = 3;

/** The CGI's accepted custom ranges. */
export const CUSTOM_RANGE = {
  latency: { min: 1, max: 10000 },
  loss: { min: 0, max: 100 },
} as const;

// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

export type ConditionTone = Extract<BadgeVariant, "warning" | "destructive">;

export const CONDITION = {
  ROOT: "flex flex-col items-center gap-3 rounded-hero px-6 py-10 text-center",
  DISC: "grid size-14 place-items-center rounded-pill",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION: "mt-1 px-4",
  /** A state block fills the card body instead of a form. */
  SCREEN: "min-h-0 flex-1 justify-center",
} as const;

/** A condition block IS the state; the action pill is drawn from its own ink. */
export const CONDITION_TONE = {
  warning: {
    ROOT: "bg-warning-container text-on-warning-container",
    DISC: "bg-warning text-warning-foreground",
    ACTION:
      "bg-on-warning-container/10 text-on-warning-container hover:bg-on-warning-container/15",
  },
  destructive: {
    ROOT: "bg-destructive-container text-on-destructive-container",
    DISC: "bg-destructive text-destructive-foreground",
    ACTION:
      "bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
  },
} satisfies Record<ConditionTone, { ROOT: string; DISC: string; ACTION: string }>;

// -----------------------------------------------------------------------------
// Skeletons: placeholder boxes from the loaded constants
// -----------------------------------------------------------------------------

export const SKELETON_LOCAL = {
  /** The verdict Badge's 22px box, inline so it sits in the same line box. */
  VERDICT: "inline-block h-[1.375rem] w-28 rounded-pill align-middle",
  EYEBROW: "h-3 w-24 rounded-inline",
  DISC: "size-7 flex-none rounded-pill",
  FIELD: `${FIELD_H} min-w-0 flex-1 rounded-field`,
  ROW_TEXT: "h-3 rounded-inline",
  /** SegmentedField's 42px track; full width where the Select stands in for it. */
  SEGMENT: `${CONTROL_H} w-full rounded-pill @lg/card:w-80`,
  ACTION: `${CONTROL_H} w-36 rounded-pill`,
} as const;
