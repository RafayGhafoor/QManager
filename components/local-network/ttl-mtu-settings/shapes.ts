// =============================================================================
// TTL & MTU — the family's geometry and tone contract
// =============================================================================
// Ported from the RM520N fork (ledger U4.20). Every geometry string, tone,
// control height and skeleton box on `/local-network/ttl-settings` comes from
// here, so a skeleton mirrors the loaded shape by reference instead of by a
// restated number.
//
// Restated, never imported: `/local-network/` must not reach into
// `components/cellular/`, and sibling families (ethernet, traffic-engine) keep
// their own modules, so one family's next correction never silently becomes
// everybody's. The numbers are the system's: 104px pinned tile, 12px tile
// radius, 52px disc, 42px control, 16px card.
//
// Colour lives on the disc only. Tile bodies are neutral with no tone prop,
// because a TTL the modem is not rewriting is the carrier's own value, the
// normal resting state, not a fault.
// =============================================================================

import type { BadgeVariant } from "@/components/ui/badge";

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------

/** The route root. Every `@…/main:` variant below resolves against it. */
export const PAGE_ROOT = "@container/main flex flex-col gap-5 p-2";

/** The page header: titles left, Refresh pushed right once there is room. */
export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
  ACTIONS: "flex flex-wrap items-center gap-2.5 @3xl/main:ml-auto",
} as const;

// -----------------------------------------------------------------------------
// Band A — the live strip
// -----------------------------------------------------------------------------

/**
 * The band header: label left, one status chip right. `min-h` matches the
 * chip's own 22px box so the band does not breathe when the chip appears.
 */
export const BAND = {
  HEAD: "flex min-h-[1.375rem] items-center gap-3 px-1 pb-0.5",
  LABEL: "text-on-surface-variant mr-auto text-xs font-semibold",
  GLYPH: "size-3",
} as const;

/**
 * The tile box. `ROOT` is pinned at 104px (eyebrow, value and caption all
 * truncate), and `HEIGHT` is what the skeleton imports to mirror the pin.
 *
 * Three columns, not four: the fork's comp had an "On reboot" tile reading
 * `autostart`, which the installer makes `true` on every device, so it would
 * render a constant as if it were a reading. The field is not read here.
 */
export const TILE = {
  GRID: "grid grid-cols-1 gap-3.5 @xl/main:grid-cols-3",
  ROOT: "flex h-[6.5rem] items-center gap-3.5 rounded-tile px-5 py-4",
  HEIGHT: "h-[6.5rem]",
  BODY: "bg-surface-container text-on-surface",
  DISC: "grid size-[3.25rem] flex-none place-items-center rounded-pill",
  /** The lucide glyph inside DISC: 26px, half the disc. */
  GLYPH: "size-[1.625rem]",
  TEXT: "flex min-w-0 flex-1 flex-col gap-[3px]",
  EYEBROW:
    "text-on-surface-variant truncate text-[0.6875rem] font-semibold tracking-[0.02em]",
  /** A TTL, a hop limit and an MTU are quantities: UI face, `tabular-nums`, never mono. */
  VALUE:
    "flex min-w-0 items-center gap-2 text-[1.375rem] font-bold leading-[1.1] tracking-[-0.015em] tabular-nums",
  VALUE_TEXT: "truncate",
  CAPTION: "text-on-surface-variant truncate text-xs",
} as const;

/**
 * The placeholder for a figure with no reading. An em dash reads as an absence
 * in every locale and needs no translation key.
 */
export const VALUE_NONE = "—";

/** Disc fills, the only colour on the band. Fill pairs, never container pairs. */
export const DISC_TONE = {
  success: "bg-success text-success-foreground",
  neutral: "bg-surface-container-high text-on-surface-variant",
} as const;

export type DiscTone = keyof typeof DISC_TONE;

/**
 * The disc's tone transition, scoped to two properties (never `transition-all`)
 * and on the motion scale. Custom properties take `var()`: Tailwind v4 drops the
 * bare-var bracket shorthand and would emit the property name as the value.
 */
export const DISC_TRANSITION =
  "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)]";

/**
 * The band's non-tile states: one tile spanning the grid, in the family box, so
 * "nothing answered" is one sentence rather than three identical tiles.
 */
export const NOTICE_SPAN = "@xl/main:col-span-3";
export const NOTICE_TITLE = "truncate text-lg font-semibold";
/** The Retry pill inside a notice tile: 36px, one step under `size="action"`. */
export const NOTICE_ACTION =
  "h-9 flex-none gap-2 px-4 text-[0.8125rem] font-semibold";

/**
 * Whether anything overrides the carrier, keyed onto `BadgeVariant` so a new
 * state without a chip role fails the build. Carrier defaults are the shipping
 * state, so `muted`, not `destructive`.
 */
export type TtlMtuState = "custom" | "default";

export const STATE_BADGE: Record<TtlMtuState, BadgeVariant> = {
  custom: "success",
  default: "muted",
};

/** The glyph inside a status chip; the two states never share one. */
export const CHIP_GLYPH = "size-3";

// -----------------------------------------------------------------------------
// Band B — the two write cards
// -----------------------------------------------------------------------------

/**
 * The card shell: a peer (`rounded-card`, not `rounded-hero`), borderless, with
 * the whisper lift. The `!` is load-bearing: `tailwind-merge` cannot tell an
 * arbitrary `shadow-[var()]` from a shadow colour, so `Card`'s own `shadow-sm`
 * survives the merge and wins on emission order without it.
 */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-surface py-6 shadow-[var(--shadow-whisper)]!";

/** Card padding: 28px, matching the sibling surfaces. */
export const CARD_PAD = "px-7";

/** `CardTitle` is unsized by default; this sizes it and lets it wrap. */
export const CARD_TITLE = "min-w-0 text-lg leading-tight font-semibold";

export const CARD_BODY = "flex flex-col gap-3";

/**
 * One tonal group holding a card's rows: one step above the card, and the field
 * inside a row is one step above the group again (`host="container"`).
 */
export const ROW_GROUP =
  "flex flex-col gap-0.5 rounded-tile bg-surface-container p-1.5";

/**
 * One setting row. `ROOT` is a floor, not a pin: the consequence sentence wraps
 * to two lines on a narrow card.
 */
export const ROW = {
  ROOT: "flex min-h-[5rem] flex-col gap-3 rounded-field px-4 py-4 @2xl/card:flex-row @2xl/card:items-center @2xl/card:gap-4 @2xl/card:pl-[1.125rem]",
  /** `flex-1` keeps the column from collapsing against a `flex-none` control. */
  TEXT: "flex min-w-0 flex-1 flex-col gap-1",
  LABEL_LINE: "flex min-w-0 flex-wrap items-center gap-2",
  LABEL: "text-[0.9375rem] font-semibold",
  /** Required on every row: what the setting does, or why it cannot act now. */
  CONSEQUENCE:
    "text-on-surface-variant text-[0.78125rem] leading-relaxed text-pretty",
  CONTROL: "flex flex-none items-center @2xl/card:ml-auto",
  /** What a row skeleton stands in for (mirrors the floor). */
  HEIGHT: "h-[5rem]",
  /**
   * The dim for a held row. It goes on `TEXT`, not `ROOT`: opacity compounds,
   * and a 0.6 row around a `disabled:opacity-50` control would read at 0.30.
   */
  HELD: "opacity-60",
} as const;

/** The number fields. Each call site passes `host="container"`. */
export const FIELD =
  "font-medium text-[0.875rem] tabular-nums @2xl/card:w-[9.5rem]";

/**
 * The invalid state as an inset ring, so the field's box does not change (and
 * nothing beside it moves) the moment a digit goes out of range.
 */
export const FIELD_INVALID =
  "shadow-[inset_0_0_0_2px_var(--destructive)] focus-visible:ring-destructive/30";

/**
 * The pending-change chip in a row's label, e.g. `64 → 65`. Rendered
 * `invisible` when clean, so promoting a row to dirty moves nothing.
 */
export const DELTA = {
  ROOT: "text-on-surface-variant inline-flex items-center gap-1 rounded-pill bg-surface-container-high px-2 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
  CLEAN: "invisible",
  ARROW: "opacity-70",
} as const;

/** The foot status: unsaved state in neutral ink, a block reason in destructive ink. */
export const FOOT_STATUS = "text-on-surface-variant text-xs font-medium";
export const FOOT_BLOCKED = "text-destructive-on-surface text-xs";

/** The foot action height, so the foot skeleton mirrors it by reference. */
export const ACTION_HEIGHT = "h-[2.625rem]";
