// =============================================================================
// cell-history.ts — the `fetch_signal_history.sh?view=cells&range=` contract
// =============================================================================
// The wire payload is the ARCHIVE'S ROWS, not aggregates: one row a minute as
// `qmanager_poller`'s append_cell_history wrote it. A 24 h window is at most
// 1440 rows, so the derived shapes (availability buckets, outage spans, cell
// runs, changes) are computed here in typed, unit-tested code
// (`components/cellular/history/derive.ts`) instead of in awk on the device's
// one core. That is the reason this file carries no `cells` object: a longer
// range would need the derivation moved to the CGI, which is why the range list
// stops at a day.
//
// ONE RULE GOVERNS EVERY FIELD: an ABSENT reading is `null`, never `0`. A 0 dBm
// RSRP, a 0 PCI and a 0 SINR are all readings the radio can legitimately report,
// so a missing value arriving as 0 is indistinguishable from a measured one.
// Nothing here may coalesce.
//
// `nr_avail` IS THREE-VALUED, and that is the whole point of the page:
//
//   `nr_avail: 1`    an NR serving cell was reported for this sample
//   `nr_avail: 0`    the modem answered and reported no NR leg
//   `nr_avail: null` nobody determined it (no parseable serving-cell reply)
//
// "We did not look" and "5G is gone" are opposite claims and only one of them is
// a fault, so a null never opens or closes an outage span and is never counted
// in an availability denominator — it is excluded, not scored as a failure.
// =============================================================================

/**
 * Ranges the cells view serves. A day is the ceiling: the CGI hands back raw
 * rows, and a 7 d window would be ~10k rows of JSON on a single-core device.
 */
export const CELL_HISTORY_RANGES = ["1h", "3h", "6h", "12h", "24h"] as const;

export type CellHistoryRange = (typeof CELL_HISTORY_RANGES)[number];

/** One archived sample: the serving cell, the NR leg, and three LTE readings. */
export interface CellHistoryRow {
  ts: number;
  /** `network.type` at the sample: "5G-NSA", "5G-SA" or "LTE". */
  rat: string | null;
  lte_pci: number | null;
  /** Display-ready, prefix included: "B3". Never parsed to a number. */
  lte_band: string | null;
  lte_earfcn: number | null;
  lte_bw: number | null;
  lte_cell_id: number | null;
  lte_tac: number | null;
  nr_pci: number | null;
  /** Display-ready, prefix included: "N78". */
  nr_band: string | null;
  nr_arfcn: number | null;
  nr_cell_id: number | null;
  nr_tac: number | null;
  /** Three-valued: see the header. */
  nr_avail: 0 | 1 | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
}

export interface CellHistorySuccess {
  success: true;
  view: "cells";
  range: CellHistoryRange;
  /** The CGI's clock when it answered. */
  generated_at: number;
  /** The poller's row cadence, so the page can say how much it expects. */
  interval_sec: number;
  /** False when the device clock is not set (boot before NTP): no rows read. */
  sane_epoch: boolean;
  /** The newest archived row, clamped to `generated_at` — never the wall clock. */
  window_end: number;
  rows: CellHistoryRow[];
}

export interface CellHistoryFailure {
  success: false;
  error: string;
  detail?: string;
}

export type CellHistoryResponse = CellHistorySuccess | CellHistoryFailure;

export function isCellHistoryFailure(
  response: CellHistoryResponse,
): response is CellHistoryFailure {
  return response.success === false;
}

/**
 * The gap threshold every derived shape shares, in seconds.
 *
 * A row is only written when a serving-cell read answered, so real deltas are
 * 60–90 s and there are genuine holes (a scan owns the AT port, the modem was
 * unreachable, the poller restarted). Three minutes absorbs that jitter and is
 * narrow enough that a real absence of records is never bridged: an outage span
 * must END here, or a two-minute logger gap that happened to start on an
 * `nr_avail: 0` sample would paint an hour of solid red over no data at all.
 */
export const GAP_THRESHOLD_SECONDS = 3 * 60;

/** One availability bucket. `n: 0` means the bucket existed and nothing was known. */
export interface AvailabilityBucket {
  ts: number;
  /** Samples where NR availability was DETERMINED. */
  n: number;
  /** How many of those had the NR leg. Never greater than `n`. */
  up: number;
}

/** A contiguous stretch of `nr_avail === 0`, cut at the gap threshold. */
export interface NrOutage {
  start_ts: number;
  end_ts: number;
  samples: number;
}

/**
 * One bucket of a plotted series. `v` is `null` for a bucket that held no
 * reading — never `0`, because 0 dBm RSRP and 0 dB SINR are real readings.
 */
export interface CellHistoryPoint {
  ts: number;
  v: number | null;
}

/**
 * One contiguous run of a serving BAND SET — `"B1+N41"` while the NR leg was
 * reported, `"B1"` while it was not.
 *
 * Separate from `ServingRun` on purpose: the PCI can stay put while the NR leg
 * comes and goes, and that transition is the one the field complaint is about
 * ("sometimes band 1"), so it needs its own segment rather than a new cell.
 */
export interface BandRun {
  start_ts: number;
  end_ts: number;
  samples: number;
  /** `"+"`-joined band tokens ("B1+N41"), or `null` when neither leg was named. */
  bands: string | null;
}

/** Time-share rollup of one band set across the window, most samples first. */
export interface BandCombo {
  bands: string | null;
  samples: number;
  first_ts: number;
  last_ts: number;
}

/** One contiguous run of a single serving cell — a segment of the strip. */
export interface ServingRun {
  start_ts: number;
  end_ts: number;
  samples: number;
  lte_pci: number | null;
  lte_band: string | null;
  nr_band: string | null;
  rat: string | null;
  /** Mean LTE RSRP across the run's samples, or null when none reported one. */
  rsrp: number | null;
  /** 0–100, or null when no sample in the run determined availability. */
  nr_avail_pct: number | null;
}

/** Time on one serving cell against 5G availability on it. */
export interface CellStat {
  /** The PCI as a string, or "(none)" — the field an operator recognises. */
  key: string;
  lte_pci: number | null;
  lte_band: string | null;
  samples: number;
  /** Samples where 5G was known to be absent. */
  nr_down: number;
  /** Samples where availability was determined — the ratio's denominator. */
  nr_known: number;
  first_ts: number;
  last_ts: number;
  rsrp: number | null;
}

/** The identity fields a change is reported for. */
export const CELL_CHANGE_FIELDS = [
  "nr_avail",
  "rat",
  "lte_pci",
  "lte_band",
  "nr_pci",
  "nr_band",
] as const;

export type CellChangeField = (typeof CELL_CHANGE_FIELDS)[number];

/** One field changing at one instant. Values are strings on the wire. */
export interface CellChange {
  field: CellChangeField;
  from: string | null;
  to: string | null;
}

/**
 * One instant, not one field: a handover changes PCI and band at the same tick,
 * and listing those separately doubles the list for no added information.
 */
export interface CellEventGroup {
  ts: number;
  changes: CellChange[];
}
