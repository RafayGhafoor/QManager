import {
  CELL_CHANGE_FIELDS,
  GAP_THRESHOLD_SECONDS,
  type AvailabilityBucket,
  type BandCombo,
  type BandRun,
  type CellChange,
  type CellEventGroup,
  type CellHistoryPoint,
  type CellHistoryRange,
  type CellHistoryRow,
  type CellHistorySuccess,
  type CellStat,
  type NrOutage,
  type ServingRun,
} from "@/types/cell-history";

// =============================================================================
// Cell History — the derivations the page draws
// =============================================================================
// The CGI serves rows; everything a card needs a SHAPE for is built here. Four
// rules are load-bearing, and each one is a bug that shipped elsewhere first:
//
//  1. A GAP IS A GAP. The writer is not a metronome: no row lands while a scan
//     owns the AT port, while the modem is unreachable, or across a poller
//     restart. Every run and every outage span is therefore cut at
//     GAP_THRESHOLD_SECONDS, so an absence of records is never painted as an
//     absence of 5G.
//  2. A NULL IS NOT A ZERO. `nr_avail: null` means nobody determined the leg: it
//     never opens or closes an outage and never enters an availability
//     denominator. Scoring it as "down" would invent outages on every logger
//     restart.
//  3. A BUCKET WITH `n: 0` IS EMITTED, not skipped: the strip draws it as "no
//     data", which is different from a gap in the strip.
//  4. CHANGES ARE AGAINST THE LAST KNOWN VALUE, not the previous row. NR
//     identity columns go null while the NR leg is detached, so a pairwise diff
//     misses the common "5G dropped and came back on a different PCI" case.
// =============================================================================

/** Bucket width per range: 60 buckets for an hour, 96 for a day. */
export const BUCKET_SEC: Record<CellHistoryRange, number> = {
  "1h": 60,
  "3h": 180,
  "6h": 300,
  "12h": 600,
  "24h": 900,
};

const RANGE_SEC: Record<CellHistoryRange, number> = {
  "1h": 3600,
  "3h": 10800,
  "6h": 21600,
  "12h": 43200,
  "24h": 86400,
};

export function rangeSpanSec(range: CellHistoryRange) {
  return RANGE_SEC[range];
}

/** The span the payload actually covers, in seconds. Never negative. */
export function windowSeconds(window: CellHistoryWindow) {
  return Math.max(0, window.end - window.start);
}

/** The margin of the requested range that actually held rows. */
export interface CellHistoryWindow {
  /** Requested start: `end` minus the range. */
  start: number;
  /** The newest archived row, clamped to the CGI's clock. */
  end: number;
  samples: number;
  first_ts: number | null;
  last_ts: number | null;
}

/**
 * The window is the payload's, not the pill's: it ends at the newest archived
 * row so an archive that stopped updating shows its last span rather than an
 * empty chart.
 */
export function windowOf(data: CellHistorySuccess): CellHistoryWindow {
  const rows = data.rows;
  const end = data.window_end > 0 ? data.window_end : data.generated_at;
  return {
    start: end - rangeSpanSec(data.range),
    end,
    samples: rows.length,
    first_ts: rows.length > 0 ? rows[0].ts : null,
    last_ts: rows.length > 0 ? rows[rows.length - 1].ts : null,
  };
}

/** True when the window holds materially less than the range asked for. */
export function isWindowShort(
  window: CellHistoryWindow,
  range: CellHistoryRange,
) {
  if (window.samples === 0 || window.first_ts === null) return false;
  return window.end - window.first_ts < rangeSpanSec(range) * 0.75;
}

/**
 * A row carries cell identity when it names an LTE or an NR cell. Rows written
 * before identity logging existed carry neither; they are counted as samples but
 * cannot answer "on which cell".
 */
export function hasIdentity(row: CellHistoryRow) {
  return row.lte_pci !== null || row.nr_pci !== null || row.nr_band !== null;
}

/** The first sample in the window that carried identity, or null when none did. */
export function coverageStart(rows: CellHistoryRow[]): number | null {
  for (const row of rows) {
    if (hasIdentity(row)) return row.ts;
  }
  return null;
}

/** Rows are appended oldest-first by the poller; never trust that on the wire. */
function chronological(rows: CellHistoryRow[]) {
  return [...rows].sort((a, b) => a.ts - b.ts);
}

/**
 * Availability as a contiguous strip: one bucket per slot across the window,
 * `n: 0` where no sample determined the leg.
 */
export function availabilityBuckets(
  rows: CellHistoryRow[],
  window: CellHistoryWindow,
  bucketSec: number,
): AvailabilityBucket[] {
  if (bucketSec <= 0 || window.end <= window.start) return [];
  const first = Math.floor(window.start / bucketSec) * bucketSec;
  const buckets: AvailabilityBucket[] = [];
  for (let ts = first; ts <= window.end; ts += bucketSec) {
    buckets.push({ ts, n: 0, up: 0 });
  }
  for (const row of rows) {
    if (row.nr_avail === null) continue;
    const index = Math.floor((row.ts - first) / bucketSec);
    if (index < 0 || index >= buckets.length) continue;
    buckets[index].n += 1;
    if (row.nr_avail === 1) buckets[index].up += 1;
  }
  return buckets;
}

export interface AvailabilitySummary {
  /** Samples across the window where availability was determined. */
  known: number;
  up: number;
  /** Percentage with the NR leg, or null when nothing was determined. */
  pct: number | null;
}

export function availabilitySummary(
  buckets: AvailabilityBucket[],
): AvailabilitySummary {
  let known = 0;
  let up = 0;
  for (const bucket of buckets) {
    known += bucket.n;
    up += bucket.up;
  }
  return { known, up, pct: known > 0 ? (up / known) * 100 : null };
}

/** True when the window holds no determined sample at all — no percentage exists. */
export function isAvailabilityUnknown(summary: AvailabilitySummary) {
  return summary.known === 0;
}

export type AvailabilityTier = "up" | "partial" | "down" | "unknown";

/**
 * A bucket's four-way verdict. `unknown` is its own tier, not "down": it is the
 * bucket that existed and held no determined sample.
 */
export function availabilityTier(bucket: {
  n: number;
  up: number;
}): AvailabilityTier {
  if (bucket.n === 0) return "unknown";
  if (bucket.up === bucket.n) return "up";
  if (bucket.up === 0) return "down";
  return "partial";
}

/** Contiguous stretches of a known-absent NR leg, cut at the gap threshold. */
export function nrOutages(rows: CellHistoryRow[]): NrOutage[] {
  const outages: NrOutage[] = [];
  let current: NrOutage | null = null;
  let previousTs: number | null = null;

  for (const row of chronological(rows)) {
    const gap = previousTs !== null && row.ts - previousTs > GAP_THRESHOLD_SECONDS;
    previousTs = row.ts;
    if (gap && current !== null) {
      outages.push(current);
      current = null;
    }
    if (row.nr_avail === 0) {
      if (current === null) {
        current = { start_ts: row.ts, end_ts: row.ts, samples: 1 };
      } else {
        current.end_ts = row.ts;
        current.samples += 1;
      }
    } else if (row.nr_avail === 1 && current !== null) {
      outages.push(current);
      current = null;
    }
  }
  if (current !== null) outages.push(current);
  return outages;
}

/** Seconds covered by the spans. Sample count is not a duration: rows are 60–90 s apart. */
export function totalOutageSeconds(outages: NrOutage[]) {
  let total = 0;
  for (const outage of outages) total += outage.end_ts - outage.start_ts;
  return total;
}

function runKey(row: CellHistoryRow) {
  return [row.lte_pci, row.lte_band, row.nr_band, row.rat].join("|");
}

/**
 * Contiguous runs of one serving cell. A run ends at an identity change or at a
 * gap — never merely at the range's edge, so a cell that served the whole window
 * is one segment and not one per bucket.
 */
export function servingRuns(rows: CellHistoryRow[]): ServingRun[] {
  const runs: ServingRun[] = [];
  let current: ServingRun | null = null;
  let currentKey = "";
  let previousTs: number | null = null;
  let rsrpSum = 0;
  let rsrpCount = 0;
  let known = 0;
  let up = 0;

  const flush = () => {
    if (current === null) return;
    current.rsrp = rsrpCount > 0 ? rsrpSum / rsrpCount : null;
    current.nr_avail_pct = known > 0 ? (up / known) * 100 : null;
    runs.push(current);
    current = null;
  };

  for (const row of chronological(rows)) {
    const key = runKey(row);
    const gap = previousTs !== null && row.ts - previousTs > GAP_THRESHOLD_SECONDS;
    previousTs = row.ts;
    if (current === null || gap || key !== currentKey) {
      flush();
      current = {
        start_ts: row.ts,
        end_ts: row.ts,
        samples: 0,
        lte_pci: row.lte_pci,
        lte_band: row.lte_band,
        nr_band: row.nr_band,
        rat: row.rat,
        rsrp: null,
        nr_avail_pct: null,
      };
      currentKey = key;
      rsrpSum = 0;
      rsrpCount = 0;
      known = 0;
      up = 0;
    }
    current.end_ts = row.ts;
    current.samples += 1;
    if (row.rsrp !== null) {
      rsrpSum += row.rsrp;
      rsrpCount += 1;
    }
    if (row.nr_avail !== null) {
      known += 1;
      if (row.nr_avail === 1) up += 1;
    }
  }
  flush();
  return runs;
}

/**
 * Time on each serving cell, most samples first. The raw change list is
 * dominated by noise (a night of PCI ping-pong is dozens of rows); time-on-cell
 * against 5G availability is what answers "is this cell hurting me".
 */
export function cellStats(rows: CellHistoryRow[]): CellStat[] {
  const byCell = new Map<string, CellStat>();
  const rsrpSum = new Map<string, number>();
  const rsrpCount = new Map<string, number>();

  for (const row of chronological(rows)) {
    const key = row.lte_pci === null ? "(none)" : String(row.lte_pci);
    let stat = byCell.get(key);
    if (!stat) {
      stat = {
        key,
        lte_pci: row.lte_pci,
        lte_band: row.lte_band,
        samples: 0,
        nr_down: 0,
        nr_known: 0,
        first_ts: row.ts,
        last_ts: row.ts,
        rsrp: null,
      };
      byCell.set(key, stat);
      rsrpSum.set(key, 0);
      rsrpCount.set(key, 0);
    }
    stat.samples += 1;
    stat.last_ts = row.ts;
    if (stat.lte_band === null && row.lte_band !== null) stat.lte_band = row.lte_band;
    if (row.nr_avail !== null) {
      stat.nr_known += 1;
      if (row.nr_avail === 0) stat.nr_down += 1;
    }
    if (row.rsrp !== null) {
      rsrpSum.set(key, (rsrpSum.get(key) ?? 0) + row.rsrp);
      rsrpCount.set(key, (rsrpCount.get(key) ?? 0) + 1);
    }
  }

  const stats = [...byCell.values()];
  for (const stat of stats) {
    const count = rsrpCount.get(stat.key) ?? 0;
    stat.rsrp = count > 0 ? (rsrpSum.get(stat.key) ?? 0) / count : null;
  }
  return stats.sort((a, b) => b.samples - a.samples);
}

function fieldText(row: CellHistoryRow, field: (typeof CELL_CHANGE_FIELDS)[number]) {
  const value = row[field];
  if (value === null) return null;
  return String(value);
}

/**
 * Identity changes, newest first, one group per instant.
 *
 * Each field is compared against its LAST KNOWN value, not the previous row: the
 * NR columns go null while the leg is detached, and a pairwise diff would miss a
 * drop-and-return-on-another-PCI entirely. A null reading is not a change.
 */
export function cellEvents(rows: CellHistoryRow[]): CellEventGroup[] {
  const groups: CellEventGroup[] = [];
  const lastKnown = new Map<string, string>();

  for (const row of chronological(rows)) {
    const changes: CellChange[] = [];
    for (const field of CELL_CHANGE_FIELDS) {
      const next = fieldText(row, field);
      if (next === null) continue;
      const previous = lastKnown.get(field);
      if (previous === undefined) {
        lastKnown.set(field, next);
        continue;
      }
      if (previous !== next) {
        changes.push({ field, from: previous, to: next });
        lastKnown.set(field, next);
      }
    }
    if (changes.length > 0) groups.push({ ts: row.ts, changes });
  }
  return groups.reverse();
}

// --- Formatting --------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

/** Local clock time, HH:MM. Local because "5G dropped at 03:00" is a local fact. */
export function formatClock(ts: number) {
  const date = new Date(ts * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Clock time with the date in front, for a range that crosses midnight. */
export function formatMoment(ts: number) {
  const date = new Date(ts * 1000);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(ts)}`;
}

/** A duration in words: "3 h 5 min", "12 min", "under a minute". */
export function formatSpan(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return "under a minute";
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/** One decimal at most: a percentage that reads 99.7 is a reading, 99.66 is noise. */
export function formatPct(pct: number) {
  return `${(Math.round(pct * 10) / 10).toFixed(pct === Math.round(pct) ? 0 : 1)}%`;
}

/** A local calendar-day key. Days are the reader's days, never UTC days. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// --- The day × hour pattern ---------------------------------------------------

export interface PatternCell {
  key: string;
  /** Local hour, 0…23. */
  hour: number;
  n: number;
  up: number;
}

export interface PatternRow {
  key: string;
  /** Local calendar day, `MM-DD`. Numeric, so the prerender and the client agree. */
  label: string;
  /** Exactly 24 entries, hour 0…23. An hour with no bucket holds `n: 0`. */
  cells: PatternCell[];
}

/**
 * The day × hour matrix.
 *
 * Rows are the local calendar days the WINDOW covers, oldest first — seeded from
 * the window rather than from the buckets, so a day whose every hour was
 * recorded as unknown still gets its row (a missing row would read as "that
 * night did not happen"). Columns are local hours 00…23.
 *
 * A `24h` window is the ceiling this CGI serves and it spans two local days, so
 * the matrix is two rows at most. That is still the shape the field complaint
 * needs: the night hours line up in the same columns on both rows.
 */
export function patternRows(
  buckets: AvailabilityBucket[],
  window: CellHistoryWindow,
): PatternRow[] {
  const rows: PatternRow[] = [];
  const byKey = new Map<string, PatternRow>();

  const start = new Date(window.start * 1000);
  start.setHours(0, 0, 0, 0);
  const last = new Date(window.end * 1000);
  last.setHours(0, 0, 0, 0);

  while (start.getTime() <= last.getTime() && rows.length < 40) {
    const key = dayKey(start);
    const row: PatternRow = {
      key,
      label: `${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      cells: Array.from({ length: 24 }, (_, hour) => ({
        key: `${key}T${hour}`,
        hour,
        n: 0,
        up: 0,
      })),
    };
    rows.push(row);
    byKey.set(key, row);
    start.setDate(start.getDate() + 1);
  }

  for (const bucket of buckets) {
    const at = new Date(bucket.ts * 1000);
    const row = byKey.get(dayKey(at));
    if (!row) continue;
    const cell = row.cells[at.getHours()];
    cell.n += bucket.n;
    cell.up += bucket.up;
  }

  return rows;
}

// --- The band set -------------------------------------------------------------

/** `"B1+N41"`, `"B1"`, or `null` when neither leg was named. Never re-prefixed. */
export function bandComboOf(row: CellHistoryRow) {
  const parts: string[] = [];
  if (row.lte_band !== null && row.lte_band.trim() !== "") parts.push(row.lte_band);
  if (row.nr_band !== null && row.nr_band.trim() !== "") parts.push(row.nr_band);
  return parts.length > 0 ? parts.join("+") : null;
}

/**
 * Contiguous runs of one band set, oldest first.
 *
 * A run ends where the combo changes or at the gap threshold — the same cuts a
 * serving run makes. It is a SEPARATE shape from `servingRuns` because the PCI
 * can stay put while the NR leg comes and goes, which is precisely the
 * transition "5G disappeared, sometimes band 1" describes.
 */
export function bandRuns(rows: CellHistoryRow[]): BandRun[] {
  const runs: BandRun[] = [];
  let current: BandRun | null = null;
  let currentCombo: string | null = null;
  let previousTs: number | null = null;

  for (const row of chronological(rows)) {
    const combo = bandComboOf(row);
    const gap = previousTs !== null && row.ts - previousTs > GAP_THRESHOLD_SECONDS;
    previousTs = row.ts;
    if (current === null || gap || combo !== currentCombo) {
      if (current !== null) runs.push(current);
      current = {
        start_ts: row.ts,
        end_ts: row.ts,
        samples: 0,
        bands: combo,
      };
      currentCombo = combo;
    }
    current.end_ts = row.ts;
    current.samples += 1;
  }
  if (current !== null) runs.push(current);
  return runs;
}

/** Time share of each band set over the window, most samples first. */
export function bandCombos(runs: BandRun[]): BandCombo[] {
  const byCombo = new Map<string, BandCombo>();
  for (const run of runs) {
    const key = run.bands ?? "";
    const combo = byCombo.get(key);
    if (combo === undefined) {
      byCombo.set(key, {
        bands: run.bands,
        samples: run.samples,
        first_ts: run.start_ts,
        last_ts: run.end_ts,
      });
      continue;
    }
    combo.samples += run.samples;
    combo.last_ts = Math.max(combo.last_ts, run.end_ts);
    combo.first_ts = Math.min(combo.first_ts, run.start_ts);
  }
  return [...byCombo.values()].sort((a, b) => b.samples - a.samples);
}

// --- Outages, with the cell that was serving ----------------------------------

export interface OutageRow {
  key: string;
  startTs: number;
  endTs: number;
  seconds: number;
  samples: number;
  /** The serving identity at `start_ts`, read off the runs. */
  ltePci: number | null;
  lteBand: string | null;
  nrBand: string | null;
  /** True when no run covers the outage's start — the record was blind there. */
  uncovered: boolean;
}

/**
 * Outage spans, newest first, each carrying the cell that was serving when it
 * began.
 *
 * The serving cell is read off the runs rather than guessed: a run is cut at a
 * band/PCI change and at the same gap threshold the outage spans are cut at, so
 * "the run containing this instant" is the identity the modem reported.
 * `uncovered` says so honestly when no run covers it.
 */
export function outageRows(outages: NrOutage[], runs: ServingRun[]): OutageRow[] {
  const ordered = [...outages].sort((a, b) => b.start_ts - a.start_ts);
  return ordered.map((outage) => {
    let serving: ServingRun | undefined;
    for (const run of runs) {
      if (run.start_ts <= outage.start_ts && run.end_ts >= outage.start_ts) {
        serving = run;
        break;
      }
      if (run.start_ts <= outage.start_ts) serving = run;
    }
    return {
      key: `${outage.start_ts}-${outage.end_ts}`,
      startTs: outage.start_ts,
      endTs: outage.end_ts,
      seconds: Math.max(0, outage.end_ts - outage.start_ts),
      samples: outage.samples,
      ltePci: serving?.lte_pci ?? null,
      lteBand: serving?.lte_band ?? null,
      nrBand: serving?.nr_band ?? null,
      uncovered: serving === undefined,
    };
  });
}

// --- Series for the charts ----------------------------------------------------

/** The three archivable readings this recorder writes per row. */
export const CHART_METRICS = ["rsrp", "rsrq", "sinr"] as const;

export type ChartMetric = (typeof CHART_METRICS)[number];

/**
 * A metric's plotting contract.
 *
 * `domain` is the metric's reporting bracket, deliberately narrower than the
 * 3GPP limits: a reading outside is drawn at the edge rather than rescaling the
 * whole chart around one outlier, and the same reading sits at the same height
 * across every range. Every metric here plots in `--chart-nr` because they are
 * all serving-cell radio readings — the tone carries "this is the radio", not
 * which of the three it is, and each chart prints its own title.
 */
export const METRIC_AXIS = {
  rsrp: { unit: "dBm", domain: [-125, -55], tone: "var(--chart-nr)" },
  rsrq: { unit: "dB", domain: [-20, -3], tone: "var(--chart-nr)" },
  sinr: { unit: "dB", domain: [-20, 30], tone: "var(--chart-nr)" },
} as const satisfies Record<
  ChartMetric,
  { unit: string; domain: readonly [number, number]; tone: string }
>;

/** Bucket edges shared by every series, aligned to the availability strip's own. */
function bucketStarts(window: CellHistoryWindow, bucketSec: number): number[] {
  if (bucketSec <= 0 || window.end <= window.start) return [];
  const first = Math.floor(window.start / bucketSec) * bucketSec;
  const starts: number[] = [];
  for (let ts = first; ts <= window.end; ts += bucketSec) starts.push(ts);
  return starts;
}

/** Mean of one column's non-null readings per bucket, `null` where none answered. */
function meanSeries(
  rows: CellHistoryRow[],
  window: CellHistoryWindow,
  bucketSec: number,
  value: (row: CellHistoryRow) => number | null,
): CellHistoryPoint[] {
  const starts = bucketStarts(window, bucketSec);
  if (starts.length === 0) return [];
  const first = starts[0];
  const sums = new Array<number>(starts.length).fill(0);
  const counts = new Array<number>(starts.length).fill(0);

  for (const row of rows) {
    const reading = value(row);
    if (reading === null) continue;
    const index = Math.floor((row.ts - first) / bucketSec);
    if (index < 0 || index >= starts.length) continue;
    sums[index] += reading;
    counts[index] += 1;
  }

  return starts.map((ts, index) => ({
    ts,
    v: counts[index] > 0 ? sums[index] / counts[index] : null,
  }));
}

/** One reading over time. A bucket with no reading stays `null`, never 0. */
export function metricSeries(
  rows: CellHistoryRow[],
  metric: ChartMetric,
  window: CellHistoryWindow,
  bucketSec: number,
): CellHistoryPoint[] {
  return meanSeries(rows, window, bucketSec, (row) => row[metric]);
}

/**
 * RSRP over time, one line per LTE band the device served on.
 *
 * The recorder writes ONE RSRP per row — the serving carrier's — so this is
 * "the RSRP while on that band", not a per-component-carrier measurement. It is
 * still the reading that answers "was band 1 weaker than band 3", which is what
 * the per-band card is for; `lte_band` is already display-ready and is never
 * re-prefixed. Rows with no band are not plotted (they cannot be named).
 */
export function bandRsrpSeries(
  rows: CellHistoryRow[],
  window: CellHistoryWindow,
  bucketSec: number,
): Record<string, CellHistoryPoint[]> {
  const byBand = new Map<string, CellHistoryRow[]>();
  for (const row of rows) {
    const band = row.lte_band;
    if (band === null || band.trim() === "") continue;
    const list = byBand.get(band);
    if (list === undefined) byBand.set(band, [row]);
    else list.push(row);
  }

  const series: Record<string, CellHistoryPoint[]> = {};
  for (const [band, bandRows] of byBand) {
    series[band] = meanSeries(bandRows, window, bucketSec, (row) => row.rsrp);
  }
  return series;
}

/**
 * The Y domain for one chart: the metric's own bracket, widened — never clipped
 * — when a reading genuinely falls outside it. An axis that hides the sample it
 * is drawing is worse than an axis that moves.
 */
export function yDomain(
  metric: ChartMetric,
  points: { v: number | null }[],
): [number, number] {
  const bracket = METRIC_AXIS[metric].domain;
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (point.v === null) continue;
    if (point.v < min) min = point.v;
    if (point.v > max) max = point.v;
  }
  if (!Number.isFinite(min)) return [bracket[0], bracket[1]];
  return [Math.min(bracket[0], min), Math.max(bracket[1], max)];
}

// --- Axis ticks ---------------------------------------------------------------

export interface HourTick {
  ts: number;
  /** Position along the window, in percent. */
  leftPct: number;
}

const MAX_HOUR_TICKS = 7;
const TICK_STEPS = [1, 2, 3, 6, 12, 24] as const;

/**
 * The local hour boundaries inside the window, thinned to at most
 * `MAX_HOUR_TICKS` of them.
 *
 * Boundaries are walked with `Date#setHours`, never by adding 3600 to a
 * timestamp, so a half-hour zone (UTC+05:30) and a DST step both land on the
 * hour the reader's own clock shows.
 */
export function hourTicks(window: CellHistoryWindow): HourTick[] {
  const span = windowSeconds(window);
  if (span <= 0) return [];

  const step =
    TICK_STEPS.find((candidate) => span / (candidate * 3600) <= MAX_HOUR_TICKS) ??
    24;

  const cursor = new Date(window.start * 1000);
  cursor.setMinutes(0, 0, 0);
  if (cursor.getTime() / 1000 < window.start) cursor.setHours(cursor.getHours() + 1);

  const ticks: HourTick[] = [];
  while (cursor.getTime() / 1000 <= window.end) {
    if (cursor.getHours() % step === 0) {
      const ts = Math.floor(cursor.getTime() / 1000);
      ticks.push({ ts, leftPct: ((ts - window.start) / span) * 100 });
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  return ticks;
}

// --- The newest sample, for the identity card ---------------------------------

export interface NewestSample {
  cell: CellHistoryRow;
  as_of: number;
}

/**
 * The newest sample in the range.
 *
 * The identity card is NOT a live card — it says "as of <time>" because the
 * archive's last row is up to a poll cycle old, and the dashboard is the live
 * surface.
 */
export function newestSample(rows: CellHistoryRow[]): NewestSample | null {
  let newest: CellHistoryRow | null = null;
  for (const row of rows) {
    if (newest === null || row.ts > newest.ts) newest = row;
  }
  return newest === null ? null : { cell: newest, as_of: newest.ts };
}

// --- The serving-cell gantt ---------------------------------------------------

export interface TimelineSegment {
  key: string;
  run: ServingRun;
  leftPct: number;
  widthPct: number;
}

/**
 * Runs as percentages of the window.
 *
 * A segment is floored at `MIN_SEGMENT_PCT` so a one-minute run on a day's range
 * is still a visible mark rather than a sub-pixel sliver: the gantt is read as
 * "the cell changed here", and a change nobody can see is the failure this floor
 * prevents.
 */
const MIN_SEGMENT_PCT = 0.5;

export function timelineSegments(
  runs: ServingRun[],
  window: CellHistoryWindow,
): TimelineSegment[] {
  const span = windowSeconds(window);
  if (span <= 0) return [];

  const segments: TimelineSegment[] = [];
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
      key: `${run.start_ts}-${run.lte_pci ?? "-"}-${run.nr_band ?? "-"}`,
      run,
      leftPct,
      widthPct,
    });
  }
  return segments;
}

/**
 * Which of a leg's two tones a band wears.
 *
 * A hash of the band string, so the same band always lands on the same tone —
 * across a re-render, a range switch and a reload. Deriving it from the array
 * index instead would repaint every segment whenever the window moved, which is
 * the "colour keyed stably by band" requirement inverted.
 *
 * It is a TWO-way split, and that is stated rather than hidden: B1 and B3 land on
 * the same tone. Nothing depends on the shade being unique — the gantt draws a
 * gap between every segment and prints the band inside each one, so a boundary is
 * legible before any colour is read. The shade only makes two runs of the SAME
 * band look like the same thing.
 */
export function bandVariant(band: string | null): 0 | 1 {
  const text = band ?? "";
  // Seeded with the LENGTH so two bands of different widths are not separated by
  // their trailing digit alone, which is the only character "B1" and "B3" have
  // apart.
  let hash = 5381 + text.length * 131;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 2) as 0 | 1;
}

/** A run's own band for one leg, or `null` when the modem reported none. */
export function runBand(run: ServingRun, leg: "lte" | "nr"): string | null {
  const band = leg === "lte" ? run.lte_band : run.nr_band;
  return band !== null && band.trim() !== "" ? band : null;
}
