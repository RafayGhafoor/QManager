"use client";

// =============================================================================
// 404 — ported from the fork (a05c4e92 app/not-found.tsx), in the canon
// -----------------------------------------------------------------------------
// A page-not-found reported in QManager's own operator language: the console
// couldn't acquire a route, the same way it reports it can't acquire a cell.
// One self-contained card on the calm canvas, like the pre-auth cards (outside
// the sidebar grid, lucide glyphs). The condition is a filled destructive
// chip, the failed route is a machine-voice readout, and the only filled
// action is Return to Dashboard.
//
// The signal bars are static: a state motif, not a loop (DESIGN.md > The
// One-Loop Rule). Entrance on `transitionStandard`; nothing exits.
//
// Serving: the static export emits this as `404.html`. Next renders it for a
// client-side miss; uhttpd shows it for a hard miss only when its
// `error_page` points at it (not set by the installer today).
// =============================================================================

import { useSyncExternalStore } from "react";
import { motion } from "motion/react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowLeftIcon, LayoutDashboardIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { transitionStandard } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BODY, CARD_TITLE, EYEBROW } from "@/components/pre-auth-type";

// Static rising signal bars: a state motif, not a progress claim.
const SCAN_BARS = ["h-2.5", "h-4", "h-5", "h-7"] as const;

// The requested path is real machine data, but only known client-side (a
// static export can't prerender it). The server snapshot is empty, so
// hydration matches, and the row is present either way so nothing reflows.
const noopSubscribe = () => () => {};
const readPath = () => window.location.pathname + window.location.search;
const readServerPath = () => "";

function SignalScan({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex size-16 items-end justify-center gap-1 rounded-tile bg-surface-container-high p-3"
    >
      {SCAN_BARS.map((height) => (
        <span
          key={height}
          aria-hidden
          className={cn("w-1.5 rounded-pill bg-on-surface-variant opacity-60", height)}
        />
      ))}
    </div>
  );
}

export default function NotFound() {
  const { t } = useTranslation("common");
  const requestedPath = useSyncExternalStore(noopSubscribe, readPath, readServerPath);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <motion.main
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitionStandard}
      >
        <div className="card-sheen flex flex-col items-center gap-6 rounded-hero bg-card p-8 text-center text-card-foreground shadow-[var(--shadow-whisper)] dark:shadow-none">
          <SignalScan label={t("not_found.scan_label")} />

          {/* Status code as an honest readout, not a marketing hero: solid,
              tabular, paired with the condition chip. */}
          <div className="flex flex-col items-center gap-3">
            <p
              className="text-6xl font-bold tracking-tight text-foreground tabular-nums"
              aria-label={t("not_found.code_label")}
            >
              404
            </p>
            <Badge variant="destructive">
              <XCircleIcon className="size-3" />
              {t("not_found.badge")}
            </Badge>
          </div>

          <div className="flex flex-col gap-2">
            <h1 className={CARD_TITLE}>{t("not_found.title")}</h1>
            <p className={cn(BODY, "leading-relaxed text-balance text-muted-foreground")}>
              {t("not_found.description")}
            </p>
          </div>

          {/* The exact route that failed: an opaque string you compare, so it
              is mono (DESIGN.md > The Machine-Voice Rule). */}
          <div className="flex w-full flex-col gap-1.5 rounded-field bg-surface-container p-3 text-left">
            <span className={cn(EYEBROW, "text-on-surface-variant")}>
              {t("not_found.requested_route")}
            </span>
            <code className="font-mono text-xs break-all text-on-surface">
              {requestedPath || "—"}
            </code>
          </div>

          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="tonal-neutral"
              className="sm:w-auto"
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon className="size-4" />
              {t("not_found.back")}
            </Button>
            <Button asChild className="sm:w-auto">
              <Link href="/dashboard/">
                <LayoutDashboardIcon className="size-4" />
                {t("not_found.home")}
              </Link>
            </Button>
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
