"use client";

import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AvailabilityBucket, CellHistoryRange } from "@/types/cell-history";

import {
  availabilityTier,
  formatPct,
  patternRows,
  rangeSpanSec,
  type AvailabilityTier,
  type CellHistoryWindow,
  type PatternCell,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import { CARD_DESC, CARD_SHELL, CARD_TITLE, PATTERN, STRIP, TIER } from "./shapes";

// =============================================================================
// PatternCard — "5G disappears at night", as a matrix
// =============================================================================
// Rows are local calendar days, columns local hours 00…23, and each cell is the
// 5G-availability ratio of the buckets that fall in that hour. It is the one card
// that answers the field report without a hover: a nightly dropout is a vertical
// band of dark cells at the same columns on every row, legible from across a room
// and before any label is read.
//
// THREE DECISIONS WORTH KEEPING:
//
//  * DAYS COME FROM THE WINDOW, NOT FROM THE BUCKETS. A night whose every hour is
//    unknown still gets its row; a table that silently dropped it would show a
//    two-day pattern for a three-day range and look complete.
//  * AN EMPTY HOUR IS THE TRACK, NOT A ZERO. `n: 0` renders the recessed neutral,
//    exactly like the hero strip, and its title says `cell_unknown`. Only a
//    determined hour is graded.
//  * THE RANGE GATE IS A RANGE GATE. Under a day there is one row per day-part
//    and no pattern to see, so the card says so instead of drawing a single
//    meaningless row. A day is also this endpoint's ceiling, so the matrix is two
//    rows at most — the night hours still line up in the same columns on both.
// =============================================================================

const TIERS: readonly AvailabilityTier[] = ["up", "partial", "down", "unknown"];

/** A local hour as `HH:00`, the column's own label. */
function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export interface PatternCardProps {
  buckets: AvailabilityBucket[];
  window: CellHistoryWindow;
  range: CellHistoryRange;
}

export function PatternCard({ buckets, window, range }: PatternCardProps) {
  const { t } = useTranslation("cellular");
  const rows = patternRows(buckets, window);
  const enoughRange = rangeSpanSec(range) >= rangeSpanSec("24h");

  const cellTitle = (rowLabel: string, cell: PatternCell) => {
    const hour = hourLabel(cell.hour);
    if (cell.n <= 0) {
      return t("history.pattern.cell_unknown", { day: rowLabel, hour });
    }
    return t("history.pattern.cell", {
      day: rowLabel,
      hour,
      pct: formatPct((cell.up / cell.n) * 100),
      known: cell.n,
    });
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.pattern.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.pattern.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!enoughRange ? (
          <PanelEmpty icon="schedule" body={t("history.pattern.needs_day")} />
        ) : (
          <>
            <div
              className={PATTERN.SCROLL}
              role="img"
              aria-label={t("history.pattern.strip_aria")}
            >
              <div
                className={PATTERN.GRID}
                style={{ gridTemplateColumns: "3.25rem repeat(24, minmax(0, 1fr))" }}
              >
                <span className={PATTERN.AXIS}>
                  {t("history.pattern.day_axis")}
                </span>
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={`h-${hour}`} className={PATTERN.HOUR_LABEL}>
                    {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
                  </span>
                ))}
                {rows.map((row) => (
                  <Fragment key={row.key}>
                    <span className={PATTERN.ROW_LABEL}>{row.label}</span>
                    {row.cells.map((cell) => {
                      const tier = availabilityTier(cell);
                      return (
                        <span
                          key={cell.key}
                          className={
                            tier === "unknown"
                              ? PATTERN.CELL_UNKNOWN
                              : cn(PATTERN.CELL, TIER[tier].fill)
                          }
                          title={cellTitle(row.label, cell)}
                        />
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>

            <ul className={STRIP.LEGEND}>
              <li className="font-medium">{t("history.pattern.pct_axis")}</li>
              {TIERS.map((tier) => (
                <li key={tier} className={STRIP.LEGEND_ITEM}>
                  <span className={STRIP.LEGEND_TRACK} aria-hidden="true">
                    <span
                      className={cn(
                        STRIP.LEGEND_SWATCH,
                        TIER[tier].fill,
                        TIER[tier].height,
                      )}
                    />
                  </span>
                  {t(TIER[tier].labelKey)}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default PatternCard;
