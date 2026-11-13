"use client";

import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { BandCombo, BandRun } from "@/types/cell-history";

import {
  formatMoment,
  formatPct,
  formatSpan,
  hourTicks,
  windowSeconds,
  type CellHistoryWindow,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import {
  BANDS,
  CARD_DESC,
  CARD_SHELL,
  CARD_TITLE,
  comboTone,
  STRIP,
  TABLE,
} from "./shapes";

// =============================================================================
// BandsCard — which bands served, and every combination that appeared
// =============================================================================
// The answer to the second half of the field complaint. The serving-cell card
// shows the CELL; this shows the BAND SET, and the two differ on purpose: the NR
// leg can come and go without the PCI moving at all, and that is exactly the
// transition a reader chasing "5G disappeared, sometimes band 1" is looking for.
//
//  * A SEGMENT BOUNDARY IS A SET CHANGE. `bandRuns()` cuts wherever the
//    `+`-joined set changes or the record has a gap, so one segment is one
//    uninterrupted set, positioned by its start and end as a fraction of the
//    window.
//  * COLOUR IS A PAIRING AID, NOT THE DATUM. A combination's tone is a stable
//    hash of the STRING (`comboTone`), so `B1+N41` looks the same on every
//    render, range and reload. The combination is printed inside every segment
//    wide enough to hold it and in the table below with its own swatch — the
//    shade only makes two adjacent sets look like two things before a label is
//    read.
//  * NO EMPTY AXIS. A window that holds no band at all says so; an empty track
//    would read as "one combination, the whole range".
//  * NO BANDWIDTH OR CARRIER-COUNT COLUMN. A row records the SERVING cell's
//    LTE bandwidth (`lte_bw`) and nothing about aggregated carriers, so a "CA
//    carriers" or "total bandwidth" column here would be a figure the record
//    cannot back. What it can back — how long each set held, and how much of the
//    range it held for — is what the table prints.
// =============================================================================

/** Below this width a segment's label would be clipped mid-set, so it is hover only. */
const LABEL_MIN_PCT = 12;
/** A one-minute run on a day's range must still be a visible mark. */
const MIN_SEGMENT_PCT = 0.5;

const DASH = "—";

interface BandSegment {
  key: string;
  run: BandRun;
  leftPct: number;
  widthPct: number;
}

/** Runs as percentages of the window, clamped to it and floored at a visible width. */
function bandSegments(runs: BandRun[], window: CellHistoryWindow): BandSegment[] {
  const span = windowSeconds(window);
  if (span <= 0) return [];

  const segments: BandSegment[] = [];
  for (const run of runs) {
    const start = Math.max(run.start_ts, window.start);
    const end = Math.min(run.end_ts, window.end);
    if (end <= start) continue;
    const leftPct = Math.min(
      ((start - window.start) / span) * 100,
      100 - MIN_SEGMENT_PCT,
    );
    const widthPct = Math.min(
      Math.max(((end - start) / span) * 100, MIN_SEGMENT_PCT),
      100 - leftPct,
    );
    segments.push({
      key: `${run.start_ts}-${run.bands ?? "-"}`,
      run,
      leftPct,
      widthPct,
    });
  }
  return segments;
}

export interface BandsCardProps {
  /** Band-set runs, oldest first. */
  runs: BandRun[];
  /** Per-combination rollup, most samples first. */
  combos: BandCombo[];
  window: CellHistoryWindow;
}

export function BandsCard({ runs, combos, window }: BandsCardProps) {
  const { t } = useTranslation("cellular");
  const segments = bandSegments(runs, window);
  const ticks = hourTicks(window);

  const comboText = (bands: string | null) =>
    bands ?? t("history.bands.unknown");

  const runDetail = (run: BandRun): string =>
    t("history.bands.run_tip", {
      bands: comboText(run.bands),
      duration: formatSpan(Math.max(0, run.end_ts - run.start_ts)),
    });

  const total = combos.reduce((sum, combo) => sum + combo.samples, 0);

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.bands.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.bands.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {runs.length === 0 ? (
          <PanelEmpty icon="layers" body={t("history.bands.empty")} />
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <div
                className={BANDS.TRACK}
                role="img"
                aria-label={t("history.bands.strip_aria")}
              >
                {segments.map((segment) => {
                  const tone = comboTone(segment.run.bands);
                  const wide = segment.widthPct >= LABEL_MIN_PCT;
                  return (
                    <span
                      key={segment.key}
                      className={cn(BANDS.SEGMENT, tone.fill, tone.ink)}
                      // A 2px gutter cut out of the fill, not drawn as a border
                      // (The No-Hairline-On-Fill Rule), so a set change is
                      // visible even when both sets hash to the same tone.
                      style={{
                        left: `${segment.leftPct}%`,
                        width: `max(2px, calc(${segment.widthPct}% - 2px))`,
                      }}
                      title={runDetail(segment.run)}
                    >
                      {wide ? (
                        <span className={BANDS.SEGMENT_LABEL}>
                          {comboText(segment.run.bands)}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
              {ticks.length > 0 ? (
                <div className={STRIP.TICKS} aria-hidden="true">
                  {ticks.map((tick) => (
                    <span
                      key={tick.ts}
                      className={STRIP.TICK}
                      style={{ left: `${tick.leftPct}%` }}
                    >
                      {formatMoment(tick.ts)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {combos.length > 0 ? (
              <div className="flex flex-col gap-2">
                <table className={TABLE.ROOT}>
                  <thead>
                    <tr>
                      <th scope="col" className={cn(TABLE.CELL_FIRST, TABLE.HEAD)}>
                        {t("history.bands.col_combo")}
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}
                      >
                        {t("history.bands.col_share")}
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}
                      >
                        {t("history.bands.col_samples")}
                      </th>
                      <th
                        scope="col"
                        className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}
                      >
                        {t("history.bands.col_last")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {combos.map((combo) => (
                      <tr
                        key={`${combo.bands ?? "-"}-${combo.first_ts}`}
                        className={TABLE.ROW}
                      >
                        <td className={TABLE.CELL_FIRST}>
                          <span className={BANDS.COMBO}>
                            <span
                              className={cn(BANDS.SWATCH, comboTone(combo.bands).fill)}
                              aria-hidden="true"
                            />
                            {comboText(combo.bands)}
                          </span>
                        </td>
                        <td className={cn(TABLE.CELL, TABLE.FIGURE)}>
                          {/* A share of zero samples is not a share: the window
                              held none, so there is no denominator to divide. */}
                          {total > 0
                            ? formatPct((combo.samples / total) * 100)
                            : DASH}
                        </td>
                        <td className={cn(TABLE.CELL, TABLE.FIGURE)}>
                          {combo.samples}
                        </td>
                        <td className={cn(TABLE.CELL, TABLE.FIGURE, TABLE.QUIET)}>
                          {formatMoment(combo.last_ts)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className={TABLE.PROSE}>{t("history.bands.foot")}</p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default BandsCard;
