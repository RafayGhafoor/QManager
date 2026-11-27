"use client";

import { useTranslation } from "react-i18next";

import { ChartTooltipTime } from "@/components/ui/chart-tooltip-time";
import type { RestartEntry } from "@/types/cell-history";

import { formatValue, restartAt, type ChartRow } from "./chart-data";
import type { PlotSeries } from "./history-chart";
import { gradeColor } from "./quality-grade";

// =============================================================================
// HistoryTooltip — ChartTooltipTime, fed per-series units and extra rows
// =============================================================================
// `ChartTooltipTime` is the prescribed tooltip for time series here: it reads
// the timestamp out of the hovered datum (the shared label formatter receives
// the series NAME on a numeric axis and printed "Invalid Date"). It takes ONE
// unit for every row, though, and these charts mix units (a share in %, a
// throughput in Mbit/s). So this wrapper formats each row's value with its own
// series' unit and precision BEFORE handing the payload on, and appends two
// kinds of note rows the primitive does not know about:
//
//   * the restart that falls inside the hovered bucket, named by cause;
//   * whatever the owning card wants said about that bucket (the congestion
//     card says "link not saturated" here).
//
// A series with no reading at the hovered bucket stays `null`, which the
// primitive prints as a dash - never a zero.
// =============================================================================

interface TooltipDatum {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface TooltipNote {
  label: string;
  value: string;
  color?: string;
}

export interface HistoryTooltipProps {
  active?: boolean;
  payload?: readonly TooltipDatum[];
  series: readonly PlotSeries[];
  restarts: readonly RestartEntry[];
  bucketSec: number | null;
  notes?: (row: ChartRow) => TooltipNote[];
}

/** `%` and `°C` hug the figure; every other unit takes a space. */
function withUnit(value: string, unit: string | null): string {
  if (!unit) return value;
  return unit === "%" || unit === "°C" ? `${value}${unit}` : `${value} ${unit}`;
}

export function HistoryTooltip({
  active,
  payload,
  series,
  restarts,
  bucketSec,
  notes,
}: HistoryTooltipProps) {
  const { t } = useTranslation("cellular");

  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0].payload as ChartRow | undefined;
  const byKey = new Map(series.map((item) => [item.key, item]));

  const rows: TooltipDatum[] = [];
  for (const item of payload) {
    const def = byKey.get(String(item.dataKey));
    if (!def) continue;
    if (row && def.tooltipWhen && !def.tooltipWhen(row)) continue;
    const value = item.value;
    rows.push({
      dataKey: def.key,
      name: def.label,
      // A graded series' swatch is the reading's own quality colour.
      color:
        def.grade && typeof value === "number" ? gradeColor(value, def.grade) : def.color,
      value:
        typeof value === "number"
          ? withUnit(formatValue(value, def.decimals), def.unit)
          : null,
      payload: item.payload,
    });
  }

  const extra: TooltipNote[] = [];
  if (row) {
    const restart = restartAt(restarts, row.ts, bucketSec);
    if (restart) {
      extra.push({
        label: t("history.restart.label"),
        value: t(`history.restart.cause.${restart.cause}`),
        color:
          restart.cause === "power_loss"
            ? "var(--destructive)"
            : restart.cause === "restart"
              ? "var(--warning)"
              : "var(--on-surface-variant)",
      });
    }
    if (notes) extra.push(...notes(row));
  }
  for (const [index, note] of extra.entries()) {
    rows.push({
      dataKey: `__note_${index}`,
      name: note.label,
      color: note.color ?? "var(--on-surface-variant)",
      value: note.value,
      payload: row as Record<string, unknown> | undefined,
    });
  }

  return <ChartTooltipTime active payload={rows} empty="—" />;
}

export default HistoryTooltip;
