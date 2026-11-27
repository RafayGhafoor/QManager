"use client";

import { useId } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  useChartBarMotion,
  useChartSeriesMotion,
} from "@/hooks/use-chart-motion";
import { axisTicks, formatAxisTick } from "@/lib/chart-time";

import { isIsolated, type ChartFrame, type ChartRow } from "./chart-data";
import { RESTART_MARK, SYNC_ID, syncNearest } from "./history-chart-marks";
import { HistoryTooltip, type TooltipNote } from "./history-tooltip";
import { CHART_BOX } from "./shapes";

// =============================================================================
// HistoryChart — the one chart every time-series panel on this page draws with
// =============================================================================
// Imported through `next/dynamic` by the cards, so the chart stack is not in the
// page's first paint: card shells, headings and empty states render from the
// payload alone and recharts arrives after them (spec R10).
//
// WHAT MAKES FIVE CARDS BEHAVE AS ONE PAGE
//
//  * ONE CROSSHAIR. Every chart carries `syncId="cell-history"` and a
//    nearest-instant `syncMethod` (`syncNearest`). The default sync matches
//    charts by data INDEX, which is wrong the moment two charts have different
//    row counts (a 24 h RF chart has 288 buckets, the congestion chart only the
//    buckets that were sampled), and recharts' built-in "value" sync needs the
//    x to match exactly. So hovering 03:10 anywhere puts the crosshair and the
//    tooltip at 03:10 in every chart that has that instant.
//  * ONE X AXIS. The domain is the payload's window, not each chart's own data
//    extent. A chart whose data stops early keeps its empty tail - the reader
//    sees WHEN the recording stopped instead of a line stretched over the width.
//  * A GAP IS A GAP. `connectNulls={false}` on every line; the rows already hold
//    a null row inside any silence longer than the gap threshold (chart-data).
//    A single isolated reading, which a line cannot draw, gets a dot.
//  * RESTARTS ARE REFERENCE LINES, dashed by cause, and the tooltip names the
//    one that falls inside the hovered bucket.
//  * EXACT VALUES. The tooltip prints every series at the hovered bucket to the
//    metric's own precision; nothing is rounded for the picture.
//
// MOTION. The series retargets every 60 s poll; the entrance is the shared
// `useChartSeriesMotion` switch (off under reduced motion), never a hand-set
// `isAnimationActive`.
// =============================================================================

export type PlotKind = "line" | "step" | "area" | "bar";

export interface PlotSeries {
  /** Row field. Also the recharts `dataKey`. */
  key: string;
  /** Already-translated series name (tooltip + accessible name). */
  label: string;
  /** A role token, never a raw hex. */
  color: string;
  kind?: PlotKind;
  axis?: "left" | "right";
  dash?: string;
  opacity?: number;
  width?: number;
  unit: string | null;
  decimals: number;
  /** Hide this series' tooltip row for rows where this returns false. */
  tooltipWhen?: (row: ChartRow) => boolean;
}

export interface HistoryChartProps extends ChartFrame {
  rows: ChartRow[];
  series: PlotSeries[];
  leftDomain: readonly [number, number] | null;
  rightDomain?: readonly [number, number] | null;
  leftUnit?: string | null;
  rightUnit?: string | null;
  /** Integer ticks only (counts, ranks, MCS). */
  integerTicks?: boolean;
  ariaLabel: string;
  className?: string;
  notes?: (row: ChartRow) => TooltipNote[];
}

export function HistoryChart({
  rows,
  series,
  windowStart,
  windowEnd,
  bucketSec,
  longSpan,
  restarts,
  leftDomain,
  rightDomain = null,
  leftUnit = null,
  rightUnit = null,
  integerTicks = false,
  ariaLabel,
  className = CHART_BOX,
  notes,
}: HistoryChartProps) {
  const { t } = useTranslation("cellular");
  const gradientId = useId().replace(/:/g, "");
  const lineMotion = useChartSeriesMotion();
  const barMotion = useChartBarMotion();

  const config: ChartConfig = {};
  for (const item of series) {
    config[item.key] = { label: item.label, color: item.color };
  }

  const startMs = windowStart * 1000;
  const endMs = windowEnd * 1000;
  const ticks = axisTicks(startMs, endMs);
  const hasRight = series.some((item) => item.axis === "right");
  const decimals = series.some((item) => item.decimals > 0);

  const tick = (ms: unknown) => formatAxisTick(ms, longSpan);

  return (
    <ChartContainer
      config={config}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <ComposedChart
        data={rows}
        margin={{ top: 8, right: hasRight ? 0 : 12, bottom: 4, left: 0 }}
        syncId={SYNC_ID}
        syncMethod={syncNearest(Math.max(60, bucketSec ?? 60) * 1000)}
      >
        <defs>
          {series
            .filter((item) => item.kind === "area")
            .map((item) => (
              <linearGradient
                key={item.key}
                id={`${gradientId}-${item.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                {/* The Area-Fill Rule: the stroke's own ink, capped under
                    0.35 at the stroke, fading to nothing. */}
                <stop offset="0%" stopColor={item.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={item.color} stopOpacity={0} />
              </linearGradient>
            ))}
        </defs>

        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          // Milliseconds: `scale="time"` measures its domain in ms, and the
          // domain is the payload window so every chart lines up.
          dataKey="ms"
          type="number"
          scale="time"
          domain={[startMs, endMs]}
          ticks={ticks}
          tickFormatter={tick}
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          allowDataOverflow
        />
        <YAxis
          yAxisId="left"
          width={44}
          tickLine={false}
          axisLine={false}
          allowDecimals={decimals && !integerTicks}
          domain={leftDomain === null ? ["auto", "auto"] : [leftDomain[0], leftDomain[1]]}
          unit={leftUnit && leftUnit.length <= 2 ? leftUnit : undefined}
        />
        {hasRight ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            width={48}
            tickLine={false}
            axisLine={false}
            domain={
              rightDomain === null ? ["auto", "auto"] : [rightDomain[0], rightDomain[1]]
            }
            unit={rightUnit && rightUnit.length <= 2 ? rightUnit : undefined}
          />
        ) : null}

        <ChartTooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--on-surface-variant)", strokeWidth: 1 }}
          content={
            <HistoryTooltip
              series={series}
              restarts={restarts}
              bucketSec={bucketSec}
              notes={notes}
            />
          }
        />

        {restarts.map((restart) => {
          const mark = RESTART_MARK[restart.cause];
          return (
            <ReferenceLine
              key={restart.boot_ts}
              yAxisId="left"
              x={restart.boot_ts * 1000}
              stroke={mark.stroke}
              strokeDasharray={mark.dash}
              strokeWidth={1.25}
              ifOverflow="hidden"
              aria-label={t(`history.restart.cause.${restart.cause}`)}
            />
          );
        })}

        {series.map((item) => {
          const yAxisId = item.axis ?? "left";
          if (item.kind === "bar") {
            return (
              <Bar
                key={item.key}
                yAxisId={yAxisId}
                dataKey={item.key}
                name={item.label}
                fill={item.color}
                fillOpacity={item.opacity ?? 1}
                radius={[2, 2, 0, 0]}
                maxBarSize={10}
                {...barMotion}
              />
            );
          }
          if (item.kind === "area") {
            return (
              <Area
                key={item.key}
                yAxisId={yAxisId}
                dataKey={item.key}
                name={item.label}
                type="monotone"
                stroke={item.color}
                strokeWidth={item.width ?? 1}
                strokeOpacity={item.opacity ?? 0.7}
                fill={`url(#${gradientId}-${item.key})`}
                connectNulls={false}
                dot={false}
                {...lineMotion}
              />
            );
          }
          return (
            <Line
              key={item.key}
              yAxisId={yAxisId}
              dataKey={item.key}
              name={item.label}
              type={item.kind === "step" ? "stepAfter" : "monotone"}
              stroke={item.color}
              strokeWidth={item.width ?? 2}
              strokeOpacity={item.opacity ?? 1}
              strokeDasharray={item.dash}
              connectNulls={false}
              dot={(props: {
                key?: string;
                cx?: number;
                cy?: number;
                index?: number;
              }) => {
                const index = props.index ?? -1;
                if (
                  props.cx === undefined ||
                  props.cy === undefined ||
                  !isIsolated(rows, index, item.key)
                ) {
                  return <g key={props.key ?? `${item.key}-${index}`} />;
                }
                return (
                  <circle
                    key={props.key ?? `${item.key}-${index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={2.5}
                    fill={item.color}
                    fillOpacity={item.opacity ?? 1}
                  />
                );
              }}
              {...lineMotion}
            />
          );
        })}
      </ComposedChart>
    </ChartContainer>
  );
}

export default HistoryChart;
