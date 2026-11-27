// =============================================================================
// cell-history.ts — the `fetch_signal_history.sh?view=cells&range=` contract
// =============================================================================
// Mirrors `docs/specs/cell-history.md` §Response contract. That document is the
// authority; this file is its TypeScript face, and the two are edited together.
//
// The same rule as `types/detailed-metrics.ts` governs every field here, and it
// is not stylistic: an ABSENT reading is `null`, never `0`. A `0` dBm RSRP, a
// `0` MCS index and a `0` PCI are all readings the radio can legitimately
// report, so a missing value arriving as `0` would be indistinguishable from a
// measured one. Nothing in this file may coalesce.
//
// THREE-VALUED FIELDS are the other half of that rule, and they are why
// `nr_avail` is not a boolean:
//
//   `nr_avail: 1`    an NR serving cell was reported for this sample
//   `nr_avail: 0`    the modem was read and reported no NR leg
//   `nr_avail: null` nobody looked (AT and modemd both silent, or a pre-v2 row)
//
// "We did not look" and "it is not there" are opposite claims about a modem and
// only one of them is the field complaint this page exists to explain. A null
// therefore never opens or closes an outage span, and is never counted in an
// availability denominator — it is excluded from `n`, not scored as a failure.
// =============================================================================

/**
 * Ranges the cells view accepts. Deliberately the same vocabulary as the
 * detailed-metrics contract: one endpoint, one range parser, one bucket table.
 * `now` is excluded because this page has no live band
 * (`docs/reference/latency-monitor.md:74` — shipped once, reverted).
 */
export const CELL_HISTORY_RANGES = [
  "1h",
  "3h",
  "6h",
  "12h",
  "24h",
  "7d",
  "30d",
] as const;

export type CellHistoryRange = (typeof CELL_HISTORY_RANGES)[number];

/**
 * Panels this page can plot. These are the ARCHIVE's panel ids (a wire
 * vocabulary), not UI labels: the page resolves a label and a unit per id and
 * never prints the id itself.
 */
export const CELL_HISTORY_PANELS = [
  "rsrp",
  "sinr",
  "rsrq",
  "rssi",
  "temp",
  "cqi",
  "rank",
  "mcs",
  "tx_power",
  "total_cells",
  "cpu",
  "mem",
  "dl",
  "ul",
  "ca",
  "bw",
  // ── archive schema v2 (history-v3) ──────────────────────────────────────
  // Per-RAT PHY series. The generic `cqi`/`rank`/`mcs` ids above are kept and
  // filled from the PCC (LTE in LTE/NSA, NR in SA) so old panel configs draw.
  "lte_mcs",
  "nr_mcs",
  "lte_ri",
  "nr_ri",
  "lte_cqi",
  "nr_cqi",
  /** Uplink MCS of the leg carrying uplink data (NR in NSA/SA, else LTE). */
  "ul_mcs",
  /**
   * NR uplink TX power, dBm (archive schema v3, `AT+QNWCFG="nr5g_tx_pwr"`,
   * L1 sampling only). `tx_power` stays the LTE TX power from AT+QENG.
   */
  "nr_tx_power",
  /** Ping archive, joined by timestamp: latency ms, jitter ms, loss %. */
  "lat",
  "jit",
  "loss",
] as const;

export type CellHistoryPanel = (typeof CELL_HISTORY_PANELS)[number];

/** One bucketed series point. `v` is `null` for a bucket that held no reading. */
export interface CellHistoryPoint {
  ts: number;
  v: number | null;
}

/** The margin of the window that actually had archive rows in it. */
export interface CellHistoryWindow {
  /** `end - span`. */
  start: number;
  /**
   * history-v3: the WALL CLOCK at generation (`generated_at`), not the newest
   * row. A recorder that stopped therefore shows an empty tail and a stale
   * banner instead of silently passing old data off as the last 24 h.
   */
  end: number;
  /** Archive samples inside the window, after the identity/PHY filters. */
  samples: number;
  first_ts: number | null;
  last_ts: number | null;
}

/**
 * The first sample in the window that carried cell-identity columns.
 *
 * Identity logging began with archive schema v2, so a window reaching further
 * back than that contains samples this page is blind to. `null` means NO sample
 * in the window has identity — the page then says identity coverage has not
 * begun rather than rendering "no cell changes", which would be a claim about
 * time nobody recorded. (greenpacket's `partialCellData`, kept.)
 */
export interface CellHistoryCoverage {
  cell_from: number | null;
}

/** Serving-cell identity, as the modem reports it. */
export interface ServingCellIdentity {
  lte_pci: number | null;
  lte_earfcn: number | null;
  /** Band as a string, exactly as reported ("3", "78"). Never parsed to a number. */
  lte_band: string | null;
  lte_bw: number | null;
  lte_cellid: number | null;
  lte_tac: number | null;
  nr_pci: number | null;
  nr_arfcn: number | null;
  nr_band: string | null;
  nr_bw: number | null;
  nr_cellid: number | null;
  nr_tac: number | null;
  /** `network.type` — "5G-NSA", "LTE", … */
  network_type: string | null;
  registered: boolean | null;
  /** Three-valued: see the header. */
  nr_avail: 0 | 1 | null;
}

/** The live snapshot: the detailed-metrics snapshot plus serving-cell identity. */
export interface CellHistorySnapshot {
  registered: boolean | null;
  carrier: string | null;
  cell: ServingCellIdentity;
  /** The newest sample's own timestamp, so the card can say "as of". */
  as_of: number | null;
}

/** One availability bucket. `n: 0` means the bucket existed and nothing was known. */
export interface AvailabilityBucket {
  ts: number;
  /** Samples in this bucket where NR availability was DETERMINED. */
  n: number;
  /** How many of those had the NR leg. Never greater than `n`. */
  up: number;
}

/** A contiguous stretch of `nr_avail === 0`, cut at the gap threshold. */
export interface NrOutage {
  start_ts: number;
  end_ts: number;
  /** Samples observed inside the span — not wall-clock seconds. */
  samples: number;
}

/** One identity field changing at one instant. Values are strings on the wire. */
export interface CellChange {
  field: CellChangeField;
  from: string | null;
  to: string | null;
}

export const CELL_CHANGE_FIELDS = [
  "nr_avail",
  "lte_pci",
  "lte_band",
  "lte_earfcn",
  "lte_bw",
  "nr_pci",
  "nr_band",
  "nr_arfcn",
  "nr_bw",
  "lte_cellid",
  "nr_cellid",
  "network_type",
  "bands",
] as const;

export type CellChangeField = (typeof CELL_CHANGE_FIELDS)[number];

/**
 * One instant, not one field: a handover changes PCI and Cell ID at the same
 * tick, and listing those separately doubles the table for no added information.
 */
export interface CellEventGroup {
  ts: number;
  changes: CellChange[];
}

/** Time-on-cell against 5G availability on that cell. */
export interface CellStat {
  /** The PCI, or "(none)" for samples with no LTE PCI. Distinguishes rows. */
  key: string;
  lte_pci: string | null;
  lte_band: string | null;
  lte_cellid: string | null;
  samples: number;
  nr_down: number;
  /** Samples where availability was determined — the ratio's denominator. */
  nr_known: number;
  first_ts: number;
  last_ts: number;
}

/** One contiguous run of a single serving cell — a segment of the gantt strip. */
export interface CellRun {
  start_ts: number;
  end_ts: number;
  samples: number;
  lte_pci: string | null;
  lte_band: string | null;
  nr_band: string | null;
  /** 0–100, or `null` when no sample in the run determined availability. */
  nr_avail_pct: number | null;
}

/**
 * One contiguous run of a band / carrier-aggregation combo — e.g. `"B3+B1+N78"`.
 *
 * Separate from `CellRun` because a serving cell can stay put while an
 * aggregated carrier comes or goes, and that is the change worth a segment: the
 * combo is what changed, not the PCI.
 */
export interface BandRun {
  start_ts: number;
  end_ts: number;
  samples: number;
  /** `"+"`-joined band tokens, exactly as the archive stores them. */
  bands: string | null;
  /** Aggregated LTE component carriers, when the run's rows reported a count. */
  ca_cc: number | null;
  /** Total aggregated bandwidth in MHz. */
  bw_mhz: number | null;
}

/** Time-share rollup of one band combo across the window. */
export interface BandCombo {
  bands: string | null;
  samples: number;
  first_ts: number;
  last_ts: number;
  ca_cc: number | null;
  bw_mhz: number | null;
}

export interface CellHistoryCells {
  /** Buckets of `availability_sec`, oldest first. */
  availability: AvailabilityBucket[];
  availability_sec: number;
  outages: NrOutage[];
  /** Newest first. */
  events: CellEventGroup[];
  /** Most samples first. */
  stats: CellStat[];
  timeline: CellRun[];
  /** Band / CA combo runs, oldest first. Empty for a pre-v3 window. */
  bands: BandRun[];
  /**
   * Per-band RSRP over time, keyed by the band token exactly as the archive
   * stores it ("B3", "N41"). Built from the `cc_sig` column (schema v4), so a
   * range that is entirely pre-v4 returns `{}` — no band lines, rather than
   * lines at zero.
   */
  band_series: Record<string, CellHistoryPoint[]>;
  /** Per-combo time share, most samples first. */
  combos: BandCombo[];
}

// ── history-v3 additions (frozen contract; see docs/plans/2026-11-27-history-v3.md) ──

import type { RestartEntry } from "./ping-history";
export type { RestartEntry } from "./ping-history";

/**
 * Recorder health, so the page can say WHY the tail is empty.
 * - ok          newest row is younger than 3 min
 * - stale       recorder running but newest row older than 3 min (`stale_sec`)
 * - low_space   recorder refusing to write: free flash under the floor
 * - empty       no archive rows at all
 * - clock_unset device clock is before 2024 (no NITZ/NTP yet)
 */
export type RecorderState = "ok" | "stale" | "low_space" | "empty" | "clock_unset";

export interface CellHistoryRecorder {
  state: RecorderState;
  /** Seconds since the newest archived row; null when there is none. */
  stale_sec: number | null;
  /** Free KB on the archive filesystem; null if unreadable. */
  free_kb: number | null;
  /** On-flash size of the archive directory (sum of file sizes), KB. */
  archive_kb: number;
  /** Oldest archived row's timestamp. */
  oldest_ts: number | null;
  /** `quecmanager.history.l1_stats` — MCS/RI/PRB/throughput sampling on. */
  l1_enabled: boolean;
}

/**
 * One component carrier tracked across the window, keyed by tech:band:arfcn.
 * Every carrier the modem reported (LTE PCC + LTE SCCs + NR SCCs/PCC) appears,
 * which is what makes "all bands" chartable.
 */
export interface CarrierSeries {
  /** "L:3:1650" | "N:41:509070" — stable across the window. */
  key: string;
  tech: "LTE" | "NR";
  /** Band number without prefix (3, 41). */
  band: number;
  arfcn: number;
  bw_mhz: number | null;
  /** 0-100: share of this carrier's samples in which it was the PCC. */
  role_pct_pcc: number;
  /** Archive rows in the window that carried this carrier. */
  samples: number;
  rsrp: CellHistoryPoint[];
  rsrq: CellHistoryPoint[];
  sinr: CellHistoryPoint[];
  rssi: CellHistoryPoint[];
}

/** Per-antenna-port RSRP, ANTENNA_PORTS order (0..3). */
export interface AntennaSeries {
  tech: "LTE" | "NR";
  port: 0 | 1 | 2 | 3;
  rsrp: CellHistoryPoint[];
  /** Median over the window, for the imbalance verdict. */
  median: number | null;
}

/**
 * This device's share of the NR (or LTE in LTE-only) carrier's PRBs, per bucket.
 * NOT cell load: a share is only meaningful while we are saturating the link
 * (`saturated`), otherwise it reflects how little we asked for.
 */
export interface CongestionPoint {
  ts: number;
  /** 0-100: mean sampled PRBs / N_RB. */
  prb_share: number | null;
  /** 0-100: max sampled PRBs / N_RB. */
  prb_max_share: number | null;
  /** Modem DL throughput, bits/s (bucket mean). */
  dl_bps: number | null;
  /** Bucket DL throughput was high enough for the share to mean something. */
  saturated: boolean;
  /** PRB snapshots behind this bucket. */
  samples: number;
}

export interface CellHistorySuccess {
  success: true;
  view: "cells";
  range: CellHistoryRange;
  generated_at: number;
  /** Bucket width for `series`; the availability strip uses its own. */
  bucket_sec: number | null;
  window: CellHistoryWindow;
  coverage: CellHistoryCoverage;
  snapshot: CellHistorySnapshot;
  series: Partial<Record<CellHistoryPanel, CellHistoryPoint[]>>;
  /** Requested panels with no coverage in this window. */
  missing: CellHistoryPanel[];
  cells: CellHistoryCells;
  // ── history-v3 ──
  recorder: CellHistoryRecorder;
  /** Device local offset from UTC in minutes (CST6 = -360, PKT = +300). */
  device_utc_offset_min: number;
  /** Every component carrier seen in the window, most samples first. */
  carriers: CarrierSeries[];
  /** 8 entries max (LTE 0-3, NR 0-3); ports with no readings are omitted. */
  antennas: AntennaSeries[];
  congestion: CongestionPoint[];
  /** Device restarts inside the window, oldest first. */
  restarts: RestartEntry[];
}

export interface CellHistoryFailure {
  success: false;
  error: string;
  message?: string;
  detail?: string;
}

export type CellHistoryResponse = CellHistorySuccess | CellHistoryFailure;

export function isCellHistoryFailure(
  response: CellHistoryResponse,
): response is CellHistoryFailure {
  return response.success === false;
}

/**
 * The gap threshold every derived shape in this feature shares, in seconds.
 *
 * The archive gains one row a minute, but a row is only written when Tier 3
 * produced something (`qmanager_poller` `poll_tier3` returns before archiving
 * when both reads were empty, and skips entirely during a scan). Real deltas are
 * therefore 60–90 s. Three minutes is wide enough to absorb that jitter and
 * narrow enough that a genuine absence of records is never bridged. A chart must
 * break its line here, and an outage span must end here — otherwise a logger
 * outage that happened to start on an `nr_avail=0` sample paints a solid red
 * band over hours that hold no data at all.
 *
 * The backend applies the same threshold when building `outages` and `timeline`;
 * this constant is the client's copy for the shapes it derives itself.
 */
export const GAP_THRESHOLD_SECONDS = 3 * 60;
