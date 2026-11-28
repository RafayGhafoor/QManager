"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Area,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ChartTooltipTime } from "@/components/ui/chart-tooltip-time";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HintIcon } from "@/components/ui/hint-icon";
import {
  MaterialSymbol,
  type MaterialSymbolName,
} from "@/components/ui/material-symbol";
import { SegmentedField } from "@/components/ui/segmented-field";
import { Skeleton } from "@/components/ui/skeleton";

import { usePingHistory } from "@/hooks/use-ping-history";
import { axisTicks, formatAxisTick, formatMoment } from "@/lib/chart-time";
import { DUR, EASE_EMPHASIZED, transitionEmphasized } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { ConnectivityStatus } from "@/types/modem-status";
import {
  PING_HISTORY_RANGES,
  type PingHistoryRange,
  type PingHistoryRanged,
  type RestartCause,
  type RestartEntry,
} from "@/types/ping-history";

import { ABSENT, FIGURE, QUALITY_DIALOG as DLG, QUALITY_FALLBACK_CUTS } from "./shapes";

// =============================================================================
// Connection Quality — full view
// =============================================================================
// Opened from the dashboard card's top-right control. It reads the persisted
// per-minute archive (`usePingHistory`), so it can show a whole day or week,
// including the minutes the modem could not be reached.
//
// ANY POINT READS EVERY VALUE. The four stacked charts share one `syncId`, so a
// hover on any of them draws the crosshair on all of them, and the tip that
// opens carries latency (average, minimum, maximum), jitter, loss and probes for
// that minute, whichever chart the pointer is on. Only the chart under the
// pointer renders the tip; the others show the crosshair alone, otherwise four
// tips would open at once.
//
// SYNC IS BY INDEX, so every chart takes the SAME `rows` array. A minute with
// no probes is a row with null readings (inserted where the archive skips a
// bucket), not an omitted row: that is what breaks the lines, and it keeps the
// four charts' indexes identical.
//
// COLOUR. Latency and jitter have no direction and no radio identity, so they
// take the primary ink and the neutral ink (never the downlink/uplink pair).
// The loss bars and the reachability strip take the verdict roles, graded on
// the poller's own cuts (`connectivity.thresholds`), and each verdict is also
// named in the tip and the legend, so colour is never the only channel.
//
// SCALES ARE FLOORED. The latency axis wears a min-max wash; a ceiling that
// re-fitted itself on every read would redraw the same reading at a different
// height (DESIGN.md > The Area-Fill Rule). Each axis has a floor and grows by
// nice steps only when the data needs it.
// =============================================================================

interface ConnectionQualityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The poller's `connectivity` block, read-only: the cuts and nothing else. */
  connectivity: ConnectivityStatus | null;
}

type Tone = "success" | "warning" | "destructive";
type ChartKey = "latency" | "jitter" | "loss" | "strip";

const RANGE_LABEL_KEY: Record<PingHistoryRange, string> = {
  "1h": "connection_quality.dialog.range_1h",
  "6h": "connection_quality.dialog.range_6h",
  "24h": "connection_quality.dialog.range_24h",
  "7d": "connection_quality.dialog.range_7d",
};

const TONE_INK: Record<Tone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
};

const TONE_LABEL_KEY: Record<Tone, string> = {
  success: "connection_quality.reach_responsive",
  warning: "connection_quality.reach_degraded",
  destructive: "connection_quality.reach_unreachable",
};

const INK_LATENCY = "var(--primary-on-surface)";
const INK_JITTER = "var(--on-surface)";
const INK_RANGE = "var(--on-surface-variant)";

/**
 * How each restart cause draws: a glyph (so the legend never leans on hue), an
 * ink, a dash pattern, and the filled chip that names it in the list. Four
 * causes, four glyphs, four dash patterns.
 */
const RESTART_META: Record<
  RestartCause,
  {
    labelKey: string;
    icon: MaterialSymbolName;
    ink: string;
    dash: string;
    badge: "destructive" | "warning" | "muted";
  }
> = {
  power_loss: {
    labelKey: "connection_quality.dialog.restart_power_loss",
    icon: "bolt",
    ink: "var(--destructive-on-surface)",
    dash: "6 3",
    badge: "destructive",
  },
  restart: {
    labelKey: "connection_quality.dialog.restart_restart",
    icon: "restart_alt",
    ink: "var(--warning-on-surface)",
    dash: "3 3",
    badge: "warning",
  },
  planned: {
    labelKey: "connection_quality.dialog.restart_planned",
    icon: "power_settings_new",
    ink: "var(--on-surface-variant)",
    dash: "1 3",
    badge: "muted",
  },
  unknown: {
    labelKey: "connection_quality.dialog.restart_unknown",
    icon: "history",
    ink: "var(--on-surface-variant)",
    dash: "1 5",
    badge: "muted",
  },
};

const chartConfig = {
  avg: { label: "Average", color: INK_LATENCY },
  jit: { label: "Jitter", color: INK_JITTER },
  loss: { label: "Loss", color: "var(--warning)" },
} satisfies ChartConfig;

// --- Model -------------------------------------------------------------------

/** One plotted minute, or the null row that breaks the lines where the archive skips one. */
interface Row {
  /** Epoch seconds (the archive's unit; what the tip reads). */
  ts: number;
  /** The same instant in ms, because a `scale="time"` axis measures in ms. */
  ms: number;
  gap: boolean;
  n: number | null;
  ok: number | null;
  avg: number | null;
  min: number | null;
  max: number | null;
  jit: number | null;
  loss: number | null;
  /** `[min, max]` for the range area; null breaks it. */
  band: [number, number] | null;
  /** Loss only when there is some, so a clean minute draws no bar. */
  lossBar: number | null;
  tone: Tone | null;
  /** Constant series the strip chart plots invisibly so its tip has a datum. */
  zero: number;
}

interface ToneRun {
  from: number;
  to: number;
  tone: Tone;
}

interface Model {
  rows: Row[];
  runs: ToneRun[];
  startMs: number;
  endMs: number;
  yLatency: number;
  yJitter: number;
  yLoss: number;
  barSize: number;
  longSpan: boolean;
  restarts: RestartEntry[];
  typical: number | null;
  worst: number | null;
  lossPct: number | null;
  uptimePct: number | null;
}

/** Rounds up to a 1 / 2 / 5 step, so an axis grows in recognisable ceilings. */
function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const unit = value / pow;
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return step * pow;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildModel(
  data: PingHistoryRanged,
  cuts: { latencyMs: number; lossPct: number },
): Model {
  const { bucket_sec: step, points, window } = data;
  const rows: Row[] = [];
  const runs: ToneRun[] = [];

  const gapRow = (ts: number): Row => ({
    ts,
    ms: ts * 1000,
    gap: true,
    n: null,
    ok: null,
    avg: null,
    min: null,
    max: null,
    jit: null,
    loss: null,
    band: null,
    lossBar: null,
    tone: null,
    zero: 0,
  });

  let probes = 0;
  let answered = 0;
  let live = 0;
  let responsive = 0;
  let maxSeen = 0;
  let maxJit = 0;
  let maxLoss = 0;
  let worst: number | null = null;
  const avgs: number[] = [];

  points.forEach((p, i) => {
    // A cell with no answer at all is unreachable whatever its rolling numbers say.
    const tone: Tone =
      p.ok === 0 || p.loss >= cuts.lossPct
        ? "destructive"
        : p.loss > 0 || (p.avg !== null && p.avg > cuts.latencyMs)
          ? "warning"
          : "success";

    rows.push({
      ts: p.ts,
      ms: p.ts * 1000,
      gap: false,
      n: p.n,
      ok: p.ok,
      avg: p.avg,
      min: p.min,
      max: p.max,
      jit: p.jit,
      loss: p.loss,
      band: p.min !== null && p.max !== null ? [p.min, p.max] : null,
      lossBar: p.loss > 0 ? p.loss : null,
      tone,
      zero: 0,
    });

    const prev = runs[runs.length - 1];
    const contiguous = prev !== undefined && p.ts * 1000 - prev.to <= step * 500;
    if (prev && prev.tone === tone && contiguous) prev.to = (p.ts + step) * 1000;
    else runs.push({ from: p.ts * 1000, to: (p.ts + step) * 1000, tone });

    probes += p.n;
    answered += p.ok;
    if (p.n > 0) {
      live += 1;
      if (p.ok > 0) responsive += 1;
    }
    if (p.avg !== null) avgs.push(p.avg);
    const top = p.max ?? p.avg;
    if (top !== null) {
      maxSeen = Math.max(maxSeen, top);
      worst = worst === null ? top : Math.max(worst, top);
    }
    if (p.jit !== null) maxJit = Math.max(maxJit, p.jit);
    maxLoss = Math.max(maxLoss, p.loss);

    // The archive omits empty buckets; one null row marks the hole.
    const next = points[i + 1];
    if (next && next.ts - p.ts > step * 1.5) rows.push(gapRow(p.ts + step));
  });

  const startMs = window.start * 1000;
  const endMs = window.end * 1000;
  const expected = Math.max(1, Math.round((window.end - window.start) / step));

  return {
    rows,
    runs,
    startMs,
    endMs,
    yLatency: Math.max(DLG.LATENCY_FLOOR_MS, niceCeil(maxSeen * 1.1)),
    yJitter: Math.max(DLG.JITTER_FLOOR_MS, niceCeil(maxJit * 1.1)),
    yLoss: Math.max(DLG.LOSS_FLOOR_PCT, niceCeil(maxLoss * 1.1)),
    // A bar on a numeric axis takes the width of the tick spacing unless told
    // otherwise, so it is told: the plot is ~760px wide at the dialog's size.
    barSize: Math.max(2, Math.min(10, Math.floor(760 / expected) - 1)),
    longSpan: window.end - window.start > 2 * 86_400,
    restarts: data.restarts.filter(
      (r) => r.boot_ts >= window.start && r.boot_ts <= window.end,
    ),
    typical: median(avgs),
    worst,
    lossPct: probes > 0 ? ((probes - answered) / probes) * 100 : null,
    uptimePct: live > 0 ? (responsive / live) * 100 : null,
  };
}

/** True where a point has no live neighbour on either side, so a line would never draw it. */
function isIsolated(rows: Row[], index: number, key: "avg" | "jit"): boolean {
  const here = rows[index]?.[key];
  if (here === null || here === undefined) return false;
  return (
    (rows[index - 1]?.[key] ?? null) === null && (rows[index + 1]?.[key] ?? null) === null
  );
}

// --- Tip ---------------------------------------------------------------------

/** An outage length, coarsest two units; the same copy as the card's. */
function formatDuration(sec: number, t: TFunction): string {
  const s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return t("connection_quality.dur_dh", { d, h });
  if (h > 0) return t("connection_quality.dur_hm", { h, m });
  if (m > 0) return t("connection_quality.dur_ms", { m, s: s % 60 });
  return t("connection_quality.dur_s", { s });
}

interface TipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: Row }>;
}

/**
 * The shared tip's body. `ChartTooltipTime` formats one unit per call, and this
 * tip mixes ms, % and counts, so each value is formatted here and handed over as
 * a string with no unit; it still owns the time header and the row layout.
 */
function PingTip({
  active,
  payload,
  show,
  t,
}: TipProps & { show: boolean; t: TFunction }) {
  const row = payload?.[0]?.payload;
  if (!show || !active || !row) return null;

  const ms = t("connection_quality.unit_ms");
  const pct = t("connection_quality.unit_pct");
  const num = (v: number | null, unit: string) =>
    v === null ? null : `${Math.round(v * 10) / 10} ${unit}`;

  const items = row.gap
    ? [
        {
          name: t("connection_quality.dialog.tip_no_probes"),
          value: null,
          color: INK_RANGE,
          dataKey: "gap",
        },
      ]
    : [
        { name: t("connection_quality.dialog.tip_avg"), value: num(row.avg, ms), color: INK_LATENCY, dataKey: "avg" },
        { name: t("connection_quality.dialog.tip_min"), value: num(row.min, ms), color: INK_RANGE, dataKey: "min" },
        { name: t("connection_quality.dialog.tip_max"), value: num(row.max, ms), color: INK_RANGE, dataKey: "max" },
        { name: t("connection_quality.dialog.tip_jitter"), value: num(row.jit, ms), color: INK_JITTER, dataKey: "jit" },
        { name: t("connection_quality.dialog.tip_loss"), value: num(row.loss, pct), color: row.tone ? TONE_INK[row.tone] : INK_RANGE, dataKey: "loss" },
        {
          name: t("connection_quality.dialog.tip_answered"),
          value: t("connection_quality.dialog.tip_answered_value", { ok: row.ok ?? 0, n: row.n ?? 0 }),
          color: INK_RANGE,
          dataKey: "probes",
        },
      ];

  return <ChartTooltipTime active payload={items} empty={ABSENT} />;
}

// --- Chart pieces ------------------------------------------------------------

function restartLines(restarts: RestartEntry[]) {
  return restarts.map((r) => {
    const meta = RESTART_META[r.cause] ?? RESTART_META.unknown;
    return (
      <ReferenceLine
        key={`restart-${r.boot_ts}`}
        x={r.boot_ts * 1000}
        stroke={meta.ink}
        strokeDasharray={meta.dash}
        strokeWidth={1.5}
        ifOverflow="hidden"
      />
    );
  });
}

function LegendDot({ ink, label }: { ink: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0 rounded-pill" style={{ background: ink }} />
      {label}
    </span>
  );
}

function Panel({
  title,
  legend,
  children,
}: {
  title: string;
  legend?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={DLG.PANEL}>
      <div className={DLG.PANEL_HEAD}>
        <h3 className={DLG.PANEL_TITLE}>{title}</h3>
        {legend ? <div className={DLG.LEGEND}>{legend}</div> : null}
      </div>
      {children}
    </section>
  );
}

// --- States ------------------------------------------------------------------

function DialogSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      {[DLG.BOX_LATENCY, DLG.BOX_JITTER, DLG.BOX_LOSS, DLG.BOX_STRIP].map((box, i) => (
        <div key={i} className={DLG.PANEL}>
          {i < 3 ? <Skeleton className="h-4 w-28" /> : null}
          <Skeleton className={cn(box, "rounded-tile")} />
        </div>
      ))}
      <div className={DLG.FOOTER}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className="h-2.5 w-12" />
            <Skeleton className="h-[22px] w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Dialog ------------------------------------------------------------------

export default function ConnectionQualityDialog({
  open,
  onOpenChange,
  connectivity,
}: ConnectionQualityDialogProps) {
  const { t } = useTranslation("dashboard");
  const [range, setRange] = React.useState<PingHistoryRange>(DLG.DEFAULT_RANGE);
  const [activeChart, setActiveChart] = React.useState<ChartKey>("latency");

  const { data, dataRange, error, refresh } = usePingHistory(range, { enabled: open });

  const latencyCut = connectivity?.thresholds?.latency_ms;
  const lossCut = connectivity?.thresholds?.loss_pct;
  const cuts = React.useMemo(
    () => ({
      latencyMs: latencyCut ?? QUALITY_FALLBACK_CUTS.LATENCY_MS,
      lossPct: lossCut ?? QUALITY_FALLBACK_CUTS.LOSS_PCT,
    }),
    [latencyCut, lossCut],
  );

  const model = React.useMemo(() => (data ? buildModel(data, cuts) : null), [data, cuts]);

  // The state is decided from what has landed FOR the chosen range. A read for
  // a new range keeps the old picture on screen, dimmed, until it arrives.
  const fresh = data !== null && dataRange === range;
  const view: "loading" | "empty" | "error" | "data" = fresh
    ? data.points.length > 0
      ? "data"
      : "empty"
    : error
      ? "error"
      : data && data.points.length > 0
        ? "data"
        : "loading";

  const ms = t("connection_quality.unit_ms");
  const pct = t("connection_quality.unit_pct");

  // An element, not a render function: recharts clones it and injects the datum.
  const tip = (key: ChartKey) => <PingTip show={activeChart === key} t={t} />;
  // Focus bubbles in React, so keyboard users switch the active tip too.
  const hot = (key: ChartKey) => ({
    onMouseEnter: () => setActiveChart(key),
    onFocus: () => setActiveChart(key),
  });

  const body = (() => {
    if (view === "loading") return <DialogSkeleton />;

    if (view === "error") {
      return (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MaterialSymbol name="cloud_off" size={24} />
            </EmptyMedia>
            <EmptyTitle>{t("connection_quality.dialog.error_title")}</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              {t("connection_quality.dialog.error_description")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" onClick={refresh}>
              <MaterialSymbol name="refresh" size={18} />
              {t("connection_quality.dialog.error_retry")}
            </Button>
          </EmptyContent>
        </Empty>
      );
    }

    if (view === "empty" || !data || !model) {
      return (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MaterialSymbol name="radar" size={24} />
            </EmptyMedia>
            <EmptyTitle>{t("connection_quality.dialog.empty_title")}</EmptyTitle>
            <EmptyDescription className="max-w-xs text-pretty">
              {t("connection_quality.dialog.empty_description")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    const stale = !fresh;
    const { rows, startMs, endMs } = model;
    const ticks = axisTicks(startMs, endMs, 6);
    const latencyCutVisible = latencyCut !== undefined && latencyCut <= model.yLatency;
    const lossCutVisible = lossCut !== undefined && lossCut <= model.yLoss;
    const causes = [...new Set(model.restarts.map((r) => r.cause))];

    const xAxis = () => (
      <XAxis
        dataKey="ms"
        type="number"
        scale="time"
        domain={[startMs, endMs]}
        ticks={ticks}
        tickFormatter={(v) => formatAxisTick(v, model.longSpan)}
        tickLine={false}
        axisLine={false}
        minTickGap={28}
        height={24}
      />
    );
    const yAxis = (domain: [number, number], format: (v: number) => string, tickCount = 4) => (
      <YAxis
        width={DLG.Y_AXIS_W}
        domain={domain}
        tickCount={tickCount}
        tickFormatter={format}
        tickLine={false}
        axisLine={false}
        allowDecimals={false}
      />
    );
    const cursor = { stroke: "var(--on-surface-variant)", strokeWidth: 1, strokeOpacity: 0.6 };
    const common = { data: rows, syncId: DLG.SYNC_ID, margin: DLG.MARGIN };
    const tooltipProps = {
      cursor,
      filterNull: false,
      isAnimationActive: false,
      offset: 14,
      allowEscapeViewBox: { x: false, y: true },
    } as const;

    return (
      <div
        className={cn(
          "flex flex-col gap-5 transition-opacity duration-[var(--duration-quick)] ease-out",
          stale && "opacity-50",
        )}
        aria-busy={stale}
      >
        <Panel
          title={t("connection_quality.dialog.latency_title")}
          legend={
            <>
              <LegendDot ink={INK_LATENCY} label={t("connection_quality.dialog.legend_avg")} />
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2 w-3 shrink-0 rounded-[2px]"
                  style={{ background: INK_LATENCY, opacity: DLG.BAND_OPACITY * 2 }}
                />
                {t("connection_quality.dialog.legend_band")}
              </span>
              {latencyCutVisible ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="w-3 shrink-0 border-t-2 border-dashed"
                    style={{ borderColor: "var(--chart-threshold)" }}
                  />
                  {t("connection_quality.dialog.legend_latency_cut", { value: latencyCut })}
                </span>
              ) : null}
            </>
          }
        >
          <div {...hot("latency")}>
            <ChartContainer
              config={chartConfig}
              className={cn("aspect-auto", DLG.BOX_LATENCY)}
              role="img"
              aria-label={t("connection_quality.dialog.latency_aria")}
            >
              <ComposedChart {...common}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {xAxis()}
                {yAxis([0, model.yLatency], (v) => `${v}`)}
                <ChartTooltip {...tooltipProps} content={tip("latency")} />
                {latencyCutVisible ? (
                  <ReferenceLine
                    y={latencyCut}
                    stroke="var(--chart-threshold)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                  />
                ) : null}
                {restartLines(model.restarts)}
                <Area
                  dataKey="band"
                  type="monotone"
                  stroke="none"
                  fill={INK_LATENCY}
                  fillOpacity={DLG.BAND_OPACITY}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={false}
                  legendType="none"
                />
                <Line
                  dataKey="avg"
                  name={t("connection_quality.dialog.tip_avg")}
                  type="monotone"
                  stroke={INK_LATENCY}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={(p: { cx?: number; cy?: number; index?: number }) =>
                    isIsolated(rows, p.index ?? -1, "avg") ? (
                      <circle key={`d-${p.index}`} cx={p.cx} cy={p.cy} r={2.5} fill={INK_LATENCY} />
                    ) : (
                      <g key={`d-${p.index}`} />
                    )
                  }
                  activeDot={{ r: 3.5, fill: INK_LATENCY, stroke: "var(--surface)", strokeWidth: 1.5 }}
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        </Panel>

        <Panel title={t("connection_quality.dialog.jitter_title")}>
          <div {...hot("jitter")}>
            <ChartContainer
              config={chartConfig}
              className={cn("aspect-auto", DLG.BOX_JITTER)}
              role="img"
              aria-label={t("connection_quality.dialog.jitter_aria")}
            >
              <ComposedChart {...common}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {xAxis()}
                {yAxis([0, model.yJitter], (v) => `${v}`, 3)}
                <ChartTooltip {...tooltipProps} content={tip("jitter")} />
                {restartLines(model.restarts)}
                <Line
                  dataKey="jit"
                  name={t("connection_quality.dialog.tip_jitter")}
                  type="monotone"
                  stroke={INK_JITTER}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={(p: { cx?: number; cy?: number; index?: number }) =>
                    isIsolated(rows, p.index ?? -1, "jit") ? (
                      <circle key={`d-${p.index}`} cx={p.cx} cy={p.cy} r={2.5} fill={INK_JITTER} />
                    ) : (
                      <g key={`d-${p.index}`} />
                    )
                  }
                  activeDot={{ r: 3.5, fill: INK_JITTER, stroke: "var(--surface)", strokeWidth: 1.5 }}
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        </Panel>

        <Panel
          title={t("connection_quality.dialog.loss_title")}
          legend={
            <>
              {(["success", "warning", "destructive"] as const).map((tone) => (
                <LegendDot key={tone} ink={TONE_INK[tone]} label={t(TONE_LABEL_KEY[tone])} />
              ))}
              {lossCutVisible ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="w-3 shrink-0 border-t-2 border-dashed"
                    style={{ borderColor: "var(--chart-threshold)" }}
                  />
                  {t("connection_quality.dialog.legend_loss_cut", { value: lossCut })}
                </span>
              ) : null}
            </>
          }
        >
          <div {...hot("loss")}>
            <ChartContainer
              config={chartConfig}
              className={cn("aspect-auto", DLG.BOX_LOSS)}
              role="img"
              aria-label={t("connection_quality.dialog.loss_aria")}
            >
              <ComposedChart {...common}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {xAxis()}
                {yAxis([0, model.yLoss], (v) => `${v}${pct}`, 3)}
                <ChartTooltip {...tooltipProps} content={tip("loss")} />
                {lossCutVisible ? (
                  <ReferenceLine
                    y={lossCut}
                    stroke="var(--chart-threshold)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.8}
                  />
                ) : null}
                {restartLines(model.restarts)}
                <Bar
                  dataKey="lossBar"
                  barSize={model.barSize}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                >
                  {rows.map((r) => (
                    <Cell key={r.ms} fill={r.tone ? TONE_INK[r.tone] : "transparent"} />
                  ))}
                </Bar>
              </ComposedChart>
            </ChartContainer>
          </div>

          {/* The reachability strip, on the same axis as the three above so a
              dip lines up with the minute it happened in. */}
          <div {...hot("strip")}>
            <ChartContainer
              config={chartConfig}
              className={cn("aspect-auto", DLG.BOX_STRIP)}
              role="img"
              aria-label={t("connection_quality.dialog.reach_aria")}
            >
              <ComposedChart {...common} margin={{ ...DLG.MARGIN, top: 0 }}>
                {xAxis()}
                <YAxis
                  width={DLG.Y_AXIS_W}
                  domain={[0, 1]}
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip {...tooltipProps} content={tip("strip")} />
                <ReferenceArea
                  x1={startMs}
                  x2={endMs}
                  y1={0}
                  y2={1}
                  fill="var(--surface-container-high)"
                  fillOpacity={1}
                  ifOverflow="hidden"
                />
                {model.runs.map((run) => (
                  <ReferenceArea
                    key={`run-${run.from}`}
                    x1={run.from}
                    x2={Math.min(run.to, endMs)}
                    y1={0}
                    y2={1}
                    fill={TONE_INK[run.tone]}
                    fillOpacity={1}
                    strokeWidth={0}
                    ifOverflow="hidden"
                  />
                ))}
                {restartLines(model.restarts)}
                {/* Invisible: it exists so the strip has a datum for the shared tip. */}
                <Line
                  dataKey="zero"
                  stroke="transparent"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              </ComposedChart>
            </ChartContainer>
          </div>
        </Panel>

        {model.restarts.length > 0 ? (
          <section className={DLG.PANEL}>
            <div className={DLG.PANEL_HEAD}>
              <h3 className={DLG.PANEL_TITLE}>{t("connection_quality.dialog.restarts_title")}</h3>
              <div className={DLG.LEGEND}>
                {causes.map((cause) => {
                  const meta = RESTART_META[cause] ?? RESTART_META.unknown;
                  return (
                    <span key={cause} className="inline-flex items-center gap-1.5">
                      <svg aria-hidden width="14" height="4" className="shrink-0">
                        <line
                          x1="0"
                          y1="2"
                          x2="14"
                          y2="2"
                          stroke={meta.ink}
                          strokeWidth="1.5"
                          strokeDasharray={meta.dash}
                        />
                      </svg>
                      {t(meta.labelKey)}
                    </span>
                  );
                })}
              </div>
            </div>
            <ul className="flex flex-wrap gap-2">
              {[...model.restarts]
                .sort((a, b) => b.boot_ts - a.boot_ts)
                .slice(0, 6)
                .map((r) => {
                  const meta = RESTART_META[r.cause] ?? RESTART_META.unknown;
                  return (
                    <li key={r.boot_ts}>
                      <Badge variant={meta.badge} className="gap-1.5 tabular-nums">
                        <MaterialSymbol name={meta.icon} size={12} />
                        {t(meta.labelKey)}
                        <span className="font-normal">
                          {formatMoment(r.boot_ts)}
                          {r.down_sec !== null && r.down_sec > 0
                            ? ` · ${t("connection_quality.dialog.restart_down", {
                                duration: formatDuration(r.down_sec, t),
                              })}`
                            : ""}
                        </span>
                      </Badge>
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}

        <p className="text-[11px] leading-relaxed text-on-surface-variant text-pretty">
          {t("connection_quality.dialog.gap_note")}
        </p>

        <div className={DLG.FOOTER}>
          <Figure
            label={t("connection_quality.footer_typical")}
            value={model.typical}
            unit={ms}
          />
          <Figure label={t("connection_quality.footer_worst")} value={model.worst} unit={ms} />
          <Figure
            label={t("connection_quality.footer_loss")}
            value={model.lossPct}
            unit={pct}
            decimals={1}
          />
          <Figure
            label={t("connection_quality.dialog.footer_uptime")}
            value={model.uptimePct}
            unit={pct}
            decimals={1}
            hint={t("connection_quality.dialog.footer_hint")}
          />
        </div>
      </div>
    );
  })();

  const windowLabel = data
    ? `${formatMoment(data.window.start)} – ${formatMoment(data.window.end)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          DLG.CONTENT,
          // The panel arrives on the emphasized clock; the exit stays on the
          // primitive's `quick` (DESIGN.md > The Modal-Exit Rule).
          "data-[state=open]:duration-[var(--duration-emphasized)]",
          "data-[state=open]:ease-emphasized",
        )}
      >
        <DialogHeader className="flex-row items-start gap-3 space-y-0 text-left">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle className="text-base font-semibold">
              {t("connection_quality.title")}
            </DialogTitle>
            <DialogDescription className="text-sm text-on-surface-variant text-pretty">
              {t("connection_quality.dialog.description")}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("connection_quality.dialog.close_aria")}
              className="text-on-surface-variant hover:bg-surface-container grid size-8 flex-none place-items-center rounded-pill transition-colors duration-[var(--duration-quick)] ease-out outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <MaterialSymbol name="close" size={20} />
            </button>
          </DialogClose>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SegmentedField
            value={range}
            onValueChange={setRange}
            options={PING_HISTORY_RANGES.map((value) => ({
              value,
              label: t(RANGE_LABEL_KEY[value]),
              numeric: true,
            }))}
            ariaLabel={t("connection_quality.dialog.range_aria")}
            breakpoint="never"
            // The active pill's fill marks it; a check beside a range label
            // would be a second, redundant mark.
            glyph={() => null}
          />
          {windowLabel ? (
            <span className="text-xs font-medium tabular-nums text-on-surface-variant">
              {windowLabel}
            </span>
          ) : null}
        </div>

        {/* State swaps ride the emphasized curve; `wait` keeps two bodies from
            overlapping in a box whose height is changing under them. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: transitionEmphasized }}
            exit={{ opacity: 0, transition: { duration: DUR.quick, ease: EASE_EMPHASIZED } }}
          >
            {body}
          </motion.div>
        </AnimatePresence>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="tonal-neutral" size="sm">
            <Link href="/monitoring/latency/" onClick={() => onOpenChange(false)}>
              {t("connection_quality.dialog.link_latency")}
            </Link>
          </Button>
          <Button asChild variant="tonal-neutral" size="sm">
            <Link href="/monitoring/connection-quality/" onClick={() => onOpenChange(false)}>
              {t("connection_quality.dialog.link_settings")}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled figure; a null aggregate means "no probes in the range", never zero. */
function Figure({
  label,
  value,
  unit,
  decimals = 0,
  hint,
}: {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  hint?: string;
}) {
  return (
    <div className={FIGURE.ROOT}>
      <span className={FIGURE.LABEL}>
        {label}
        {hint ? <HintIcon label={label}>{hint}</HintIcon> : null}
      </span>
      <span className={FIGURE.VALUE}>
        {value === null ? (
          ABSENT
        ) : (
          <>
            {value.toFixed(decimals)}
            <span className={FIGURE.UNIT}>{unit}</span>
          </>
        )}
      </span>
    </div>
  );
}
