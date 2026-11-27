"use client";

import { useTranslation } from "react-i18next";

import type { CellHistorySuccess } from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  buildRows,
  hasReading,
  valuesOf,
  type ChartFrame,
} from "./chart-data";
import type { ChartSpec } from "./chart-specs";
import { METRIC_AXIS, yDomain } from "./derive";
import type { PlotSeries } from "./history-chart";
import { LazyHistoryChart } from "./lazy-chart";
import { SeriesKey } from "./series-key";
import { CARD, CHART, CHART_BOX, FULL, HEAD } from "./shapes";

// =============================================================================
// ChartCard — a titled group of small-multiple charts
// =============================================================================
// One card per GROUP: the radio-signal group, the aggregation group, the PHY
// group, the device group and the connection-quality group are each this
// component with a different spec list (`chart-specs.ts`), so they cannot drift
// into five chart idioms (axis width, gap handling, empty state, tooltip voice).
//
// Every chart inside draws through `HistoryChart`, which is what puts them all
// on one x axis, one shared crosshair and one set of restart marks.
//
// A MISSING PANEL AND AN EMPTY ONE ARE THE SAME HOLE. `missing[]` means the
// archive had no coverage for the panel in this range and an empty series means
// it had coverage but no reading. Neither can be filled by waiting, and an
// empty plot would read as "flat", which is a value. The hole says why when the
// reason is something the reader can change: layer-1 sampling being off.
//
// ONE FIXED HEIGHT PER CHART BOX. Loaded, loading and empty all draw a
// `CHART_BOX`-tall region, so a poll or a panel arriving never moves the card
// under the reader's cursor.
// =============================================================================

export interface ChartCardProps {
  titleKey: string;
  descriptionKey: string;
  charts: readonly ChartSpec[];
  data: CellHistorySuccess;
  frame: ChartFrame;
}

export function ChartCard({
  titleKey,
  descriptionKey,
  charts,
  data,
  frame,
}: ChartCardProps) {
  const { t } = useTranslation("cellular");
  const l1Enabled = data.recorder.l1_enabled;

  return (
    <section className={cn(CARD, FULL)}>
      <header className={HEAD.ROOT}>
        <h2 className={HEAD.TITLE}>{t(titleKey)}</h2>
        <p className={HEAD.DESC}>{t(descriptionKey)}</p>
      </header>

      <div className={CHART.GRID}>
        {charts.map((spec) => {
          const title = t(spec.titleKey);

          const rows = buildRows(
            spec.series.map((item) => ({
              key: item.metric,
              points: data.series[item.metric] ?? [],
              scale: METRIC_AXIS[item.metric].scale,
            })),
            frame.bucketSec,
          );

          const drawn = spec.series.filter((item) => hasReading(rows, item.metric));
          const plots: PlotSeries[] = drawn.map((item) => {
            const axis = METRIC_AXIS[item.metric];
            return {
              key: item.metric,
              label: item.labelKey ? t(item.labelKey) : title,
              color: axis.tone,
              kind: item.kind ?? (axis.step ? "step" : "line"),
              dash: item.dash,
              unit: axis.unit,
              decimals: axis.decimals,
            };
          });

          const first = METRIC_AXIS[spec.series[0].metric];
          const unit = first.unit;
          const domain = yDomain(
            first.domain,
            valuesOf(
              rows,
              drawn.map((item) => item.metric),
            ),
          );

          return (
            <div key={spec.id} className={CHART.ROOT}>
              <h3 className={CHART.TITLE}>
                {title}
                {unit ? <span className={CHART.UNIT}>{unit}</span> : null}
              </h3>

              {plots.length > 1 ? (
                <SeriesKey
                  ariaLabel={t("history.legend.series")}
                  items={plots.map((plot, index) => ({
                    key: plot.key,
                    label: plot.label,
                    color: plot.color,
                    dash: drawn[index].dash,
                  }))}
                />
              ) : null}

              {plots.length === 0 ? (
                <p className={cn(CHART_BOX, CHART.EMPTY)}>
                  {spec.l1 && !l1Enabled
                    ? t("history.charts.reporting_off")
                    : t("history.charts.no_data")}
                </p>
              ) : (
                <LazyHistoryChart
                  {...frame}
                  rows={rows}
                  series={plots}
                  leftDomain={domain}
                  leftUnit={unit}
                  integerTicks={first.decimals === 0}
                  ariaLabel={unit ? `${title} (${unit})` : title}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default ChartCard;
