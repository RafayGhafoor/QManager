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
import type {
  CellHistoryRange,
  CellStat,
  ServingRun,
} from "@/types/cell-history";
import { cn } from "@/lib/utils";

import {
  formatClock,
  formatMoment,
  formatPct,
  type CellHistoryWindow,
} from "./derive";
import {
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  RUN_TONE,
  runTier,
  TABLE,
  TIMELINE,
} from "./shapes";

// =============================================================================
// TimelineCard — which cell served, and for how long
// =============================================================================
// Two readings of one fact. The strip is the SHAPE: a segment per serving run,
// scaled by how long the run lasted, so a night of ping-pong is visibly many
// narrow segments and a stable cell is one wide one. The table is the FACT: time
// on each cell against 5G availability on it, which is the question a raw change
// log cannot answer.
//
// A CELL IS IDENTITY, NOT HEALTH. Its segment is neutral ink on a neutral plate
// (the Two-Form Rule: identity never renders as a large tinted block); the one
// coloured thing on a segment is a 3 px rule along its bottom edge, carrying that
// run's own 5G availability. Colour is never the only channel — the segment also
// prints the run's percentage when it is wide enough, the table repeats it as a
// number, and the legend names all four states.
//
// A run too narrow for its label keeps a tick, so a ten-minute cell in a day does
// not read as a gap in the strip.
// =============================================================================

export interface TimelineCardProps {
  runs: ServingRun[];
  stats: CellStat[];
  window: CellHistoryWindow;
  range: CellHistoryRange;
}

const LEGEND: readonly { tier: keyof typeof RUN_TONE; labelKey: string }[] = [
  { tier: "up", labelKey: "history.timeline.legend_up" },
  { tier: "partial", labelKey: "history.timeline.legend_partial" },
  { tier: "down", labelKey: "history.timeline.legend_down" },
  { tier: "unknown", labelKey: "history.timeline.legend_unknown" },
];

function BandTag({ band }: { band: string | null }) {
  if (band === null) return null;
  const variant = band.startsWith("N") ? "nr" : band.startsWith("B") ? "lte" : "neutral";
  return (
    <Tag variant={variant} className="font-mono">
      {band}
    </Tag>
  );
}

export function TimelineCard({ runs, stats, window, range }: TimelineCardProps) {
  const { t } = useTranslation("cellular");
  const longSpan = range !== "1h" && range !== "3h";
  const moment = (ts: number) => (longSpan ? formatMoment(ts) : formatClock(ts));

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.timeline.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.timeline.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div>
          <div className={TIMELINE.STRIP}>
            {runs.map((run) => {
              // Width from duration, not sample count: rows are not a metronome,
              // and a run is only as long as the time between its first and last.
              const duration = Math.max(run.end_ts - run.start_ts, 60);
              const tier = runTier(run.nr_avail_pct);
              const label = run.lte_pci === null ? null : String(run.lte_pci);
              return (
                <div
                  key={`${run.start_ts}-${run.lte_pci ?? "x"}-${run.nr_band ?? "x"}`}
                  className={cn(TIMELINE.RUN, "bg-surface-container")}
                  style={{ flexGrow: duration, flexBasis: 0 }}
                  title={t("history.timeline.run_tip", {
                    cell: label ?? t("history.timeline.no_cell"),
                    band: run.lte_band ?? "—",
                    nr: run.nr_band ?? "—",
                    from: moment(run.start_ts),
                    to: moment(run.end_ts),
                    pct:
                      run.nr_avail_pct === null
                        ? t("history.timeline.unknown")
                        : formatPct(run.nr_avail_pct),
                  })}
                >
                  {label === null ? (
                    <span className={TIMELINE.RUN_TICK} aria-hidden="true" />
                  ) : (
                    <>
                      <span className={TIMELINE.RUN_LABEL}>{label}</span>
                      <span className={TIMELINE.RUN_LABEL}>
                        {run.nr_band ?? "—"}
                      </span>
                    </>
                  )}
                  <span
                    className={cn(TIMELINE.RUN_RULE, RUN_TONE[tier])}
                    aria-hidden="true"
                  />
                </div>
              );
            })}
          </div>
          <div className={TIMELINE.TICKS} aria-hidden="true">
            {[0, 0.5, 1].map((fraction) => (
              <span
                key={fraction}
                className={TIMELINE.TICK}
                style={{ left: `${fraction * 100}%` }}
              >
                {moment(window.start + (window.end - window.start) * fraction)}
              </span>
            ))}
          </div>
          <ul className={TIMELINE.LEGEND}>
            {LEGEND.map((entry) => (
              <li key={entry.tier} className={TIMELINE.LEGEND_ITEM}>
                <span
                  className={cn(TIMELINE.LEGEND_SWATCH, RUN_TONE[entry.tier])}
                  aria-hidden="true"
                />
                {t(entry.labelKey)}
              </li>
            ))}
          </ul>
        </div>

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
                      <span className={TABLE.QUIET}>—</span>
                    ) : (
                      `${Math.round(stat.rsrp)} dBm`
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default TimelineCard;
