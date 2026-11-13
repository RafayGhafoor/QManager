"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type {
  AvailabilityBucket,
  CellHistoryRange,
  NrOutage,
} from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  availabilitySummary,
  availabilityTier,
  formatClock,
  formatMoment,
  formatPct,
  formatSpan,
  totalOutageSeconds,
  type CellHistoryWindow,
} from "./derive";
import { CARD_DESC, CARD_SHELL, CARD_TITLE, HERO, OUTAGES, TIER, VERDICT } from "./shapes";

// =============================================================================
// AvailabilityCard — the page's answer, and its one hero
// =============================================================================
// "Was 5G up, and when was it not" in one sentence and one strip. Three things
// here are contractual:
//
//  * NO MEANINGLESS 0 %. If no bucket in the range holds a determined sample
//    there is no percentage to print — a 0 % would read as "5G was down the whole
//    time", which is the opposite of "nobody recorded anything". That case states
//    itself and draws no strip.
//  * A BUCKET WITH `n: 0` IS EMPTY, NOT DOWN. It renders as the recessed track
//    with nothing on it. That is the three-valued rule (`nr_avail: null`) the
//    whole feature exists to honour.
//  * QUALITY IS NEVER HUE-ONLY. The three fills differ in lightness, and each
//    also owns a bar height inside the track; the legend draws those same
//    heights, and every bucket has a readout in words on hover. A reader in
//    greyscale or sunlight still gets the shape of the range before reading a
//    single label.
//
// The strip is `role="img"` with one accessible name: 96 individually announced
// cells would be a worse experience than the sentence above them, which is where
// the figure actually is.
// =============================================================================

export interface AvailabilityCardProps {
  buckets: AvailabilityBucket[];
  outages: NrOutage[];
  window: CellHistoryWindow;
  range: CellHistoryRange;
}

const ORDER = ["up", "partial", "down", "unknown"] as const;

export function AvailabilityCard({
  buckets,
  outages,
  window,
  range,
}: AvailabilityCardProps) {
  const { t } = useTranslation("cellular");
  const [hover, setHover] = useState<number | null>(null);

  const summary = availabilitySummary(buckets);
  const unknown = summary.pct === null;
  const downSeconds = totalOutageSeconds(outages);
  const longSpan = range !== "1h" && range !== "3h";
  const moment = (ts: number) => (longSpan ? formatMoment(ts) : formatClock(ts));

  // The verdict is the worst tier present, so the chip and the strip tell the
  // same story: any known-absent sample is at least "partial".
  const verdict = unknown
    ? "unknown"
    : summary.up === summary.known
      ? "up"
      : summary.up === 0
        ? "down"
        : "partial";
  const chip = VERDICT[verdict];

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    if (buckets.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(
      ((event.clientX - box.left) / box.width) * buckets.length,
    );
    setHover(Math.max(0, Math.min(buckets.length - 1, index)));
  };

  const hovered = hover === null ? null : (buckets[hover] ?? null);

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>
          {t("history.availability.title")}
        </CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.availability.description")}
        </CardDescription>
        <div className="col-start-1 flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <p className={HERO.HEADLINE}>
            {unknown
              ? t("history.availability.headline_unknown")
              : t("history.availability.headline", {
                  pct: formatPct(summary.pct ?? 0),
                })}
          </p>
          <Badge variant={chip.variant} className="gap-1">
            <MaterialSymbol name={chip.glyph} size={12} />
            {t(chip.labelKey)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {unknown ? (
          <p className={HERO.SUB}>{t("history.availability.awaiting")}</p>
        ) : (
          <>
            <div className={HERO.SUB}>
              <span>
                {t("history.availability.coverage", {
                  known: String(summary.known),
                  samples: String(window.samples),
                })}
              </span>
              {outages.length > 0 ? (
                <span>
                  {t("history.availability.downtime", {
                    duration: formatSpan(downSeconds),
                  })}
                </span>
              ) : (
                <span>{t("history.availability.no_outage")}</span>
              )}
            </div>

            <div className={HERO.STRIP.ROOT}>
              <p className={HERO.STRIP.READOUT}>
                {hovered === null
                  ? ""
                  : hovered.n > 0
                    ? t("history.availability.bucket", {
                        time: moment(hovered.ts),
                        up: String(hovered.up),
                        known: String(hovered.n),
                      })
                    : t("history.availability.bucket_unknown", {
                        time: moment(hovered.ts),
                      })}
              </p>
              <div
                className={cn(
                  HERO.STRIP.TRACK,
                  buckets.length > 180 && HERO.STRIP.TRACK_DENSE,
                )}
                role="img"
                aria-label={t("history.availability.strip_aria")}
                onPointerMove={pick}
                onPointerDown={pick}
                onPointerLeave={() => setHover(null)}
              >
                {buckets.map((bucket) => {
                  const tier = TIER[availabilityTier(bucket)];
                  return (
                    <span
                      key={bucket.ts}
                      className={cn(HERO.STRIP.CELL, tier.fill, tier.height)}
                    />
                  );
                })}
              </div>
              <ul className={HERO.STRIP.LEGEND}>
                {ORDER.map((tier) => (
                  <li key={tier} className={HERO.STRIP.LEGEND_ITEM}>
                    <span className={HERO.STRIP.LEGEND_TRACK} aria-hidden="true">
                      <span
                        className={cn(
                          HERO.STRIP.LEGEND_SWATCH,
                          TIER[tier].fill,
                          TIER[tier].height,
                        )}
                      />
                    </span>
                    {t(TIER[tier].labelKey)}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {outages.length > 0 ? (
          <ul className={OUTAGES.LIST}>
            {outages
              .slice()
              .reverse()
              .slice(0, 4)
              .map((outage) => (
                <li key={outage.start_ts} className={OUTAGES.ROW}>
                  <span className={OUTAGES.WHEN}>
                    <MaterialSymbol name="error" size={14} />
                    {`${moment(outage.start_ts)} – ${moment(outage.end_ts)}`}
                  </span>
                  <span className={OUTAGES.DURATION}>
                    {formatSpan(outage.end_ts - outage.start_ts)}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default AvailabilityCard;
