import { describe, expect, test } from "bun:test";

import {
  GAP_THRESHOLD_SECONDS,
  type CellHistoryRow,
  type CellHistorySuccess,
} from "@/types/cell-history";

import {
  availabilityBuckets,
  availabilitySummary,
  availabilityTier,
  cellEvents,
  cellStats,
  formatPct,
  formatSpan,
  isWindowShort,
  nrOutages,
  servingRuns,
  totalOutageSeconds,
  windowOf,
} from "./derive";

// =============================================================================
// Cell History derivations — the shapes the page draws
// =============================================================================
// These are the rules a reader would otherwise have to take on trust: a gap is
// not an outage, a null is not a zero, a bucket with no determined sample is its
// own tier, and a change is against the last KNOWN value rather than the row
// before. Every case below is one of those.
// =============================================================================

const BASE = 1_792_530_000;

/** A row with everything absent except what the case sets. */
function row(ts: number, overrides: Partial<CellHistoryRow> = {}): CellHistoryRow {
  return {
    ts,
    rat: "5G-NSA",
    lte_pci: 123,
    lte_band: "B3",
    lte_earfcn: 1650,
    lte_bw: 20,
    lte_cell_id: 12345,
    lte_tac: 4321,
    nr_pci: 201,
    nr_band: "N78",
    nr_arfcn: 632448,
    nr_cell_id: null,
    nr_tac: null,
    nr_avail: 1,
    rsrp: -90,
    rsrq: -11,
    sinr: 10,
    ...overrides,
  };
}

function payload(
  rows: CellHistoryRow[],
  range: CellHistorySuccess["range"] = "1h",
): CellHistorySuccess {
  return {
    success: true,
    view: "cells",
    range,
    generated_at: BASE + 3600,
    interval_sec: 60,
    sane_epoch: true,
    window_end:
      rows.length > 0 ? rows[rows.length - 1].ts : BASE + 3600,
    rows,
  };
}

describe("windowOf", () => {
  test("ends at the newest archived row, never at the CGI clock", () => {
    const data = payload([row(BASE), row(BASE + 600)]);
    const window = windowOf(data);
    expect(window.end).toBe(BASE + 600);
    expect(window.start).toBe(BASE + 600 - 3600);
    expect(window.samples).toBe(2);
    expect(window.first_ts).toBe(BASE);
  });

  test("an empty payload still yields a window, with no samples", () => {
    const window = windowOf(payload([]));
    expect(window.samples).toBe(0);
    expect(window.first_ts).toBeNull();
    expect(window.end).toBe(BASE + 3600);
  });
});

describe("isWindowShort", () => {
  test("a full day of rows is not short", () => {
    const rows = [row(BASE - 86_400 + 3600), row(BASE)];
    const data = payload(rows, "24h");
    expect(isWindowShort(windowOf(data), "24h")).toBe(false);
  });

  test("ten minutes of rows in a 24h range is short", () => {
    const rows = [row(BASE - 600), row(BASE)];
    const data = payload(rows, "24h");
    expect(isWindowShort(windowOf(data), "24h")).toBe(true);
  });

  test("an empty window is not called short — it is empty", () => {
    expect(isWindowShort(windowOf(payload([])), "24h")).toBe(false);
  });
});

describe("availabilityBuckets", () => {
  const window = { start: BASE, end: BASE + 3600, samples: 0, first_ts: null, last_ts: null };

  test("a null never enters the denominator", () => {
    const rows = [
      row(BASE + 60, { nr_avail: 1 }),
      row(BASE + 120, { nr_avail: null }),
      row(BASE + 180, { nr_avail: 0 }),
    ];
    // 10-minute buckets: one bucket holds all three samples.
    const buckets = availabilityBuckets(rows, window, 600);
    const filled = buckets.filter((bucket) => bucket.n > 0);
    expect(filled).toHaveLength(1);
    expect(filled[0].n).toBe(2);
    expect(filled[0].up).toBe(1);
  });

  test("a bucket with no rows is emitted with n: 0, not skipped", () => {
    const rows = [row(BASE + 60), row(BASE + 3000)];
    const buckets = availabilityBuckets(rows, window, 600);
    expect(buckets.length).toBeGreaterThan(3);
    expect(buckets.slice(1, 5).every((bucket) => bucket.n === 0)).toBe(true);
  });

  test("a row outside the window is not bucketed", () => {
    const rows = [row(BASE - 600), row(BASE + 60)];
    const buckets = availabilityBuckets(rows, window, 600);
    const total = buckets.reduce((sum, bucket) => sum + bucket.n, 0);
    expect(total).toBe(1);
  });
});

describe("availability tier and summary", () => {
  test("unknown is its own tier, not down", () => {
    expect(availabilityTier({ ts: BASE, n: 0, up: 0 })).toBe("unknown");
    expect(availabilityTier({ ts: BASE, n: 5, up: 0 })).toBe("down");
    expect(availabilityTier({ ts: BASE, n: 5, up: 5 })).toBe("up");
    expect(availabilityTier({ ts: BASE, n: 5, up: 2 })).toBe("partial");
  });

  test("no determined sample means no percentage at all", () => {
    const summary = availabilitySummary([{ ts: BASE, n: 0, up: 0 }]);
    expect(summary.pct).toBeNull();
    expect(summary.known).toBe(0);
  });

  test("the percentage is over determined samples only", () => {
    const summary = availabilitySummary([
      { ts: BASE, n: 3, up: 3 },
      { ts: BASE + 600, n: 1, up: 0 },
    ]);
    expect(summary.known).toBe(4);
    expect(summary.up).toBe(3);
    expect(summary.pct).toBe(75);
  });
});

describe("nrOutages", () => {
  test("a logger gap ends the span instead of bridging it", () => {
    const rows = [
      row(BASE, { nr_avail: 0 }),
      row(BASE + 60, { nr_avail: 0 }),
      // > GAP_THRESHOLD_SECONDS with no rows at all, then 5G still absent.
      row(BASE + 60 + GAP_THRESHOLD_SECONDS + 600, { nr_avail: 0 }),
    ];
    const outages = nrOutages(rows);
    expect(outages).toHaveLength(2);
    expect(outages[0]).toEqual({ start_ts: BASE, end_ts: BASE + 60, samples: 2 });
    expect(outages[1].samples).toBe(1);
  });

  test("a null neither opens nor closes a span", () => {
    const rows = [
      row(BASE, { nr_avail: 0 }),
      row(BASE + 60, { nr_avail: null }),
      row(BASE + 120, { nr_avail: 0 }),
      row(BASE + 180, { nr_avail: 1 }),
    ];
    const outages = nrOutages(rows);
    expect(outages).toHaveLength(1);
    expect(outages[0]).toEqual({
      start_ts: BASE,
      end_ts: BASE + 120,
      samples: 2,
    });
  });

  test("no outage when 5G was never absent", () => {
    expect(nrOutages([row(BASE), row(BASE + 60)])).toHaveLength(0);
  });

  test("the total is measured from span edges, not sample count", () => {
    const outages = [{ start_ts: BASE, end_ts: BASE + 900, samples: 3 }];
    expect(totalOutageSeconds(outages)).toBe(900);
  });
});

describe("servingRuns", () => {
  test("a cell that served the whole window is one run", () => {
    const rows = [row(BASE), row(BASE + 60), row(BASE + 120)];
    const runs = servingRuns(rows);
    expect(runs).toHaveLength(1);
    expect(runs[0].samples).toBe(3);
    expect(runs[0].start_ts).toBe(BASE);
    expect(runs[0].end_ts).toBe(BASE + 120);
    expect(runs[0].nr_avail_pct).toBe(100);
    expect(runs[0].rsrp).toBe(-90);
  });

  test("a PCI change starts a new run", () => {
    const rows = [row(BASE), row(BASE + 60, { lte_pci: 342 })];
    const runs = servingRuns(rows);
    expect(runs).toHaveLength(2);
    expect(runs[1].lte_pci).toBe(342);
  });

  test("an NR band change starts a new run", () => {
    const rows = [row(BASE), row(BASE + 60, { nr_band: "N41" })];
    expect(servingRuns(rows)).toHaveLength(2);
  });

  test("a gap starts a new run of the same cell", () => {
    const rows = [
      row(BASE),
      row(BASE + GAP_THRESHOLD_SECONDS + 600),
    ];
    expect(servingRuns(rows)).toHaveLength(2);
  });

  test("a run with no determined sample reports no percentage", () => {
    const runs = servingRuns([row(BASE, { nr_avail: null })]);
    expect(runs[0].nr_avail_pct).toBeNull();
  });
});

describe("cellStats", () => {
  test("time on cell against 5G availability, most samples first", () => {
    const rows = [
      row(BASE, { lte_pci: 100, nr_avail: 0 }),
      row(BASE + 60, { lte_pci: 100, nr_avail: 0 }),
      row(BASE + 120, { lte_pci: 100, nr_avail: 1 }),
      row(BASE + 180, { lte_pci: 200, nr_avail: 1 }),
    ];
    const stats = cellStats(rows);
    expect(stats[0].key).toBe("100");
    expect(stats[0].samples).toBe(3);
    expect(stats[0].nr_down).toBe(2);
    expect(stats[0].nr_known).toBe(3);
    expect(stats[1].key).toBe("200");
  });

  test("a sample with no PCI is its own row rather than being dropped", () => {
    const stats = cellStats([row(BASE, { lte_pci: null })]);
    expect(stats[0].key).toBe("(none)");
    expect(stats[0].lte_pci).toBeNull();
  });

  test("a null availability is excluded from the ratio's denominator", () => {
    const stats = cellStats([
      row(BASE, { nr_avail: null }),
      row(BASE + 60, { nr_avail: 0 }),
    ]);
    expect(stats[0].nr_known).toBe(1);
    expect(stats[0].nr_down).toBe(1);
  });
});

describe("cellEvents", () => {
  test("NR dropping and returning on another PCI is one pair, not none", () => {
    const rows = [
      row(BASE, { nr_pci: 201 }),
      row(BASE + 60, { nr_pci: null, nr_band: null, nr_avail: 0 }),
      row(BASE + 120, { nr_pci: 305, nr_band: "N78", nr_avail: 1 }),
    ];
    const events = cellEvents(rows);
    const nrPci = events.flatMap((event) =>
      event.changes.filter((change) => change.field === "nr_pci"),
    );
    // One pair, and the direction is the sample order even though the list is
    // newest-first: from the PCI it left, to the PCI it came back on.
    expect(nrPci).toEqual([{ field: "nr_pci", from: "201", to: "305" }]);
  });

  test("a handover is one group with both fields", () => {
    const rows = [
      row(BASE),
      row(BASE + 60, { lte_pci: 342, lte_band: "B1" }),
    ];
    const events = cellEvents(rows);
    expect(events).toHaveLength(1);
    expect(events[0].changes.map((change) => change.field).sort()).toEqual([
      "lte_band",
      "lte_pci",
    ]);
  });

  test("newest first", () => {
    const rows = [
      row(BASE, { nr_avail: 1 }),
      row(BASE + 60, { nr_avail: 0 }),
      row(BASE + 120, { nr_avail: 1 }),
    ];
    const events = cellEvents(rows);
    expect(events[0].ts).toBe(BASE + 120);
    expect(events[1].ts).toBe(BASE + 60);
  });

  test("the first sample is a baseline, not a change", () => {
    expect(cellEvents([row(BASE)])).toHaveLength(0);
  });
});

describe("formatting", () => {
  test("a span reads in hours and minutes", () => {
    expect(formatSpan(0)).toBe("under a minute");
    expect(formatSpan(59)).toBe("under a minute");
    expect(formatSpan(720)).toBe("12 min");
    expect(formatSpan(3600)).toBe("1 h");
    expect(formatSpan(11_100)).toBe("3 h 5 min");
  });

  test("a percentage carries at most one decimal", () => {
    expect(formatPct(100)).toBe("100%");
    expect(formatPct(75)).toBe("75%");
    expect(formatPct(99.66)).toBe("99.7%");
    expect(formatPct(0.4)).toBe("0.4%");
  });
});
