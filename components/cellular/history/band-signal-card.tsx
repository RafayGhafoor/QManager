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
import { qualityStrokeVar } from "@/components/cellular/signal-quality-display";
import { cn } from "@/lib/utils";
import {
  RSRP_THRESHOLDS,
  getSignalQuality,
  type SignalQuality,
} from "@/types/modem-status";
import type { CellHistoryPoint, CellHistoryRow } from "@/types/cell-history";

import {
  bandRsrpSeries,
  yDomain,
  type CellHistoryWindow,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import {
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  CHART,
  CHART_BOX,
  LEGEND,
} from "./shapes";

// =============================================================================
// BandSignalCard — RSRP per serving band, not one aggregate RSRP
// =============================================================================
// The owner asked for "multiple bars for each rsrp of bands". The RF card plots
// the serving cell's RSRP as one line; this card splits that same reading by the
// LTE band the device was camped on, so a range that handover'd between B1 and
// B3 shows two lines and the weaker band is visible as its own series.
//
// WHAT IT IS NOT. The recorder writes ONE RSRP per row — the serving carrier's.
// It does not write per-component-carrier signal, so this is "the RSRP while on
// that band", not a per-carrier measurement, and the card's description says so.
// Nothing here is interpolated to look like per-carrier data.
//
// WHY LINES AND NOT BARS. The x axis is time, so a "bar per band" would be a bar
// per (time, band) pair — grouped bars over a 24 h axis is a smear. The bar idiom
// belongs to a snapshot, and the Cellular Information page already draws that.
//
// COLOUR IS QUALITY, NOT IDENTITY, and it is the product's own five-stop ramp
// (`getSignalQuality` + `qualityStrokeVar`), evaluated per band over the band's
// OWN median — never the page's aggregate. The legend names each band with its
// quality word, because colour alone is not an accessible channel.
//
// A band with no reading in a bucket keeps a `null`, so the line BREAKS rather
// than being drawn through a hole — the same rule as every other chart here.
// =============================================================================

const TrendChart = dynamic(() => import("./trend-chart"), {
  ssr: false,
  loading: () => <Skeleton className={cn(CHART_BOX, "rounded-tile")} />,
});

/** Median of the band's readings — the figure the stroke is tinted by. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const QUALITY_LABEL: Record<SignalQuality, string> = {
  excellent: "excellent",
  good: "good",
  fair: "fair",
  poor: "poor",
  none: "none",
};

export interface BandSignalCardProps {
  rows: CellHistoryRow[];
  window: CellHistoryWindow;
  bucketSec: number;
  longSpan: boolean;
}

export function BandSignalCard({
  rows,
  window,
  bucketSec,
  longSpan,
}: BandSignalCardProps) {
  const { t } = useTranslation("cellular");
  const series: Record<string, CellHistoryPoint[]> = bandRsrpSeries(
    rows,
    window,
    bucketSec,
  );

  const bands = Object.entries(series)
    .map(([band, points]) => {
      const values = points
        .map((point) => point.v)
        .filter((value): value is number => value !== null);
      const mid = median(values);
      return { band, points, mid, quality: getSignalQuality(mid, RSRP_THRESHOLDS) };
    })
    .filter((entry) => entry.mid !== null)
    // Weakest band first: the band that needs aiming is the one to read first.
    .sort((a, b) => (a.mid ?? 0) - (b.mid ?? 0));

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>
          {t("history.band_signal.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.band_signal.description")}
        </CardDescription>
        {bands.length > 0 ? (
          <ul className={cn(LEGEND.ITEMS, "col-start-1 pt-1")}>
            {bands.map((entry) => (
              <li key={entry.band} className={LEGEND.ITEM}>
                <span
                  className={LEGEND.LINE}
                  style={{ backgroundColor: qualityStrokeVar(entry.quality) }}
                  aria-hidden="true"
                />
                {entry.band}
                {" · "}
                {entry.mid !== null ? `${Math.round(entry.mid)} dBm` : "—"}
                {" · "}
                {t(`history.charts.quality.${QUALITY_LABEL[entry.quality]}`)}
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>

      <CardContent>
        {bands.length === 0 ? (
          <PanelEmpty icon="signal_cellular_alt" body={t("history.band_signal.empty")} />
        ) : (
          <div className={CHART.GRID}>
            {bands.map((entry) => (
              <div key={entry.band} className={CHART.ROOT}>
                <h3 className={CHART.TITLE}>
                  {entry.band}
                  <span className={CHART.UNIT}>
                    {t("history.charts.metric.rsrp")}
                  </span>
                </h3>
                <TrendChart
                  points={entry.points}
                  label={entry.band}
                  unit="dBm"
                  color={qualityStrokeVar(entry.quality)}
                  domain={yDomain("rsrp", entry.points)}
                  window={window}
                  longSpan={longSpan}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default BandSignalCard;
