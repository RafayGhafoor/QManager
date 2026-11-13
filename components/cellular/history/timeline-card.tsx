"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import type { CellStat, ServingRun } from "@/types/cell-history";

import {
  bandVariant,
  formatClock,
  formatMoment,
  formatPct,
  formatSpan,
  hourTicks,
  runBand,
  timelineSegments,
  type CellHistoryWindow,
  type TimelineSegment,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import {
  BAND_TONE,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  RUN_TONE,
  runTier,
  TABLE,
  TIMELINE,
} from "./shapes";

// =============================================================================
// TimelineCard — which cell and band served, over time
// =============================================================================
// A gantt of the serving runs: one contiguous run of a single serving cell is one
// segment, positioned by its start and end as a fraction of the window. TWO
// LANES, because a run carries both radio legs and dropping one answers half the
// question:
//
//   LTE   the band the device camped on — always present, and the thing that
//         actually changes when the field complaint ("sometimes band 1") does.
//   5G    the NR band, where the modem reported one. An empty 5G lane is the
//         statement "no NR leg in this range" and it is drawn as such rather than
//         as a silent void.
//
// COLOUR IS A PAIRING AID, NOT THE DATUM. A band's tone is a stable function of
// the band string (`bandVariant`), so two runs of the same band look the same and
// a change looks like a change. The band itself is printed inside every segment
// wide enough to hold it, and in the tooltip of every segment that is not —
// identity hues are deliberately clustered in lightness and cannot carry a
// category on their own.
//
// THE TABLE IS THE FACT THE STRIP CANNOT STATE: time on each cell against 5G
// availability on it. A segment says when; only the table says "this cell held 5G
// a fifth of the time it served", which is the question a raw change log cannot
// answer.
// =============================================================================

export interface TimelineCardProps {
  runs: ServingRun[];
  stats: CellStat[];
  window: CellHistoryWindow;
  /** True past a few hours, where a bare `HH:MM` in a tooltip loses the date. */
  longSpan: boolean;
}

/** Below this width a segment's label would be clipped mid-band, so it is hover only. */
const LABEL_MIN_PCT = 12;
const DASH = "—";

interface LaneSegment {
  segment: TimelineSegment;
  band: string | null;
  fill: string;
  ink: string;
}

function BandTag({ band }: { band: string | null }) {
  if (band === null) return null;
  const variant = band.startsWith("N") ? "nr" : band.startsWith("B") ? "lte" : "neutral";
  return (
    <Tag variant={variant} className="font-mono">
      {band}
    </Tag>
  );
}

export function TimelineCard({ runs, stats, window, longSpan }: TimelineCardProps) {
  const { t } = useTranslation("cellular");
  const segments = timelineSegments(runs, window);
  const ticks = hourTicks(window);

  const moment = (ts: number) => (longSpan ? formatMoment(ts) : formatClock(ts));

  const lane = (leg: "lte" | "nr"): LaneSegment[] => {
    const out: LaneSegment[] = [];
    for (const segment of segments) {
      const band = runBand(segment.run, leg);
      // The NR lane has nothing to draw where the modem reported no NR band; the
      // LTE lane keeps its run with the neutral "not reported" tone, because the
      // run itself is a fact about the LTE leg either way.
      if (leg === "nr" && band === null) continue;
      const tone = band === null ? BAND_TONE.unknown : BAND_TONE[leg][bandVariant(band)];
      out.push({ segment, band, fill: tone.fill, ink: tone.ink });
    }
    return out;
  };

  const runDetail = (entry: LaneSegment) => {
    const { run } = entry.segment;
    return t("history.timeline.run_tip", {
      cell: run.lte_pci === null ? t("history.timeline.no_cell") : String(run.lte_pci),
      band: entry.band ?? t("history.timeline.band_not_reported"),
      nr: run.nr_band ?? t("history.timeline.band_not_reported"),
      from: moment(run.start_ts),
      to: moment(run.end_ts),
      pct:
        run.nr_avail_pct === null
          ? t("history.timeline.unknown")
          : formatPct(run.nr_avail_pct),
    });
  };

  const renderLane = (leg: "lte" | "nr") => {
    const entries = lane(leg);
    return (
      <div className={TIMELINE.LANE}>
        <span className={TIMELINE.LANE_LABEL}>
          {t(leg === "lte" ? "history.timeline.lte_row" : "history.timeline.nr_row")}
        </span>
        <div className={TIMELINE.TRACK}>
          {entries.length === 0 ? (
            <span className="text-on-surface-variant absolute inset-0 grid place-items-center text-[0.6875rem]">
              {t("history.timeline.band_not_reported")}
            </span>
          ) : null}
          {entries.map((entry) => {
            const { segment } = entry;
            const wide = segment.widthPct >= LABEL_MIN_PCT;
            return (
              <span
                key={`${leg}-${segment.key}`}
                className={cn(TIMELINE.SEGMENT, entry.fill, entry.ink)}
                // A real gutter between segments, cut out of the fill rather than
                // drawn as a border (The No-Hairline-On-Fill Rule), so a band
                // change is visible even when both bands wear the same tone.
                // `max()` keeps a one-minute run from rounding away to nothing.
                style={{
                  left: `${segment.leftPct}%`,
                  width: `max(2px, calc(${segment.widthPct}% - 2px))`,
                }}
                title={runDetail(entry)}
              >
                {wide ? (
                  <span className={TIMELINE.SEGMENT_LABEL}>
                    {entry.band ?? t("history.timeline.band_not_reported")}
                  </span>
                ) : null}
                {leg === "lte" ? (
                  <span
                    className={cn(
                      TIMELINE.RUN_RULE,
                      RUN_TONE[runTier(segment.run.nr_avail_pct)],
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.timeline.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.timeline.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {runs.length === 0 ? (
          <PanelEmpty icon="timeline" body={t("history.timeline.empty")} />
        ) : (
          <div>
            <div className={TIMELINE.LANES}>{renderLane("lte")}</div>
            <div className={cn(TIMELINE.LANES, "mt-2")}>{renderLane("nr")}</div>
            {ticks.length > 0 ? (
              <div className="ps-11">
                <div className={TIMELINE.TICKS} aria-hidden="true">
                  {ticks.map((tick) => (
                    <span
                      key={tick.ts}
                      className={TIMELINE.TICK}
                      style={{ left: `${tick.leftPct}%` }}
                    >
                      {moment(tick.ts)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {stats.length > 0 ? (
          <table className={TABLE.ROOT}>
            <thead>
              <tr>
                <th scope="col" className={cn(TABLE.CELL_FIRST, TABLE.HEAD)}>
                  {t("history.timeline.col_cell")}
                </th>
                <th scope="col" className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}>
                  {t("history.timeline.col_readings")}
                </th>
                <th scope="col" className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}>
                  {t("history.timeline.col_5g")}
                </th>
                <th scope="col" className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}>
                  {t("history.timeline.col_rsrp")}
                </th>
                <th scope="col" className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}>
                  {t("history.timeline.col_served")}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.map((stat) => {
                const pct =
                  stat.nr_known > 0
                    ? ((stat.nr_known - stat.nr_down) / stat.nr_known) * 100
                    : null;
                return (
                  <tr key={stat.key} className={TABLE.ROW}>
                    <td className={TABLE.CELL_FIRST}>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">
                          {stat.lte_pci === null
                            ? t("history.timeline.no_cell")
                            : stat.lte_pci}
                        </span>
                        <BandTag band={stat.lte_band} />
                      </span>
                    </td>
                    <td className={cn(TABLE.CELL, TABLE.FIGURE)}>{stat.samples}</td>
                    <td className={cn(TABLE.CELL, TABLE.FIGURE)}>
                      {pct === null ? (
                        <span className={TABLE.QUIET}>
                          {t("history.timeline.unknown")}
                        </span>
                      ) : (
                        formatPct(pct)
                      )}
                    </td>
                    <td className={cn(TABLE.CELL, TABLE.FIGURE)}>
                      {stat.rsrp === null ? (
                        <span className={TABLE.QUIET}>{DASH}</span>
                      ) : (
                        `${Math.round(stat.rsrp)} dBm`
                      )}
                    </td>
                    <td className={cn(TABLE.CELL, TABLE.FIGURE, TABLE.QUIET)}>
                      {formatSpan(stat.last_ts - stat.first_ts)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {runs.length > 0 ? (
          <ul className={TIMELINE.LEGEND}>
            <li className="font-medium">{t("history.timeline.legend_rule")}</li>
            {(["up", "partial", "down", "unknown"] as const).map((tier) => (
              <li key={tier} className={TIMELINE.LEGEND_ITEM}>
                <span
                  className={cn(TIMELINE.LEGEND_SWATCH, RUN_TONE[tier])}
                  aria-hidden="true"
                />
                {t(`history.timeline.legend_${tier}`)}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default TimelineCard;
