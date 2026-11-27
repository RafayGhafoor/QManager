// =============================================================================
// chart-data.ts — the one place series become chart rows
// =============================================================================
// Every time-series chart on this page is a recharts chart over ONE array of
// rows, each row carrying the bucket's timestamp and one field per series.
// Building that array in one module is what keeps the five chart cards from
// disagreeing about three rules:
//
//  * A GAP IS A GAP. A series point whose `v` is `null` stays `null` (the line
//    breaks there). A hole in the bucket grid itself - no row at all for a
//    stretch longer than the gap threshold - gets a synthetic all-null row, so
//    a recorder that stopped for an hour does not draw a straight line across
//    it just because the two surrounding buckets both had readings.
//  * A RESTART IS A TIME, NOT A DATUM. Restarts are drawn as reference lines at
//    their boot timestamp; they never become rows, so they cannot shift an axis.
//  * NOTHING IS COERCED. `scale` multiplies a number; it never turns `null`
//    into `0`.
//
// No React in this file.
// =============================================================================

import {
  GAP_THRESHOLD_SECONDS,
  type CellHistoryPoint,
  type RestartEntry,
} from "@/types/cell-history";

/**
 * One plotted row. `ts` is the archive's epoch seconds (what the tooltip
 * formats), `ms` the same instant in milliseconds (what a time axis measures).
 * Every other field is one series, `null` where it had no reading.
 */
export type ChartRow = { ts: number; ms: number } & Record<string, number | null>;

export interface SeriesInput {
  /** Row field name. Letters, digits and underscores only. */
  key: string;
  points: readonly CellHistoryPoint[];
  /** Wire value -> plotted unit. Defaults to 1. */
  scale?: number;
}

/**
 * What every chart on the page shares: the window it is drawn over, the bucket
 * width, how the axis labels itself, and the restarts to mark. Computed once per
 * payload by the page and spread into each card, so no chart can be handed a
 * different window than its neighbour.
 */
export interface ChartFrame {
  /** Epoch seconds. The x domain of every chart. */
  windowStart: number;
  windowEnd: number;
  bucketSec: number | null;
  longSpan: boolean;
  restarts: RestartEntry[];
}

/**
 * The widest silence between two buckets that is still "the same line".
 *
 * `GAP_THRESHOLD_SECONDS` (3 min) is the 60 s archive's tolerance, but a 30-day
 * range is bucketed every two hours: two consecutive buckets are legitimately
 * 7200 s apart, so the threshold must scale with the bucket or every point on a
 * long range would be an island.
 */
export function gapThreshold(bucketSec: number | null): number {
  return Math.max(GAP_THRESHOLD_SECONDS, (bucketSec ?? 0) * 1.5);
}

function scaled(value: number | null, scale: number): number | null {
  return value === null ? null : Math.round(value * scale * 100) / 100;
}

/**
 * Series -> rows, oldest first, with a null row cut into every long silence.
 *
 * Rows are the UNION of the series' timestamps. The backend buckets every
 * series of one response on the same grid, so in practice each row carries
 * every series; the union is what keeps this correct if one ever lags.
 */
export function buildRows(
  inputs: readonly SeriesInput[],
  bucketSec: number | null,
): ChartRow[] {
  const byTs = new Map<number, ChartRow>();
  const empty = (ts: number): ChartRow => {
    const row = { ts, ms: ts * 1000 } as ChartRow;
    for (const input of inputs) row[input.key] = null;
    return row;
  };

  for (const input of inputs) {
    const scale = input.scale ?? 1;
    for (const point of input.points) {
      let row = byTs.get(point.ts);
      if (!row) {
        row = empty(point.ts);
        byTs.set(point.ts, row);
      }
      row[input.key] = scaled(point.v, scale);
    }
  }

  const sorted = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  const limit = gapThreshold(bucketSec);

  const out: ChartRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const previous = sorted[i - 1];
    if (previous && row.ts - previous.ts > limit) {
      // Midpoint of the silence: strictly between the two real rows, so it can
      // never collide with a bucket and the line has somewhere to break.
      out.push(empty((previous.ts + row.ts) / 2));
    }
    out.push(row);
  }
  return out;
}

/** True when a series has at least one real reading in these rows. */
export function hasReading(rows: readonly ChartRow[], key: string): boolean {
  return rows.some((row) => row[key] !== null);
}

/** Every non-null value of the given series, for domain maths. */
export function valuesOf(
  rows: readonly ChartRow[],
  keys: readonly string[],
): (number | null)[] {
  const out: (number | null)[] = [];
  for (const row of rows) for (const key of keys) out.push(row[key]);
  return out;
}

/**
 * True when row `index` holds a reading for `key` but both neighbours do not:
 * a line cannot draw a single point, so the chart marks it with a dot instead
 * (otherwise one isolated sample would be invisible, which reads as "nothing
 * recorded" - the opposite of the truth).
 */
export function isIsolated(
  rows: readonly ChartRow[],
  index: number,
  key: string,
): boolean {
  if (rows[index]?.[key] == null) return false;
  return rows[index - 1]?.[key] == null && rows[index + 1]?.[key] == null;
}

/** Restarts that fall inside the window, as plotted marks. */
export function visibleRestarts(
  restarts: readonly RestartEntry[],
  startSec: number,
  endSec: number,
): RestartEntry[] {
  return restarts.filter(
    (restart) => restart.boot_ts >= startSec && restart.boot_ts <= endSec,
  );
}

/**
 * The restart a hovered bucket contains, if any: the one whose boot time is
 * within one bucket of the hovered timestamp. A reference line is a hairline;
 * naming it in the tooltip is what makes it findable on a 30-day axis.
 */
export function restartAt(
  restarts: readonly RestartEntry[],
  ts: number,
  bucketSec: number | null,
): RestartEntry | null {
  const reach = Math.max(60, (bucketSec ?? 60) / 2);
  let best: RestartEntry | null = null;
  let bestDistance = Infinity;
  for (const restart of restarts) {
    const distance = Math.abs(restart.boot_ts - ts);
    if (distance <= reach && distance < bestDistance) {
      best = restart;
      bestDistance = distance;
    }
  }
  return best;
}

/** A tooltip figure, exact to the metric's own precision and never padded. */
export function formatValue(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

/** Median of the non-null values, or `null` when there are none. */
export function median(values: readonly (number | null)[]): number | null {
  const sorted = values
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
