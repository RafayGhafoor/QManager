"use client";

import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HintIcon } from "@/components/ui/hint-icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { MetricBar } from "@/components/ui/metric-bar";
import { TickingValue } from "@/components/ui/ticking-value";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useLatencyHistory } from "@/hooks/use-latency-history";
import {
  type ConnectivityStatus,
  type PingHistoryEntry,
} from "@/types/modem-status";
import { formatClock } from "@/lib/chart-time";
import { staggerRowItem, staggerRows } from "@/lib/motion";
import { cn } from "@/lib/utils";

import {
  ABSENT,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  FIGURE,
  QUALITY,
  QUALITY_FALLBACK_CUTS,
} from "./shapes";

// The full view carries the chart stack, so it is not part of the dashboard's
// first paint: the card renders from the status poll alone and recharts arrives
// the first time someone opens the dialog.
const ConnectionQualityDialog = dynamic(
  () => import("./connection-quality-dialog"),
  { ssr: false },
);

// =============================================================================
// Connection Quality — replaces Live Latency on the dashboard (ledger U4.7)
// =============================================================================
// Internet / DNS lookup / Probing rows, a 30-minute reachability strip and a
// jitter strip from fetch_ping_history.sh, Typical / Worst / Loss from the
// status poll. The speed test used to close this card; it now lives on Device
// & Speed (device-metrics.tsx) beside the modem's own readings.
//
// HOVER. Every cell of both strips explains itself: the span it covers in local
// time, the average latency, the jitter the bar shows and the loss. The cells
// are one roving tab stop per strip (arrow keys move, Home/End jump) because 56
// tab stops would bury the rest of the page; focus opens the same tip hover
// does. A tooltip does not open on tap, so the full view (top-right expand
// control) carries the same readings for touch.
//
// The verdict is the ICMP probe's alone (`connectivity.status`, graded on
// `connectivity.thresholds`). The DNS lookup time is its own reading: the
// carrier resolver can answer while ICMP is unreachable, so it never softens
// or stands in for "Unreachable".
// =============================================================================

// The strip grades with the poller's own cuts (connectivity.thresholds); the
// backend's `tolerant` defaults (QUALITY_FALLBACK_CUTS) stand in when an older
// poller omits them.
const FALLBACK_DEGRADED_MS = QUALITY_FALLBACK_CUTS.LATENCY_MS;
const FALLBACK_DEGRADED_LOSS_PCT = QUALITY_FALLBACK_CUTS.LOSS_PCT;

/** Jitter grading in ms, tuned for cellular scheduling variance. */
const JITTER_STEADY_MS = 15;
const JITTER_ROUGH_MS = 40;

/** Fixed jitter full-scale, so bar height means the same thing every poll. */
const JITTER_TRACK_MAX_MS = 80;

/** Latency bar full-scale as a multiple of the profile's cut (cut lands at 80%). */
const LATENCY_BAR_SCALE = 1.25;

// --- Bucketing ---------------------------------------------------------------

type BucketTone = "none" | "success" | "warning" | "destructive";

interface Bucket {
  measured: boolean;
  tone: BucketTone;
  /** Worst jitter from ANSWERED probes only; null when none answered. */
  jitter: number | null;
  /** The span this cell covers, epoch seconds on the modem clock; null before any history. */
  from: number | null;
  to: number | null;
  /** Mean RTT of the ANSWERED probes in the cell; null when none answered. */
  avgLatency: number | null;
  /** Share of the cell's own probes that went unanswered, 0-100. */
  lossPct: number;
}

interface StripThresholds {
  latencyMs: number;
  lossPct: number;
}

/**
 * Folds the archive into QUALITY.BUCKETS spans anchored on the NEWEST entry's
 * modem-clock `ts` (never Date.now()); an empty span stays unmeasured.
 */
function bucketHistory(
  entries: PingHistoryEntry[],
  limits: StripThresholds,
): { buckets: Bucket[]; spanSec: number | null } {
  const empty: Bucket[] = Array.from({ length: QUALITY.BUCKETS }, () => ({
    measured: false,
    tone: "none" as BucketTone,
    jitter: null,
    from: null,
    to: null,
    avgLatency: null,
    lossPct: 0,
  }));

  if (!Array.isArray(entries) || entries.length === 0) {
    return { buckets: empty, spanSec: null };
  }

  let anchorTs = -Infinity;
  for (const e of entries) {
    if (typeof e?.ts === "number" && e.ts > anchorTs) anchorTs = e.ts;
  }
  if (!Number.isFinite(anchorTs)) return { buckets: empty, spanSec: null };

  const startTs = anchorTs - QUALITY.WINDOW_S;
  const step = QUALITY.WINDOW_S / QUALITY.BUCKETS;

  const rows = Array<number>(QUALITY.BUCKETS).fill(0);
  const failed = Array<number>(QUALITY.BUCKETS).fill(0);
  const touched = Array.from({ length: QUALITY.BUCKETS }, () => false);
  const worstLat: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);
  const worstJit: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);
  const worstLoss: (number | null)[] = Array(QUALITY.BUCKETS).fill(null);
  const sumLat = Array<number>(QUALITY.BUCKETS).fill(0);
  const nLat = Array<number>(QUALITY.BUCKETS).fill(0);

  let oldestVisibleTs: number | null = null;

  for (const e of entries) {
    if (typeof e?.ts !== "number" || !Number.isFinite(e.ts)) continue;
    if (e.ts <= startTs) continue;
    // The anchor sits on the closing edge; clamp it into the newest cell.
    const idx = Math.min(
      QUALITY.BUCKETS - 1,
      Math.max(0, Math.floor((e.ts - startTs) / step)),
    );

    touched[idx] = true;
    rows[idx] += 1;
    if (oldestVisibleTs === null || e.ts < oldestVisibleTs) oldestVisibleTs = e.ts;

    const answered = typeof e.lat === "number" && Number.isFinite(e.lat);
    if (e.lat === null || e.lat === undefined) {
      failed[idx] += 1;
    } else if (answered) {
      const cur = worstLat[idx];
      if (cur === null || e.lat > cur) worstLat[idx] = e.lat;
      sumLat[idx] += e.lat;
      nLat[idx] += 1;
    }

    // A failed row's `jit` is the window statistic (often a literal 0), not a reading.
    if (answered && typeof e.jit === "number" && Number.isFinite(e.jit)) {
      const cur = worstJit[idx];
      if (cur === null || e.jit > cur) worstJit[idx] = e.jit;
    }

    if (typeof e.loss === "number" && Number.isFinite(e.loss)) {
      const cur = worstLoss[idx];
      if (cur === null || e.loss > cur) worstLoss[idx] = e.loss;
    }
  }

  const buckets: Bucket[] = empty.map((_, i) => {
    const from = startTs + i * step;
    const span = { from, to: from + step };
    if (!touched[i]) {
      return { measured: false, tone: "none", jitter: null, ...span, avgLatency: null, lossPct: 0 };
    }
    const lat = worstLat[i];
    const loss = worstLoss[i];
    // A cell holds only 3-5 rows, so one drop is already 20-33 %: it takes two failed
    // rows at the loss cut (or the poller's rolling loss at it) to go red. The rolling
    // loss spans ~10 min, so it only counts in a cell that dropped a probe itself;
    // otherwise an old drop paints every answered cell after it red.
    const failedPct = (failed[i] / rows[i]) * 100;
    const tone: BucketTone =
      (failed[i] >= 2 && failedPct >= limits.lossPct) ||
      (failed[i] > 0 && loss !== null && loss >= limits.lossPct)
        ? "destructive"
        : failed[i] > 0 || (lat !== null && lat > limits.latencyMs)
          ? "warning"
          : "success";
    return {
      measured: true,
      tone,
      jitter: worstJit[i],
      ...span,
      avgLatency: nLat[i] > 0 ? sumLat[i] / nLat[i] : null,
      lossPct: failedPct,
    };
  });

  return {
    buckets,
    spanSec: oldestVisibleTs === null ? null : anchorTs - oldestVisibleTs,
  };
}

// --- Presentation ------------------------------------------------------------

const CELL_TONE: Record<BucketTone, string> = {
  none: "bg-surface-container-high",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/** Tone grades the jitter value; bar height encodes it, so colour is never alone. */
function jitterTone(ms: number): string {
  if (ms >= JITTER_ROUGH_MS) return "bg-destructive";
  if (ms >= JITTER_STEADY_MS) return "bg-warning";
  return "bg-success";
}

/** The ICMP verdict only. A DNS answer never turns "Unreachable" into anything softer. */
function reachState(connectivity: ConnectivityStatus | null): {
  key: string;
  className: string;
} {
  switch (connectivity?.status) {
    case "connected":
      return { key: "reach_responsive", className: "text-success-on-surface" };
    case "degraded":
    case "recovery":
      return { key: "reach_degraded", className: "text-warning-on-surface" };
    case "disconnected":
      return { key: "reach_unreachable", className: "text-destructive-on-surface" };
    default:
      return { key: "reach_unknown", className: "text-on-surface-variant" };
  }
}

/** An outage length, coarsest two units: "45s", "1m 46s", "2h 5m", "3d 4h". */
function formatOutage(sec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return t("connection_quality.dur_dh", { d, h });
  if (h > 0) return t("connection_quality.dur_hm", { h, m });
  if (m > 0) return t("connection_quality.dur_ms", { m, s: s % 60 });
  return t("connection_quality.dur_s", { s });
}

/** How long ago, from a modem-side age in seconds (never the browser clock). */
function formatAgo(sec: number, t: TFunction): string {
  if (sec < 60) return t("activities.time.just_now");
  if (sec < 3600) return t("activities.time.minutes", { count: Math.floor(sec / 60) });
  if (sec < 86400) return t("activities.time.hours", { count: Math.floor(sec / 3600) });
  return t("activities.time.days", { count: Math.floor(sec / 86400) });
}

// --- Hover -------------------------------------------------------------------

const TONE_VERDICT_KEY: Record<BucketTone, string> = {
  none: "reach_unknown",
  success: "reach_responsive",
  warning: "reach_degraded",
  destructive: "reach_unreachable",
};

const TONE_VERDICT_INK: Record<BucketTone, string> = {
  none: "text-on-surface-variant",
  success: "text-success-on-surface",
  warning: "text-warning-on-surface",
  destructive: "text-destructive-on-surface",
};

/** The span a cell covers in the browser's local time: "14:02–14:03". */
function bucketRange(b: Bucket): string {
  return `${formatClock(b.from)}\u2013${formatClock(b.to)}`;
}

/** A reading with its unit, or the shared dash when the cell has none. */
function readout(value: number | null, unit: string): string {
  return value === null ? ABSENT : `${Math.round(value)} ${unit}`;
}

/** One cell's readings: the same rows on both strips, so either one answers. */
function BucketTip({ bucket, t }: { bucket: Bucket; t: TFunction }) {
  const ms = t("connection_quality.unit_ms");
  const pct = t("connection_quality.unit_pct");
  return (
    <div className="flex min-w-36 flex-col gap-1.5 tabular-nums">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold text-on-surface">{bucketRange(bucket)}</span>
        {bucket.measured ? (
          <span className={cn("text-xs font-semibold", TONE_VERDICT_INK[bucket.tone])}>
            {t(`connection_quality.${TONE_VERDICT_KEY[bucket.tone]}`)}
          </span>
        ) : null}
      </div>
      {bucket.measured ? (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
          <dt className="text-on-surface-variant">{t("connection_quality.tip_latency")}</dt>
          <dd className="text-right font-semibold text-on-surface">
            {readout(bucket.avgLatency, ms)}
          </dd>
          <dt className="text-on-surface-variant">{t("connection_quality.tip_jitter")}</dt>
          <dd className="text-right font-semibold text-on-surface">
            {readout(bucket.jitter, ms)}
          </dd>
          <dt className="text-on-surface-variant">{t("connection_quality.tip_loss")}</dt>
          <dd className="text-right font-semibold text-on-surface">
            {`${Math.round(bucket.lossPct)} ${pct}`}
          </dd>
        </dl>
      ) : (
        <span className="text-xs text-on-surface-variant">
          {t("connection_quality.tip_unmeasured")}
        </span>
      )}
    </div>
  );
}

/** The sentence a screen reader gets for a cell; the tip's rows, in order. */
function bucketAria(b: Bucket, t: TFunction): string {
  const range = bucketRange(b);
  if (!b.measured) return t("connection_quality.cell_aria_none", { range });
  return t("connection_quality.cell_aria", {
    range,
    status: t(`connection_quality.${TONE_VERDICT_KEY[b.tone]}`),
    latency: readout(b.avgLatency, t("connection_quality.unit_ms")),
    jitter: readout(b.jitter, t("connection_quality.unit_ms")),
    loss: `${Math.round(b.lossPct)} ${t("connection_quality.unit_pct")}`,
  });
}

/**
 * A strip whose cells each open a tip on hover OR focus. One roving tab stop
 * per strip: the focused cell is the only one in the tab order, arrows move,
 * Home/End jump. `height` is the track; each hit target spans it.
 */
function BucketStrip({
  buckets,
  ariaLabel,
  height,
  t,
  renderCell,
}: {
  buckets: Bucket[];
  ariaLabel: string;
  height: number;
  t: TFunction;
  renderCell: (bucket: Bucket) => React.ReactNode;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(buckets.length - 1);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const last = buckets.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(last, active + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    rowRef.current?.querySelectorAll<HTMLElement>("[data-cell]")[next]?.focus();
  };

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(QUALITY.ROW, QUALITY.ROW_BLEED)}
      style={{ height }}
    >
      {buckets.map((b, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <span
              data-cell=""
              role="img"
              tabIndex={i === active ? 0 : -1}
              aria-label={bucketAria(b, t)}
              onFocus={() => setActive(i)}
              className={QUALITY.HIT}
            >
              {renderCell(b)}
            </span>
          </TooltipTrigger>
          <TooltipContent variant="info" side="top">
            <BucketTip bucket={b} t={t} />
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// --- Latency row -------------------------------------------------------------

/** A null value reaches MetricBar untouched, so "no reading" is an empty track.
 *  Amber from the configured latency cut (as on the strip), red from twice it.
 *  Full scale is 1.25x the cut, so the cut sits at 80% and nearing it reads long;
 *  past full scale the bar stays full and colour carries amber → red. */
function LatencyRow({
  icon,
  label,
  value,
  unit,
  cutMs,
}: {
  icon: MaterialSymbolName;
  label: string;
  value: number | null;
  unit: string;
  cutMs: number;
}) {
  return (
    <div className="flex h-5 items-center gap-2">
      <MaterialSymbol name={icon} size={16} className="shrink-0 text-on-surface-variant" />
      <span className="min-w-0 grow truncate text-[13px] font-semibold text-on-surface-variant">
        {label}
      </span>
      <span className={QUALITY.LANE}>
        <MetricBar
          value={value}
          max={cutMs * LATENCY_BAR_SCALE}
          warnAt={cutMs}
          dangerAt={cutMs * 2}
          baseTone="success"
          track="surface-container-high"
        />
      </span>
      <span className={cn(QUALITY.VALUE_COL, "text-sm font-semibold tabular-nums text-on-surface")}>
        {value === null ? (
          ABSENT
        ) : (
          <>
            <TickingValue value={value}>{Math.round(value)}</TickingValue>
            <em className="font-semibold text-on-surface-variant not-italic">{` ${unit}`}</em>
          </>
        )}
      </span>
    </div>
  );
}

// --- Skeleton ----------------------------------------------------------------

function QualitySkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className={QUALITY.TILE}>
        {/* Internet, DNS, Probing and Last outage rows. */}
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-5 items-center gap-2">
            <Skeleton className="size-4 rounded-inline" />
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className={cn(QUALITY.LANE, "ml-auto h-2 rounded-pill")} />
            <Skeleton className={cn(QUALITY.VALUE_COL, "h-3.5")} />
          </div>
        ))}
      </div>

      {[0, 1].map((s) => (
        <div key={s} className="flex flex-col gap-1.5">
          <div className={QUALITY.LABEL_ROW}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="w-full rounded-[3px]" style={{ height: QUALITY.TRACK_H }} />
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-8" />
      </div>

      <div className="mt-auto grid grid-cols-3 gap-2 border-t border-surface-container-high pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-[22px] w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Card --------------------------------------------------------------------

interface ConnectionQualityProps {
  /** The poller's `connectivity` block. Null until the first poll lands. */
  connectivity: ConnectivityStatus | null;
  isLoading: boolean;
  modemReachable: boolean;
}

const ConnectionQualityComponent = ({
  connectivity,
  isLoading,
  modemReachable,
}: ConnectionQualityProps) => {
  const { t } = useTranslation("dashboard");
  const { data: history } = useLatencyHistory();
  const [fullViewOpen, setFullViewOpen] = React.useState(false);
  // The dialog mounts on first open and stays, so its range survives a close.
  const [fullViewMounted, setFullViewMounted] = React.useState(false);
  const openFullView = () => {
    setFullViewMounted(true);
    setFullViewOpen(true);
  };

  const latencyCut = connectivity?.thresholds?.latency_ms;
  const lossCut = connectivity?.thresholds?.loss_pct;
  const { buckets, spanSec } = React.useMemo(
    () =>
      bucketHistory(history, {
        latencyMs: latencyCut ?? FALLBACK_DEGRADED_MS,
        lossPct: lossCut ?? FALLBACK_DEGRADED_LOSS_PCT,
      }),
    [history, latencyCut, lossCut],
  );

  // The archive is persisted, so the full view is useful even while the status
  // poll cannot reach the modem; it is offered everywhere but the first load.
  const header = (
    <CardHeader className="px-0">
      <CardTitle className={CARD_TITLE}>{t("connection_quality.title")}</CardTitle>
      <CardDescription className={CARD_DESC}>
        {t("connection_quality.description")}
      </CardDescription>
      {isLoading ? null : (
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1.5 -mr-1.5 text-on-surface-variant"
                aria-label={t("connection_quality.expand_aria")}
                aria-haspopup="dialog"
                onClick={openFullView}
              >
                <MaterialSymbol name="open_in_full" size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t("connection_quality.expand_aria")}</TooltipContent>
          </Tooltip>
        </CardAction>
      )}
    </CardHeader>
  );

  const shell = (body: React.ReactNode) => (
    <Card className={CARD_SHELL}>
      {header}
      <CardContent className="flex flex-1 flex-col px-0">{body}</CardContent>
      {fullViewMounted ? (
        <ConnectionQualityDialog
          open={fullViewOpen}
          onOpenChange={setFullViewOpen}
          connectivity={connectivity}
        />
      ) : null}
    </Card>
  );

  if (isLoading) return shell(<QualitySkeleton />);

  // Only when no poll has ever landed; later failures keep the last reading.
  if (!modemReachable && !connectivity) {
    return shell(
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MaterialSymbol name="cloud_off" size={24} />
          </EmptyMedia>
          <EmptyTitle>{t("connection_quality.error_title")}</EmptyTitle>
          <EmptyDescription className="max-w-xs text-pretty">
            {t("connection_quality.error_description")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>,
    );
  }

  // `internet_available === null` means the ping daemon is not reporting — not an outage.
  if (connectivity && connectivity.internet_available === null) {
    return shell(
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MaterialSymbol name="radar" size={24} />
          </EmptyMedia>
          <EmptyTitle>{t("connection_quality.empty_title")}</EmptyTitle>
          <EmptyDescription className="max-w-xs text-pretty">
            {t("connection_quality.empty_description")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="secondary">
            <Link href="/monitoring/connection-quality/">
              {t("connection_quality.empty_action")}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>,
    );
  }

  const latencyMs = connectivity?.latency_ms ?? null;
  // Absent field = no DNS probe on this poller (omit the row); null = probed, no answer.
  const hasDnsField = connectivity !== null && connectivity.dns_lookup_ms !== undefined;
  const dnsMs = connectivity?.dns_lookup_ms ?? null;
  // While the current probe fails, `jitter_ms` is a stale window statistic.
  const jitterMs = latencyMs === null ? null : (connectivity?.jitter_ms ?? null);
  const reach = reachState(connectivity);
  const probeTarget = connectivity?.ping_target;
  // Absent field = older poller (omit the row); null = no outage has cleared this boot.
  const hasOutageField = connectivity !== null && connectivity.last_outage_s !== undefined;
  const outageS = connectivity?.last_outage_s ?? null;
  const outageAgoS = connectivity?.last_outage_ago_s ?? null;
  // Read from the routing table when the outage cleared; null when unknown.
  const outageWanIp = connectivity?.last_outage_wan_ip ?? null;
  const outageWanChanged = connectivity?.last_outage_wan_changed ?? null;
  const outageWanKey =
    outageWanChanged === true
      ? "last_outage_ip_new"
      : outageWanChanged === false
        ? "last_outage_ip_same"
        : "last_outage_ip_known";

  const spanMinutes = spanSec === null ? null : Math.floor(spanSec / 60);
  const axisReach =
    spanMinutes === null
      ? t("connection_quality.axis_reach_none")
      : spanMinutes < 1
        ? t("connection_quality.axis_reach_sub_minute")
        : t("connection_quality.axis_reach", { count: spanMinutes });
  const windowMinutes = Math.round(QUALITY.WINDOW_S / 60);

  const latencyTile = (
    <div className={QUALITY.TILE}>
      <LatencyRow
        icon="public"
        label={t("connection_quality.internet")}
        value={latencyMs}
        unit={t("connection_quality.unit_ms")}
        cutMs={latencyCut ?? FALLBACK_DEGRADED_MS}
      />
      {hasDnsField ? (
        <LatencyRow
          icon="dns"
          label={t("connection_quality.dns")}
          value={dnsMs}
          unit={t("connection_quality.unit_ms")}
          cutMs={latencyCut ?? FALLBACK_DEGRADED_MS}
        />
      ) : null}
      {probeTarget ? (
        <div className="flex h-5 items-center gap-2">
          <MaterialSymbol name="radar" size={16} className="shrink-0 text-on-surface-variant" />
          <span className="min-w-0 grow truncate text-[13px] font-semibold text-on-surface-variant">
            {t("connection_quality.probing")}
          </span>
          <span className="min-w-0 truncate font-mono text-sm font-semibold text-on-surface">
            {probeTarget}
          </span>
        </div>
      ) : null}
      {hasOutageField ? (
        <div className="flex h-5 items-center gap-2">
          <MaterialSymbol name="history" size={16} className="shrink-0 text-on-surface-variant" />
          <span className="min-w-0 grow truncate text-[13px] font-semibold text-on-surface-variant">
            {t("connection_quality.last_outage")}
          </span>
          {outageS === null ? (
            <span className="shrink-0 text-sm font-semibold text-on-surface-variant">
              {t("connection_quality.last_outage_none")}
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1">
              {/* The tip qualifies the reading, so it leads the value it describes. */}
              {outageWanIp ? (
                <HintIcon label={t("connection_quality.last_outage_ip_label")}>
                  {t(`connection_quality.${outageWanKey}`)}{" "}
                  <span className="font-mono">{outageWanIp}</span>
                </HintIcon>
              ) : null}
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-on-surface">
                {formatOutage(outageS, t)}
                {outageAgoS !== null ? (
                  <em className="font-semibold text-on-surface-variant not-italic">
                    {` ${t("connection_quality.last_outage_ago", { ago: formatAgo(outageAgoS, t) })}`}
                  </em>
                ) : null}
              </span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  );

  const reachStrip = (
    <div className="flex flex-col gap-1.5">
      <div className={QUALITY.LABEL_ROW}>
        <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-on-surface-variant">
          {t("connection_quality.reach_label")}
        </span>
        <Link
          href="/monitoring/events/"
          className={cn(
            "shrink-0 rounded-inline text-[11px] leading-tight font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
            reach.className,
          )}
        >
          {t(`connection_quality.${reach.key}`)}
        </Link>
      </div>
      <BucketStrip
        buckets={buckets}
        height={QUALITY.TRACK_H}
        t={t}
        ariaLabel={t("connection_quality.reach_aria", { minutes: windowMinutes })}
        renderCell={(b) => (
          <span
            className={cn("w-full rounded-[3px]", CELL_TONE[b.tone])}
            style={{ height: QUALITY.TRACK_H }}
          />
        )}
      />
    </div>
  );

  const jitterStrip = (
    <div className="flex flex-col gap-1.5">
      <div className={QUALITY.LABEL_ROW}>
        <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-on-surface-variant">
          {t("connection_quality.jitter_label")}
        </span>
        <span className="shrink-0 text-[11px] leading-tight font-semibold tabular-nums text-on-surface">
          {jitterMs === null
            ? t("connection_quality.jitter_no_reading")
            : t("connection_quality.jitter_now", { value: Math.round(jitterMs) })}
        </span>
      </div>
      <BucketStrip
        buckets={buckets}
        height={QUALITY.TRACK_H}
        t={t}
        ariaLabel={t("connection_quality.jitter_aria", { minutes: windowMinutes })}
        renderCell={(b) => {
          // Unmeasured and all-lost spans both have no jitter reading: a muted stub.
          if (!b.measured || b.jitter === null) {
            return (
              <span
                className="w-full rounded-[2px] bg-surface-container-high"
                style={{ height: QUALITY.STUB_H }}
              />
            );
          }
          const ratio = Math.min(1, Math.max(0, b.jitter / JITTER_TRACK_MAX_MS));
          const height = Math.max(QUALITY.MEASURED_MIN_H, Math.round(ratio * QUALITY.TRACK_H));
          return (
            <span className={cn("w-full rounded-[2px]", jitterTone(b.jitter))} style={{ height }} />
          );
        }}
      />
    </div>
  );

  const axis = (
    <div className="flex items-center justify-between gap-2 text-[10.5px] leading-tight text-on-surface-variant">
      <span className="truncate tabular-nums">{axisReach}</span>
      <span className="shrink-0">{t("connection_quality.axis_now")}</span>
    </div>
  );

  // A null aggregate means "window too short", never zero.
  const footerFigure = (labelKey: string, value: number | null, unit: string, decimals = 0) => (
    <div className={FIGURE.ROOT}>
      <span className={FIGURE.LABEL}>{t(labelKey)}</span>
      <span className={FIGURE.VALUE}>
        {value === null ? (
          ABSENT
        ) : (
          <>
            <TickingValue value={value}>{value.toFixed(decimals)}</TickingValue>
            <span className={FIGURE.UNIT}>{unit}</span>
          </>
        )}
      </span>
    </div>
  );

  // Variants only: this cascade inherits the page clock in home-component.tsx.
  return shell(
    <motion.div className="flex flex-1 flex-col gap-3" variants={staggerRows}>
      <motion.div variants={staggerRowItem}>{latencyTile}</motion.div>
      <motion.div variants={staggerRowItem}>{reachStrip}</motion.div>
      <motion.div variants={staggerRowItem}>{jitterStrip}</motion.div>
      <motion.div variants={staggerRowItem}>{axis}</motion.div>
      <motion.div
        variants={staggerRowItem}
        className="mt-auto grid grid-cols-3 gap-2 border-t border-surface-container-high pt-3"
      >
        {footerFigure(
          "connection_quality.footer_typical",
          connectivity?.avg_latency_ms ?? null,
          t("connection_quality.unit_ms"),
        )}
        {footerFigure(
          "connection_quality.footer_worst",
          connectivity?.max_latency_ms ?? null,
          t("connection_quality.unit_ms"),
        )}
        {footerFigure(
          "connection_quality.footer_loss",
          connectivity?.packet_loss_pct ?? null,
          t("connection_quality.unit_pct"),
          1,
        )}
      </motion.div>
    </motion.div>,
  );
};

export default ConnectionQualityComponent;
