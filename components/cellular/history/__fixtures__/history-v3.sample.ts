// =============================================================================
// history-v3.sample.ts — a realistic 24 h response, for eyeballing the page
// =============================================================================
// Typed as `CellHistorySuccess`, so the page and the frozen contract cannot
// drift without this file failing to compile. NOT imported by the app: it is a
// fixture to feed `CellHistory` (or `useCellHistory`'s `data`) while the CGI is
// not reachable, and to read as a worked example of every field.
//
// What it contains, on purpose (each is a case a panel must handle):
//   * two carriers - `L:1:250` (LTE B1, always the PCC) and `N:41:509070` (NR
//     n41, an SCC that drops out for ~50 min), on a 300 s bucket grid;
//   * a recorder silence of 70 min (no buckets at all) - the line must break;
//   * antennas where ports 1 and 2 (Diversity, MIMO 3) sit ~35 dB under 0 and 3,
//     on both radios - the antenna verdict must read `destructive`;
//   * congestion with a saturated evening stretch and idle buckets around it;
//   * two restarts (one `restart`, one `power_loss`);
//   * L1 sampling on (`recorder.l1_enabled`), so MCS/rank/PRB are present;
//   * `null` readings sprinkled in (never `0`).
// Deterministic: the same `now` always yields the same series.
// =============================================================================

import type {
  AntennaSeries,
  AvailabilityBucket,
  CarrierSeries,
  CellHistoryPanel,
  CellHistoryPoint,
  CellHistorySuccess,
  CongestionPoint,
} from "@/types/cell-history";

const BUCKET = 300;
const DAY = 86_400;

/** A small seeded PRNG, so the fixture is stable between renders and reloads. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeHistoryV3Sample(
  nowSec: number = Math.floor(Date.now() / 1000),
): CellHistorySuccess {
  const rand = mulberry32(75);
  const end = nowSec;
  const start = end - DAY;
  const first = Math.ceil(start / BUCKET) * BUCKET;

  const grid: number[] = [];
  for (let ts = first; ts <= end - BUCKET; ts += BUCKET) grid.push(ts);

  // Recorder silence: 70 minutes, 15 h to ~13.8 h ago.
  const silenceFrom = end - 15 * 3600;
  const silenceTo = silenceFrom + 70 * 60;
  const recorded = grid.filter((ts) => ts < silenceFrom || ts >= silenceTo);

  // The NR SCC is absent for 50 minutes, 6 h ago.
  const nrOffFrom = end - 6 * 3600;
  const nrOffTo = nrOffFrom + 50 * 60;
  const nrPresent = (ts: number) => ts < nrOffFrom || ts >= nrOffTo;

  // A busy evening: saturated from 5 h to 3 h ago.
  const busyFrom = end - 5 * 3600;
  const busyTo = end - 3 * 3600;
  const busy = (ts: number) => ts >= busyFrom && ts < busyTo;

  const wave = (ts: number, period: number) =>
    Math.sin(((ts - start) / period) * Math.PI * 2);

  const round = (value: number, decimals = 0) => {
    const f = 10 ** decimals;
    return Math.round(value * f) / f;
  };

  /** One series over the recorded grid; `make` returns null for "no reading". */
  const series = (
    make: (ts: number, i: number) => number | null,
  ): CellHistoryPoint[] =>
    recorded.map((ts, i) => ({ ts, v: make(ts, i) }));

  /** Occasionally drop a single reading, the way a busy AT channel does. */
  const sometimes = (value: number, odds = 0.02): number | null =>
    rand() < odds ? null : value;

  // ── carriers ──────────────────────────────────────────────────────────────
  const lteRsrp = (ts: number) => -88 + 6 * wave(ts, 21_000) + (rand() - 0.5) * 3;
  const nrRsrp = (ts: number) => -96 + 5 * wave(ts, 15_000) + (rand() - 0.5) * 3;

  const carriers: CarrierSeries[] = [
    {
      key: "L:1:250",
      tech: "LTE",
      band: 1,
      arfcn: 250,
      bw_mhz: 20,
      role_pct_pcc: 100,
      samples: recorded.length,
      rsrp: series((ts) => sometimes(round(lteRsrp(ts), 1))),
      rsrq: series((ts) => sometimes(round(-11 + 2 * wave(ts, 9_000) + (rand() - 0.5), 1))),
      sinr: series((ts) => sometimes(round(11 + 6 * wave(ts, 13_000) + (rand() - 0.5) * 2, 1))),
      rssi: series((ts) => sometimes(round(-57 + 4 * wave(ts, 11_000), 1))),
    },
    {
      key: "N:41:509070",
      tech: "NR",
      band: 41,
      arfcn: 509070,
      bw_mhz: 100,
      role_pct_pcc: 0,
      samples: recorded.filter(nrPresent).length,
      rsrp: series((ts) => (nrPresent(ts) ? sometimes(round(nrRsrp(ts), 1)) : null)),
      rsrq: series((ts) => (nrPresent(ts) ? round(-10.5 + 1.5 * wave(ts, 8_000), 1) : null)),
      sinr: series((ts) => (nrPresent(ts) ? sometimes(round(22 + 8 * wave(ts, 17_000), 1)) : null)),
      // NR often reports no RSSI: an all-null series must render as "no reading".
      rssi: series(() => null),
    },
  ];

  // ── antennas: Diversity and MIMO 3 are ~35 dB down on both radios ─────────
  const antennaSeries = (
    tech: "LTE" | "NR",
    port: 0 | 1 | 2 | 3,
    base: number,
    offset: number,
  ): AntennaSeries => {
    const points = series((ts) =>
      tech === "NR" && !nrPresent(ts)
        ? null
        : sometimes(round(base + offset + 3 * wave(ts, 19_000) + (rand() - 0.5) * 2, 1)),
    );
    const values = points
      .map((p) => p.v)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    return {
      tech,
      port,
      rsrp: points,
      median: values.length ? values[Math.floor(values.length / 2)] : null,
    };
  };
  const antennas: AntennaSeries[] = [
    antennaSeries("LTE", 0, -88, 0),
    antennaSeries("LTE", 1, -88, -35),
    antennaSeries("LTE", 2, -88, -36),
    antennaSeries("LTE", 3, -88, -1.5),
    antennaSeries("NR", 0, -96, 0),
    antennaSeries("NR", 1, -96, -34),
    antennaSeries("NR", 2, -96, -35),
    antennaSeries("NR", 3, -96, -2),
  ];

  // ── congestion ────────────────────────────────────────────────────────────
  const congestion: CongestionPoint[] = recorded
    .filter((ts) => nrPresent(ts))
    .map((ts) => {
      const saturated = busy(ts);
      const share = saturated
        ? 38 + 14 * wave(ts, 3_200) + rand() * 6
        : 4 + rand() * 9;
      return {
        ts,
        prb_share: round(share, 1),
        prb_max_share: round(Math.min(100, share * 1.35 + rand() * 4), 1),
        dl_bps: Math.round(
          (saturated ? 190e6 + 60e6 * wave(ts, 2_900) : 1.5e6 + rand() * 14e6) *
            (0.9 + rand() * 0.2),
        ),
        saturated,
        samples: saturated ? 50 : 12,
      };
    });

  // ── the single-valued series ──────────────────────────────────────────────
  const numeric = (
    make: (ts: number) => number,
    decimals = 0,
    odds = 0.015,
  ) => series((ts) => sometimes(round(make(ts), decimals), odds));

  const seriesMap: Partial<Record<CellHistoryPanel, CellHistoryPoint[]>> = {
    rsrp: carriers[0].rsrp,
    sinr: carriers[0].sinr,
    rsrq: carriers[0].rsrq,
    rssi: carriers[0].rssi,
    ca: series((ts) => (nrPresent(ts) ? 2 : 1)),
    bw: series((ts) => (nrPresent(ts) ? 120 : 20)),
    lte_mcs: numeric((ts) => (busy(ts) ? 23 : 15) + 3 * wave(ts, 5_000), 1),
    nr_mcs: series((ts) => (nrPresent(ts) ? round((busy(ts) ? 24 : 17) + 2 * wave(ts, 6_000), 1) : null)),
    ul_mcs: numeric((ts) => 12 + 4 * wave(ts, 7_000), 1),
    lte_ri: series(() => (rand() < 0.15 ? 1 : 2)),
    nr_ri: series((ts) => (nrPresent(ts) ? (busy(ts) ? 4 : rand() < 0.3 ? 2 : 3) : null)),
    lte_cqi: numeric((ts) => 11 + 2 * wave(ts, 9_000), 1),
    nr_cqi: series((ts) => (nrPresent(ts) ? round(12 + 2 * wave(ts, 8_000), 1) : null)),
    tx_power: numeric((ts) => 8 + 6 * wave(ts, 6_500), 1),
    temp: numeric((ts) => 52 + 6 * wave(ts, 40_000)),
    cpu: numeric((ts) => 18 + 12 * Math.abs(wave(ts, 4_000))),
    mem: numeric((ts) => 61 + 2 * wave(ts, 30_000)),
    dl: series((ts) => {
      const p = congestion.find((c) => c.ts === ts);
      return p ? p.dl_bps : Math.round(1e6 + rand() * 5e6);
    }),
    ul: series((ts) => Math.round(0.4e6 + rand() * (busy(ts) ? 12e6 : 1.5e6))),
    lat: numeric((ts) => 38 + 8 * wave(ts, 6_000) + rand() * 6, 1),
    jit: numeric((ts) => 4 + 2 * Math.abs(wave(ts, 3_000)) + rand() * 2, 1),
    loss: series(() => (rand() < 0.08 ? round(rand() * 6, 1) : 0)),
  };

  // ── availability / outages / timeline ─────────────────────────────────────
  const outageFrom = nrOffFrom;
  const outageTo = nrOffTo;
  const AV = 900;
  const availability: AvailabilityBucket[] = [];
  for (let ts = Math.ceil(start / AV) * AV; ts < end; ts += AV) {
    const silent = ts >= silenceFrom && ts < silenceTo;
    if (silent) {
      availability.push({ ts, n: 0, up: 0 });
    } else {
      const down = ts >= outageFrom && ts < outageTo;
      availability.push({ ts, n: 15, up: down ? 0 : 15 });
    }
  }

  const sample = recorded.length;
  const range = "24h" as const;

  return {
    success: true,
    view: "cells",
    range,
    generated_at: end,
    bucket_sec: BUCKET,
    window: {
      start,
      end,
      samples: sample * 5,
      first_ts: recorded[0] ?? null,
      last_ts: recorded[recorded.length - 1] ?? null,
    },
    coverage: { cell_from: recorded[0] ?? null },
    snapshot: {
      registered: true,
      carrier: "Sample Carrier",
      as_of: recorded[recorded.length - 1] ?? null,
      cell: {
        lte_pci: 104,
        lte_earfcn: 250,
        lte_band: "B1",
        lte_bw: 20,
        lte_cellid: 48466199,
        lte_tac: 55383,
        nr_pci: 47,
        nr_arfcn: 509070,
        nr_band: "N41",
        nr_bw: 100,
        nr_cellid: null,
        nr_tac: null,
        network_type: "5G-NSA",
        registered: true,
        nr_avail: 1,
      },
    },
    series: seriesMap,
    missing: [],
    cells: {
      availability,
      availability_sec: AV,
      outages: [
        {
          start_ts: outageFrom,
          end_ts: outageTo,
          samples: Math.round((outageTo - outageFrom) / 60),
        },
      ],
      events: [
        {
          ts: outageFrom,
          changes: [{ field: "nr_avail", from: "1", to: "0" }],
        },
        {
          ts: outageTo,
          changes: [{ field: "nr_avail", from: "0", to: "1" }],
        },
      ],
      stats: [
        {
          key: "104",
          lte_pci: "104",
          lte_band: "B1",
          lte_cellid: "48466199",
          samples: sample * 5,
          nr_down: Math.round((outageTo - outageFrom) / 60),
          nr_known: sample * 5,
          first_ts: recorded[0] ?? start,
          last_ts: recorded[recorded.length - 1] ?? end,
        },
      ],
      timeline: [
        {
          start_ts: start,
          end_ts: silenceFrom,
          samples: 540,
          lte_pci: "104",
          lte_band: "B1",
          nr_band: "N41",
          nr_avail_pct: 94,
        },
        {
          start_ts: silenceTo,
          end_ts: end,
          samples: 960,
          lte_pci: "104",
          lte_band: "B1",
          nr_band: "N41",
          nr_avail_pct: 96,
        },
      ],
      bands: [],
      band_series: {
        B1: carriers[0].rsrp,
        N41: carriers[1].rsrp,
      },
      combos: [],
    },
    recorder: {
      state: "ok",
      stale_sec: 45,
      free_kb: 11_200,
      archive_kb: 1_840,
      oldest_ts: end - 9 * DAY,
      l1_enabled: true,
    },
    device_utc_offset_min: -new Date().getTimezoneOffset(),
    carriers,
    antennas,
    congestion,
    restarts: [
      {
        boot_ts: end - 19 * 3600,
        last_alive_ts: end - 19 * 3600 - 70,
        down_sec: 70,
        cause: "restart",
      },
      {
        boot_ts: silenceTo - 60,
        last_alive_ts: silenceFrom,
        down_sec: silenceTo - 60 - silenceFrom,
        cause: "power_loss",
      },
    ],
  };
}

export const HISTORY_V3_SAMPLE: CellHistorySuccess = makeHistoryV3Sample();
