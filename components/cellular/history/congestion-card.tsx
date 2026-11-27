"use client";

import { useTranslation } from "react-i18next";

import { HintIcon } from "@/components/ui/hint-icon";
import type { CellHistorySuccess } from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  buildRows,
  gapThreshold,
  hasReading,
  type ChartFrame,
} from "./chart-data";
import { PanelEmpty } from "./empty-state";
import type { PlotSeries } from "./history-chart";
import { LazyHistoryChart } from "./lazy-chart";
import { SeriesKey } from "./series-key";
import {
  CARD,
  CHART_BOX_TALL,
  CHART_NOTE,
  DASHES,
  FULL,
  HEAD,
  SERIES_TONE,
} from "./shapes";

// =============================================================================
// CongestionCard — this device's share of the carrier, under load
// =============================================================================
// `prb_share` is the radio resource blocks THIS device was given, over the
// carrier's total. It is NOT the cell's load: while nobody is downloading, a
// small share only means this device asked for little. It means something only
// while the link is saturated, so the card draws the two cases differently:
//
//   * SATURATED buckets (the link was busy enough to measure) are a solid
//     `--downlink` line - a low share here is a device being squeezed.
//   * Every other bucket is the same line, dashed and faint, and the tooltip
//     says the link was not saturated. It is drawn rather than hidden so the
//     reader can see WHEN the link was idle, but it must not read as a verdict.
//
// Download throughput sits behind it as an area on its own right-hand axis. The
// area-fill rule needs a fixed or FLOORED scale (DESIGN.md > The Area-Fill
// Rule): the ceiling here is never below 100 Mbit/s, so a quiet day does not
// stretch a 3 Mbit/s trickle into a wall.
//
// A missing share is a gap, never zero. When layer-1 sampling is off the card
// says so instead of drawing an empty plot.
// =============================================================================

/** The throughput axis never ceilings below this, in Mbit/s. */
const DL_CEILING_FLOOR = 100;
/** ...and rounds up to this step, so the scale does not twitch every poll. */
const DL_CEILING_STEP = 50;

export interface CongestionCardProps {
  data: CellHistorySuccess;
  frame: ChartFrame;
}

export function CongestionCard({ data, frame }: CongestionCardProps) {
  const { t } = useTranslation("cellular");
  const { congestion } = data;
  const limit = gapThreshold(frame.bucketSec);

  const ordered = [...congestion].sort((a, b) => a.ts - b.ts);

  // A busy bucket next to an idle one must still join its dashed neighbour, or
  // the line would break at every saturation change. The idle series therefore
  // also carries the saturated bucket on each side of an idle one; the tooltip
  // hides it there (`tooltipWhen`) so no bucket is read twice.
  const joinsIdle = (index: number): boolean => {
    const here = ordered[index];
    if (!here.saturated) return false;
    return [ordered[index - 1], ordered[index + 1]].some(
      (neighbour) =>
        neighbour !== undefined &&
        !neighbour.saturated &&
        Math.abs(neighbour.ts - here.ts) <= limit,
    );
  };

  const rows = buildRows(
    [
      {
        key: "prb_sat",
        points: ordered.map((p) => ({
          ts: p.ts,
          v: p.saturated ? p.prb_share : null,
        })),
      },
      {
        key: "prb_idle",
        points: ordered.map((p, i) => ({
          ts: p.ts,
          v: !p.saturated || joinsIdle(i) ? p.prb_share : null,
        })),
      },
      {
        key: "prb_max",
        points: ordered.map((p) => ({ ts: p.ts, v: p.prb_max_share })),
      },
      {
        key: "dl",
        points: ordered.map((p) => ({ ts: p.ts, v: p.dl_bps })),
        scale: 1e-6,
      },
      {
        key: "sat",
        points: ordered.map((p) => ({ ts: p.ts, v: p.saturated ? 1 : 0 })),
      },
    ],
    frame.bucketSec,
  );

  const hasShare = hasReading(rows, "prb_sat") || hasReading(rows, "prb_idle");
  const busy = ordered.filter((p) => p.saturated && p.prb_share !== null).length;
  const measured = ordered.filter((p) => p.prb_share !== null).length;

  let maxDl = 0;
  for (const row of rows) if (row.dl !== null && row.dl > maxDl) maxDl = row.dl;
  const ceiling = Math.max(
    DL_CEILING_FLOOR,
    Math.ceil(maxDl / DL_CEILING_STEP) * DL_CEILING_STEP,
  );

  const plots: PlotSeries[] = [];
  if (hasReading(rows, "dl")) {
    plots.push({
      key: "dl",
      label: t("history.congestion.dl"),
      color: SERIES_TONE.down,
      kind: "area",
      axis: "right",
      unit: "Mbit/s",
      decimals: 2,
      opacity: 0.6,
    });
  }
  plots.push(
    {
      key: "prb_max",
      label: t("history.congestion.max_share"),
      color: SERIES_TONE.down,
      width: 1,
      opacity: 0.35,
      unit: "%",
      decimals: 1,
    },
    {
      key: "prb_idle",
      label: t("history.congestion.share_idle"),
      color: SERIES_TONE.down,
      dash: DASHES[1],
      opacity: 0.5,
      unit: "%",
      decimals: 1,
      tooltipWhen: (row) => row.sat !== 1,
    },
    {
      key: "prb_sat",
      label: t("history.congestion.share"),
      color: SERIES_TONE.down,
      unit: "%",
      decimals: 1,
      tooltipWhen: (row) => row.sat === 1,
    },
  );

  const empty = congestion.length === 0 || !hasShare;

  return (
    <section className={cn(CARD, FULL)}>
      <header className={HEAD.ROOT}>
        <h2 className={cn(HEAD.TITLE, "flex items-center gap-1.5")}>
          {t("history.congestion.title")}
          <HintIcon label={t("history.congestion.hint_label")}>
            {t("history.congestion.hint")}
          </HintIcon>
        </h2>
        <p className={HEAD.DESC}>{t("history.congestion.description")}</p>
      </header>

      {empty ? (
        <PanelEmpty
          icon="speed"
          body={
            data.recorder.l1_enabled
              ? t("history.congestion.empty")
              : t("history.charts.reporting_off")
          }
        />
      ) : (
        <>
          <SeriesKey
            ariaLabel={t("history.legend.series")}
            items={[
              {
                key: "prb_sat",
                label: t("history.congestion.share"),
                color: SERIES_TONE.down,
              },
              {
                key: "prb_idle",
                label: t("history.congestion.share_idle"),
                color: SERIES_TONE.down,
                dash: DASHES[1],
                opacity: 0.5,
              },
              {
                key: "prb_max",
                label: t("history.congestion.max_share"),
                color: SERIES_TONE.down,
                opacity: 0.35,
              },
              ...(hasReading(rows, "dl")
                ? [
                    {
                      key: "dl",
                      label: t("history.congestion.dl"),
                      color: SERIES_TONE.down,
                      opacity: 0.6,
                    },
                  ]
                : []),
            ]}
          />
          <p className={CHART_NOTE}>
            {t("history.congestion.busy_count", { busy, total: measured })}
          </p>
          <LazyHistoryChart
            {...frame}
            rows={rows}
            series={plots}
            leftDomain={[0, 100]}
            leftUnit="%"
            rightDomain={[0, ceiling]}
            rightUnit={null}
            className={CHART_BOX_TALL}
            ariaLabel={t("history.congestion.title")}
            notes={(row) =>
              row.sat === 0 && row.prb_idle !== null
                ? [
                    {
                      label: t("history.congestion.note_label"),
                      value: t("history.congestion.not_saturated"),
                    },
                  ]
                : []
            }
          />
        </>
      )}
    </section>
  );
}

export default CongestionCard;
