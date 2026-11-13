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
import type { NrOutage, ServingRun } from "@/types/cell-history";

import {
  formatMoment,
  formatSpan,
  outageRows,
  totalOutageSeconds,
} from "./derive";
import { PanelEmpty } from "./empty-state";
import { CARD_DESC, CARD_SHELL, CARD_TITLE, HERO, TABLE } from "./shapes";

// =============================================================================
// OutagesCard — every stretch 5G was down, with the cell that was serving
// =============================================================================
// The table the availability strip summarises: one row per contiguous
// `nr_avail === 0` span, newest first, each carrying the identity that was
// serving when the span began.
//
// THE SERVING CELL IS READ OFF THE RUNS, NOT GUESSED. A serving run is cut at
// every band/PCI change and at the same three-minute gap threshold the outage
// spans are cut at, so "the run containing this instant" is what the modem
// reported. When no run covers it the row says so rather than printing the
// nearest cell and implying a fact about a minute nobody recorded.
//
// DURATION AND SAMPLES ARE DIFFERENT FACTS AND SIT SIDE BY SIDE. A 40-minute span
// holding 3 samples is a mostly-unrecorded outage, not a 3-minute one, and the
// two columns are what make that visible.
// =============================================================================

export interface OutagesCardProps {
  outages: NrOutage[];
  runs: ServingRun[];
}

export function OutagesCard({ outages, runs }: OutagesCardProps) {
  const { t } = useTranslation("cellular");
  const rows = outageRows(outages, runs);

  const serving = (row: (typeof rows)[number]) => {
    if (row.uncovered) return t("history.outages.unknown_serving");
    const pci =
      row.ltePci === null
        ? t("history.outages.no_cell")
        : `${t("history.outages.cell")} ${row.ltePci}`;
    const band = row.lteBand ?? t("history.outages.band_unknown");
    const nr = row.nrBand ?? t("history.outages.no_nr");
    return `${pci} · ${band} · ${nr}`;
  };

  return (
    <Card className={CARD_SHELL}>
      <CardHeader className="gap-1.5">
        <CardTitle className={CARD_TITLE}>{t("history.outages.title")}</CardTitle>
        <CardDescription className={CARD_DESC}>
          {t("history.outages.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <PanelEmpty icon="check_circle" body={t("history.outages.empty")} />
        ) : (
          <>
            <p className={HERO.SUB}>
              <span>
                {t("history.availability.downtime", {
                  duration: formatSpan(totalOutageSeconds(outages)),
                })}
              </span>
              <span>
                {t("history.availability.outage_count", { count: rows.length })}
              </span>
            </p>
            <table className={TABLE.ROOT}>
              <thead>
                <tr>
                  <th scope="col" className={cn(TABLE.CELL_FIRST, TABLE.HEAD)}>
                    {t("history.outages.col_start")}
                  </th>
                  <th
                    scope="col"
                    className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}
                  >
                    {t("history.outages.col_duration")}
                  </th>
                  <th
                    scope="col"
                    className={cn(TABLE.CELL, TABLE.HEAD, TABLE.FIGURE)}
                  >
                    {t("history.outages.col_samples")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={TABLE.ROW}>
                    <td className={TABLE.CELL_FIRST}>
                      <span className="flex flex-col gap-0.5">
                        <span className="tabular-nums">
                          {formatMoment(row.startTs)}
                        </span>
                        <span className={cn(TABLE.QUIET, "text-xs")}>
                          {serving(row)}
                        </span>
                      </span>
                    </td>
                    <td
                      className={cn(TABLE.CELL, TABLE.FIGURE)}
                      // The span's own end, so a row is checkable against the
                      // record without opening the tooltip.
                      title={`${formatMoment(row.startTs)} – ${formatMoment(row.endTs)}`}
                    >
                      {formatSpan(row.seconds)}
                    </td>
                    <td className={cn(TABLE.CELL, TABLE.FIGURE)}>{row.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default OutagesCard;
