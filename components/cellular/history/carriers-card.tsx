"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SegmentedField } from "@/components/ui/segmented-field";
import { Tag } from "@/components/ui/tag";
import type {
  CarrierSeries,
  CellHistorySuccess,
  CellHistoryWindow,
} from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  buildRows,
  formatValue,
  gapThreshold,
  hasReading,
  median,
  valuesOf,
  type ChartFrame,
} from "./chart-data";
import {
  METRIC_AXIS,
  formatClock,
  formatMoment,
  hourTicks,
  windowSeconds,
  yDomain,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import type { PlotSeries } from "./history-chart";
import { gradeFor } from "./quality-grade";
import { LazyHistoryChart } from "./lazy-chart";
import { SeriesKey } from "./series-key";
import {
  CARD,
  CARRIER,
  CHART_BOX_TALL,
  CHART_NOTE,
  DASHES,
  FULL,
  HEAD,
  SERIES_TONE,
  STRIP,
} from "./shapes";

// =============================================================================
// CarriersCard — every component carrier the modem reported, not just the PCC
// =============================================================================
// This is "all bands". The old page drew the serving cell's RSRP and a band
// strip; an aggregated carrier on its own band was invisible. The archive now
// records every carrier in each row, so this card draws all of them twice:
//
//   LANES  one per carrier: a Tag with its band (B1, n41), its radio, width and
//          how often it was the primary - and a track showing WHEN it was
//          present. A carrier that comes and goes is a visible run, which is
//          the fact the old combo strip existed to show.
//   CHART  one line per carrier for the selected metric. Colour is the radio's
//          IDENTITY (LTE in the LTE family, NR in the NR family); two carriers
//          of one radio are told apart by DASH, not by a second hue, so the
//          chart reads in greyscale and for colour-blind readers. Clicking a
//          key entry isolates that carrier; clicking it again restores all.
//
// A carrier with no reading for the selected metric (RSSI is often absent on
// NR) keeps its key entry with a dash instead of a figure, and no line - a
// missing reading is a gap, never a flat line at zero.
// =============================================================================

const METRICS = ["rsrp", "sinr", "rsrq", "rssi"] as const;
type CarrierMetric = (typeof METRICS)[number];

/** Two shades per radio, both inside that radio's identity family. */
const FAMILY = {
  LTE: [SERIES_TONE.lte, "var(--lte)"],
  NR: [SERIES_TONE.nr, "var(--primary)"],
} as const;

/** Display band: B1 for LTE, n41 for NR. Never double-prefixed (band is a bare number). */
function bandLabel(carrier: CarrierSeries): string {
  return `${carrier.tech === "LTE" ? "B" : "n"}${carrier.band}`;
}

interface PresenceRun {
  start: number;
  end: number;
}

/**
 * When a carrier was present: runs of consecutive buckets in which it had ANY
 * reading, cut wherever the silence between two exceeds the gap threshold.
 */
function presenceRuns(
  carrier: CarrierSeries,
  bucketSec: number | null,
  windowEnd: number,
): PresenceRun[] {
  const stamps = new Set<number>();
  for (const series of [carrier.rsrp, carrier.rsrq, carrier.sinr, carrier.rssi]) {
    for (const point of series) if (point.v !== null) stamps.add(point.ts);
  }
  const sorted = [...stamps].sort((a, b) => a - b);
  const width = bucketSec ?? 60;
  const limit = gapThreshold(bucketSec);

  const runs: PresenceRun[] = [];
  for (const ts of sorted) {
    const last = runs[runs.length - 1];
    if (last && ts - (last.end - width) <= limit) {
      last.end = Math.min(ts + width, windowEnd);
    } else {
      runs.push({ start: ts, end: Math.min(ts + width, windowEnd) });
    }
  }
  return runs;
}

export interface CarriersCardProps {
  data: CellHistorySuccess;
  frame: ChartFrame;
  window: CellHistoryWindow;
}

export function CarriersCard({ data, frame, window }: CarriersCardProps) {
  const { t } = useTranslation("cellular");
  const [metric, setMetric] = useState<CarrierMetric>("rsrp");
  const [isolated, setIsolated] = useState<string | null>(null);

  const { carriers } = data;
  const span = windowSeconds(window);
  const ticks = hourTicks(window);
  const axis = METRIC_AXIS[metric];

  // Per-radio index, so the second LTE carrier is the second LTE shade; the
  // dash is by overall index so every carrier's stroke is unique.
  const perTech = { LTE: 0, NR: 0 };
  const styled = carriers.map((carrier, index) => {
    const family = FAMILY[carrier.tech];
    const shade = perTech[carrier.tech]++;
    return {
      carrier,
      field: `c${index}`,
      color: family[shade % family.length],
      dash: DASHES[index % DASHES.length],
      tag: bandLabel(carrier),
    };
  });

  const rows = buildRows(
    styled.map((item) => ({
      key: item.field,
      points: item.carrier[metric],
    })),
    frame.bucketSec,
  );

  const unit = axis.unit;
  const plots: PlotSeries[] = styled
    .filter((item) => hasReading(rows, item.field))
    .filter((item) => isolated === null || isolated === item.field)
    .map((item) => ({
      key: item.field,
      label: `${item.tag} ${item.carrier.tech === "LTE" ? t("history.charts.series.lte") : t("history.charts.series.nr")}`,
      color: item.color,
      dash: item.dash,
      kind: "line" as const,
      unit,
      decimals: axis.decimals,
      // quality ink by the selected metric; the carrier is named by its dash
      grade: gradeFor(metric),
    }));

  const domain = yDomain(
    axis.domain,
    valuesOf(
      rows,
      plots.map((plot) => plot.key),
    ),
  );

  const toggle = (field: string) =>
    setIsolated((current) => (current === field ? null : field));

  const moment = (ts: number) =>
    frame.longSpan ? formatMoment(ts) : formatClock(ts);

  return (
    <section className={cn(CARD, FULL)}>
      <header className={HEAD.ROOT}>
        <h2 className={HEAD.TITLE}>{t("history.carriers.title")}</h2>
        <p className={HEAD.DESC}>{t("history.carriers.description")}</p>
      </header>

      {carriers.length === 0 ? (
        <PanelEmpty icon="cell_tower" body={t("history.carriers.empty")} />
      ) : (
        <>
          <div className={CARRIER.LANES}>
            {styled.map((item) => {
              const { carrier } = item;
              const runs = presenceRuns(carrier, frame.bucketSec, frame.windowEnd);
              const dim = isolated !== null && isolated !== item.field;
              return (
                <div
                  key={carrier.key}
                  className={cn(CARRIER.LANE, dim && "opacity-45")}
                >
                  <div className={CARRIER.LABEL}>
                    <Tag variant={carrier.tech === "LTE" ? "lte" : "nr"}>
                      {item.tag}
                    </Tag>
                    <span>
                      {carrier.bw_mhz !== null
                        ? t("history.carriers.width", { mhz: carrier.bw_mhz })
                        : t("history.carriers.width_unknown")}
                    </span>
                    <span>
                      {carrier.role_pct_pcc > 0
                        ? t("history.carriers.pcc_share", {
                            pct: Math.round(carrier.role_pct_pcc),
                          })
                        : t("history.carriers.scc")}
                    </span>
                  </div>
                  <div
                    className={CARRIER.TRACK}
                    role="img"
                    aria-label={t("history.carriers.lane_aria", {
                      band: item.tag,
                      runs: runs.length,
                    })}
                  >
                    {runs.map((run) => (
                      <span
                        key={run.start}
                        className={cn(CARRIER.RUN)}
                        style={{
                          left: `${((run.start - window.start) / span) * 100}%`,
                          width: `max(2px, ${((run.end - run.start) / span) * 100}%)`,
                          backgroundColor: item.color,
                        }}
                        title={t("history.carriers.run_tip", {
                          band: item.tag,
                          from: moment(run.start),
                          to: moment(run.end),
                        })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {ticks.length > 0 ? (
              <div className={CARRIER.LANE} aria-hidden="true">
                <span className="hidden @2xl/card:block" />
                <div className={STRIP.TICKS}>
                  {ticks.map((tick) => (
                    <span
                      key={tick.ts}
                      className={STRIP.TICK}
                      style={{ left: `${tick.leftPct}%` }}
                    >
                      {moment(tick.ts)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className={CARRIER.SWITCH_ROW}>
            <SegmentedField
              value={metric}
              onValueChange={setMetric}
              options={METRICS.map((value) => ({
                value,
                label: t(`history.charts.metric.${value}`),
              }))}
              ariaLabel={t("history.carriers.metric_aria")}
              breakpoint="never"
              glyph={() => null}
            />
          </div>

          <SeriesKey
            ariaLabel={t("history.carriers.key_aria")}
            isolated={isolated}
            onSelect={toggle}
            items={styled.map((item) => {
              const mid = median(item.carrier[metric].map((point) => point.v));
              return {
                key: item.field,
                label: `${item.tag} ${item.carrier.tech === "LTE" ? t("history.charts.series.lte") : t("history.charts.series.nr")}`,
                color: gradeFor(metric) ? "var(--on-surface-variant)" : item.color,
                dash: item.dash,
                value:
                  mid === null
                    ? "—"
                    : `${formatValue(mid, axis.decimals)}${unit ? ` ${unit}` : ""}`,
              };
            })}
          />
          <p className={CHART_NOTE}>{t("history.carriers.key_note")}</p>

          {plots.length === 0 ? (
            <p
              className={cn(
                CHART_BOX_TALL,
                "grid place-items-center rounded-tile bg-surface-container px-4 text-center text-xs text-on-surface-variant",
              )}
            >
              {t("history.carriers.no_metric", {
                metric: t(`history.charts.metric.${metric}`),
              })}
            </p>
          ) : (
            <LazyHistoryChart
              {...frame}
              rows={rows}
              series={plots}
              leftDomain={domain}
              leftUnit={unit}
              className={CHART_BOX_TALL}
              ariaLabel={`${t("history.carriers.title")} - ${t(`history.charts.metric.${metric}`)}`}
            />
          )}
        </>
      )}
    </section>
  );
}

export default CarriersCard;
