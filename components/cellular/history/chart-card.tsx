"use client";

import dynamic from "next/dynamic";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CellHistoryRow } from "@/types/cell-history";

import {
  METRIC_AXIS,
  metricSeries,
  yDomain,
  type CellHistoryWindow,
  type ChartMetric,
} from "./derive";
import { CARD_DESC, CARD_SHELL, CARD_TITLE, CHART, CHART_BOX, LEGEND } from "./shapes";

// =============================================================================
// ChartCard — the RF group: RSRP, RSRQ and SINR over the range
// =============================================================================
// One card for the GROUP, not one card per metric, so the three cannot drift into
// three chart idioms (axis width, gap handling, empty state, tooltip voice).
//
// THIS IS THE READINGS PANEL, AND IT PLOTS ONLY WHAT THE RECORDER WRITES. Three
// columns, three charts: RSSI, CQI, rank, MCS, TX power, temperature, CPU and
// throughput are *not* in a cell-history row, so there is no fourth chart here
// rather than a chart of a line at zero — an absent reading is not a value.
//
// THE CHART STACK IS LOADED THROUGH `next/dynamic`, NOT IMPORTED. This card's
// shell, heading, per-chart titles and "no readings" states all render from the
// payload alone; recharts arrives in a separate chunk after hydration, and
// `ssr: false` because the build is a static export.
//
// A MISSING READING AND A FLAT ONE ARE DIFFERENT HOLES. A metric with no
// non-null value anywhere in the window draws the "no readings" state at the
// chart box's own height, so nothing jumps; a metric with one value draws a
// flat line, which is what a flat reading looks like.
//
// ONE ENTRY PER STROKE, NOT PER METRIC: all three plot in `--chart-nr` (they are
// all serving-cell radio readings), so one swatch names all three rather than
// three identical keys reading as a drawing bug. The colour never names a series
// on its own — every chart prints its own title.
// =============================================================================

const TrendChart = dynamic(() => import("./trend-chart"), {
  ssr: false,
  loading: () => <Skeleton className={cn(CHART_BOX, "rounded-tile")} />,
});

export interface ChartCardProps {
  /** Already-translated card title. */
  title: string;
  metrics: readonly ChartMetric[];
  rows: CellHistoryRow[];
  window: CellHistoryWindow;
  bucketSec: number;
  longSpan: boolean;
}

export function ChartCard({
  title,
  metrics,
  rows,
  window,
  bucketSec,
  longSpan,
}: ChartCardProps) {
  const { t } = useTranslation("cellular");

  const plots = metrics.map((metric) => {
    const axis = METRIC_AXIS[metric];
    const points = metricSeries(rows, metric, window, bucketSec);
    return {
      metric,
      axis,
      points,
      label: t(`history.charts.metric.${metric}`),
      drawn: points.some((point) => point.v !== null),
      domain: yDomain(metric, points),
    };
  });
  const drawn = plots.filter((plot) => plot.drawn);

  // One key per stroke, in first-appearance order.
  const keys: { tone: string; label: string }[] = [];
  for (const plot of drawn) {
    const existing = keys.find((entry) => entry.tone === plot.axis.tone);
    if (existing !== undefined) existing.label = `${existing.label} · ${plot.label}`;
    else keys.push({ tone: plot.axis.tone, label: plot.label });
  }

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{title}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.charts.gap_note")}
        </CardDescription>
        {drawn.length > 1 ? (
          <ul className={cn(LEGEND.ITEMS, "col-start-1 pt-1")}>
            {keys.map((entry) => (
              <li key={entry.tone} className={LEGEND.ITEM}>
                <span
                  className={LEGEND.LINE}
                  style={{ backgroundColor: entry.tone }}
                  aria-hidden="true"
                />
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>

      <CardContent>
        <div className={CHART.GRID}>
          {plots.map((plot) => (
            <div key={plot.metric} className={CHART.ROOT}>
              <h3 className={CHART.TITLE}>
                {plot.label}
                <span className={CHART.UNIT}>{plot.axis.unit}</span>
              </h3>
              {plot.drawn ? (
                <TrendChart
                  points={plot.points}
                  label={plot.label}
                  unit={plot.axis.unit}
                  color={plot.axis.tone}
                  domain={plot.domain}
                  window={window}
                  longSpan={longSpan}
                />
              ) : (
                <p className={cn(CHART_BOX, CHART.EMPTY)}>
                  {t("history.charts.no_data")}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default ChartCard;
