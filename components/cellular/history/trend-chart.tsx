"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type { CellHistoryPoint } from "@/types/cell-history";

import { formatClock, formatMoment, hourTicks, type CellHistoryWindow } from "./derive";
import { CHART, CHART_BOX } from "./shapes";

// =============================================================================
// TrendChart — one archived reading over the selected range
// =============================================================================
// Used by the RF group and by the per-band RSRP card, so the two cannot drift
// into two chart idioms (axis, gap handling, tooltip voice). It is imported
// through `next/dynamic` by its callers, so the chart stack is not in this page's
// first paint: the card shells, their headings and their empty states all render
// from the payload alone.
//
// THREE RULES DECIDE EVERYTHING HERE:
//
//  * A GAP IS A GAP. `connectNulls={false}` and a `null` reading — a bucket in
//    which the poller recorded nothing is a break in the line, never a line
//    drawn through zero. `history.charts.gap_note` says the same thing on the
//    card, because a reader who wonders why the line stops deserves the answer
//    without a hover.
//  * NO ENTRANCE ANIMATION. The series retargets on a 30 s poll, and a draw-in
//    that replayed on every retarget would dim the one line being watched, once
//    every half minute (`docs/reference/motion-preference.md`). `isAnimationActive`
//    is therefore off rather than read from the motion preference: there is no
//    entrance here to honour.
//  * THE X AXIS IS LOCAL TIME, from epoch seconds. Under a day the ticks read
//    `HH:MM`; past a day they carry the date too, because `HH:MM` alone stops
//    locating anything on a range that crosses midnight.
//
// Ticks are handed to the axis EXPLICITLY, as milliseconds: left to itself the
// library generates its own time ticks as `Date` objects and hands them to the
// formatter, which is the path that printed "Invalid Date" across an axis
// elsewhere in this product.
// =============================================================================

const PLOT_MARGIN = { top: 8, right: 12, bottom: 4, left: 0 } as const;

export interface TrendChartProps {
  /** Buckets in the plotted unit; `v: null` is a bucket with no reading. */
  points: CellHistoryPoint[];
  /** Already-translated reading label — the series name in the tooltip. */
  label: string;
  unit: string | null;
  /** A role token (`var(--chart-nr)`), never a raw hex. */
  color: string;
  /** The metric's reporting bracket, widened by `yDomain` where a reading leaves it. */
  domain: readonly [number, number];
  window: CellHistoryWindow;
  longSpan: boolean;
}

interface Reading {
  ms: number;
  v: number | null;
}

function Readout({
  active,
  payload,
  label,
  unit,
  longSpan,
}: TooltipProps<ValueType, NameType> & {
  label: string;
  unit: string | null;
  longSpan: boolean;
}) {
  const point = payload?.[0]?.payload as Reading | undefined;
  if (!active || point === undefined) return null;
  return (
    <div className={CHART.TOOLTIP}>
      <span className={CHART.TOOLTIP_MOMENT}>
        {longSpan
          ? formatMoment(Math.floor(point.ms / 1000))
          : formatClock(Math.floor(point.ms / 1000))}
      </span>
      <span className={CHART.TOOLTIP_ROW}>
        <span className={CHART.TOOLTIP_KEY}>{label}</span>
        {point.v === null
          ? "—"
          : `${Math.round(point.v * 10) / 10}${unit === null ? "" : ` ${unit}`}`}
      </span>
    </div>
  );
}

export function TrendChart({
  points,
  label,
  unit,
  color,
  domain,
  window,
  longSpan,
}: TrendChartProps) {
  const config = {
    v: { label: unit === null ? label : `${label} · ${unit}`, color },
  } satisfies ChartConfig;

  // One extra field per point, not a second array: a time axis measures its
  // domain in milliseconds while the payload — and everything else on the page —
  // is in epoch seconds.
  const data: Reading[] = points.map((point) => ({
    ms: point.ts * 1000,
    v: point.v === null ? null : Math.round(point.v * 10) / 10,
  }));

  const ticks = hourTicks(window).map((tick) => tick.ts * 1000);
  const decimals = points.some(
    (point) => point.v !== null && !Number.isInteger(point.v),
  );

  return (
    <ChartContainer
      config={config}
      className={cn(CHART_BOX, "aspect-auto")}
      role="img"
      aria-label={unit === null ? label : `${label} · ${unit}`}
    >
      <LineChart data={data} margin={PLOT_MARGIN}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="ms"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          ticks={ticks}
          tickFormatter={(value: number) =>
            longSpan
              ? formatMoment(Math.floor(value / 1000))
              : formatClock(Math.floor(value / 1000))
          }
          tickLine={false}
          axisLine={false}
          minTickGap={28}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          allowDecimals={decimals}
          domain={[domain[0], domain[1]]}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={<Readout label={label} unit={unit} longSpan={longSpan} />}
        />
        <Line
          dataKey="v"
          // The hover card prints the series name, and recharts falls back to the
          // dataKey when a Line has none — so every hover would read a bare "v".
          name={label}
          type="monotone"
          stroke="var(--color-v)"
          strokeWidth={2}
          dot={false}
          // The gap rule. See the header.
          connectNulls={false}
          // The motion rule. See the header.
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}

export default TrendChart;
