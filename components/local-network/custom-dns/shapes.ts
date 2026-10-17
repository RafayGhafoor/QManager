// Custom DNS: this family's geometry, imported by the loaded card and its skeleton.
// Restated from the IP Passthrough and Traffic Engine families, never imported across families.

export const PAGE_ROOT = "@container/main flex flex-col gap-5 px-4 pb-6 lg:px-6";

export const PAGE_HEAD = {
  ROOT: "flex flex-col gap-5 @3xl/main:flex-row @3xl/main:items-end",
  TITLES: "flex max-w-[41rem] min-w-0 flex-col gap-1.5",
  TITLE: "text-3xl font-bold tracking-[-0.02em]",
  DESC: "text-on-surface-variant text-sm leading-relaxed text-pretty",
} as const;

/** The important marker is required: twMerge reads an arbitrary shadow as a colour. */
export const CARD_SHELL =
  "@container/card gap-5 rounded-card border-0 bg-card py-6 shadow-[var(--shadow-whisper)]!";
export const CARD_PAD = "px-6";
export const CARD_TITLE = "min-w-0 text-lg leading-tight";
export const CARD_DESC = "text-on-surface-variant text-sm";
export const CARD_BODY = "flex flex-col gap-5";

/** 66px resting height, a FLOOR so a longer translated description can wrap. */
const SETTING_MIN_HEIGHT = "min-h-[4.125rem]";

export const SETTING_ROW = {
  ROOT: `flex ${SETTING_MIN_HEIGHT} flex-col items-stretch gap-3 rounded-tile px-[1.125rem] py-3.5 @md/card:flex-row @md/card:items-center @md/card:gap-3.5`,
  REST: "bg-surface-container text-on-surface",
  ON: "bg-primary-container text-on-primary-container",
  TRANSITION:
    "transition-[background-color,color] duration-[var(--duration-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none",
  TEXT: "min-w-0 flex-1",
  TITLE: "text-sm font-semibold",
  DESC: "mt-0.5 text-xs opacity-85",
} as const;

/** The provider picker keeps a readable width on a wide card. */
export const PROVIDER_TRIGGER = "w-full @md/card:w-72";

/** IPv4 and IPv6 stack on a phone-width card, then sit side by side. */
export const FAMILIES = "grid grid-cols-1 gap-5 @3xl/card:grid-cols-2";
export const FAMILY = "flex min-w-0 flex-col gap-3";
export const FAMILY_TITLE = "text-on-surface-variant text-xs font-semibold";
export const INPUTS = "grid grid-cols-1 gap-4 @md/card:grid-cols-2 @3xl/card:grid-cols-1 @5xl/card:grid-cols-2";

/** Addresses are opaque strings you compare: mono, never the UI face. */
export const ADDRESS_INPUT = "font-mono text-[0.8125rem]";

/** A preset's resolved addresses: the card's one inner container, receipt rows. */
export const RECEIPT = {
  ROOT: "grid grid-cols-1 gap-x-8 gap-y-4 rounded-tile bg-surface-container px-[1.125rem] py-3.5 @3xl/card:grid-cols-2",
  GROUP: "flex min-w-0 flex-col gap-1",
  /** One line box, shared with the skeleton bar. */
  GROUP_TITLE: "text-on-surface-variant flex h-4 items-center text-xs font-semibold",
  ROW: "flex min-h-7 items-center justify-between gap-4",
  KEY: "text-on-surface-variant text-sm",
  VALUE: "min-w-0 truncate text-right font-mono text-[0.8125rem] text-on-surface",
} as const;

/** A failed read with nothing in hand: the block IS the state. */
export const CONDITION = {
  ROOT: "flex flex-col items-center justify-center gap-3 rounded-hero bg-destructive-container px-6 py-10 text-center text-on-destructive-container",
  DISC: "grid size-14 place-items-center rounded-pill bg-destructive text-destructive-foreground",
  GLYPH: "size-7",
  TITLE: "text-base font-semibold",
  DESC: "max-w-sm text-sm leading-relaxed text-pretty opacity-90",
  ACTION:
    "mt-1 bg-on-destructive-container/10 text-on-destructive-container hover:bg-on-destructive-container/15",
} as const;

export const SKELETON = {
  SETTING: `${SETTING_MIN_HEIGHT} w-full rounded-tile`,
  LABEL: "h-5 w-28 rounded-inline",
  TRIGGER: `h-9 ${PROVIDER_TRIGGER} rounded-field`,
  /** Bars inside the receipt's own rows, so the block measures the same. */
  RECEIPT_TITLE: "h-4 w-24 rounded-inline",
  RECEIPT_VALUE: "h-4 w-36 rounded-inline",
  ACTION: "h-[2.625rem] w-40 rounded-pill",
} as const;
