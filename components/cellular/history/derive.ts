import {
  CELL_CHANGE_FIELDS,
  GAP_THRESHOLD_SECONDS,
  type AvailabilityBucket,
  type CellChange,
  type CellEventGroup,
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
export function availabilityTier(bucket: AvailabilityBucket): AvailabilityTier {
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
