"use client";

import { BrandMark } from "@/components/ui/brand-mark";

import { DIALOG, SITES } from "./shapes";

// The domain -> glyph map and the favicon fallback live in `components/ui/brand-mark.tsx`
// (shared with the SMS sender discs); this file only fixes the Sites plate sizes.

export interface SiteMarkProps {
  host: string;
  label: string;
  /** `cell`: the 56px grid tile. `row`: the 32px dialog list plate. */
  size: "cell" | "row";
}

export function SiteMark({ host, label, size }: SiteMarkProps) {
  const cell = size === "cell";
  return (
    <BrandMark
      domain={host}
      label={label}
      className={cell ? SITES.TILE : DIALOG.LOGO}
      glyphClassName={cell ? SITES.MARK : DIALOG.LOGO_MARK}
      faviconClassName={cell ? SITES.FAVICON : DIALOG.LOGO_FAVICON}
      monogramClassName={cell ? SITES.MONOGRAM : DIALOG.LOGO_MONOGRAM}
    />
  );
}
