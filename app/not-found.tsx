"use client";

// =============================================================================
// 404 — a night camp for the lost adventurer
// -----------------------------------------------------------------------------
// A friendly dead end: one card that is a pixel-art campfire under a starry
// sky, a single line of copy, and one way home. The card is always night in
// both themes (it is an illustration, not chrome), so its ink and the amber
// "Back to Dashboard" button read from CAMPFIRE_PALETTE via CSS variables.
//
// The fire is the page's one ambient loop, a sanctioned exception to the
// One-Loop Rule (DESIGN.md > Motion) requested for this page. It is stepped
// sprite animation in globals.css (`campfire-*`) and stops under Reduced
// motion on a complete still frame. Entrance on `transitionStandard`.
//
// Serving: the static export emits this as `404.html`. Next renders it for a
// client-side miss; uhttpd shows it for a hard miss only when its
// `error_page` points at it (not set by the installer today).
// =============================================================================

import { motion } from "motion/react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { TentIcon } from "lucide-react";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BODY, CARD_TITLE } from "@/components/pre-auth-type";
import { CAMPFIRE_PALETTE as P, CampfireScene } from "@/components/not-found/campfire-scene";

const CAMPFIRE_VARS = {
  "--campfire-ground": P.ground,
  "--campfire-text": P.text,
  "--campfire-text-muted": P.textMuted,
  "--campfire-amber": P.amber,
  "--campfire-amber-hover": P.amberHover,
  "--campfire-amber-light": P.amberLight,
  "--campfire-amber-edge": P.amberEdge,
  "--campfire-amber-ink": P.amberInk,
} as React.CSSProperties;

export default function NotFound() {
  const { t } = useTranslation("common");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 md:p-10">
      <motion.main
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitionStandard}
      >
        <div
          style={CAMPFIRE_VARS}
          className="overflow-hidden rounded-hero bg-(--campfire-ground) text-center shadow-[var(--shadow-whisper)] ring-1 ring-white/6"
        >
          <CampfireScene label={t("not_found.scene_label")} className="block h-auto w-full" />

          <div className="flex flex-col items-center gap-6 px-6 pt-1 pb-8 sm:px-8">
            <div className="flex flex-col gap-2">
              <h1 className={cn(CARD_TITLE, "text-balance text-(--campfire-text)")}>
                {t("not_found.title")}
              </h1>
              <p className={cn(BODY, "leading-relaxed text-balance text-(--campfire-text-muted)")}>
                {t("not_found.description")}
              </p>
            </div>

            <span className="campfire-button-frame">
              <Link href="/dashboard/" className="campfire-button">
                <TentIcon className="size-4" aria-hidden />
                {t("not_found.home")}
              </Link>
            </span>
          </div>
        </div>
      </motion.main>

      <div className="flex items-center gap-2">
        <img
          src="/qmanager-mark.svg"
          alt=""
          aria-hidden
          className="size-4 opacity-70"
        />
        <p className="text-xs text-muted-foreground">{t("not_found.footer")}</p>
      </div>
    </div>
  );
}
