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
  bandCombos,
  bandRsrpSeries,
  bandRuns,
  cellEvents,
  cellStats,
  formatPct,
  formatSpan,
  hourTicks,
  isWindowShort,
  metricSeries,
  newestSample,
  nrOutages,
  outageRows,
  patternRows,
  servingRuns,
  timelineSegments,
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

// --- The panels the parity port added ----------------------------------------

/** A window of `span` seconds ending at `BASE`, built the way `windowOf` builds it. */
function win(start: number, end: number) {
  return { start, end, samples: 0, first_ts: null, last_ts: null };
}

describe("hourTicks", () => {
  test("lands on local hour boundaries and thins to at most seven", () => {
    // Local midnight, so the assertion does not depend on the test machine's zone.
    const start = new Date(2025, 0, 5, 0, 0, 0).getTime() / 1000;
    const ticks = hourTicks(win(start, start + 86_400));
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(7);
    for (const tick of ticks) {
      expect(new Date(tick.ts * 1000).getMinutes()).toBe(0);
    }
    // The first tick IS the window start (the left edge), and the last one is
    // the closing hour boundary (the right edge).
    expect(ticks[0].leftPct).toBe(0);
    expect(ticks[ticks.length - 1].leftPct).toBe(100);
  });

  test("a window with no span has no ticks", () => {
    expect(hourTicks(win(BASE, BASE))).toEqual([]);
  });
});

describe("patternRows", () => {
  const start = new Date(2025, 0, 5, 0, 0, 0).getTime() / 1000;
  const window = win(start, start + 86_400);

  test("one row per local day the window covers, 24 hours each", () => {
    const rows = patternRows([], window);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("01-05");
    expect(rows[0].cells).toHaveLength(24);
    expect(rows[0].cells[0].n).toBe(0);
  });

  test("a bucket lands in its own local hour, not in UTC", () => {
    const buckets = [
      { ts: new Date(2025, 0, 5, 3, 20, 0).getTime() / 1000, n: 4, up: 1 },
    ];
    const rows = patternRows(buckets, window);
    expect(rows[0].cells[3]).toMatchObject({ n: 4, up: 1 });
    expect(rows[0].cells[0].n).toBe(0);
  });

  test("a day whose every hour is unknown still gets its row", () => {
    const rows = patternRows([], window);
    expect(rows.map((row) => row.key)).toHaveLength(2);
  });
});

describe("bandRuns", () => {
  test("the serving carrier and the NR leg read as one set", () => {
    const runs = bandRuns([row(BASE), row(BASE + 60)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].bands).toBe("B3+N78");
    expect(runs[0].samples).toBe(2);
  });

  test("the NR leg dropping is its own run, with the LTE band alone", () => {
    const runs = bandRuns([
      row(BASE),
      row(BASE + 60, { nr_band: null, nr_pci: null, nr_avail: 0 }),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[1].bands).toBe("B3");
  });

  test("a gap cuts the set rather than holding it across the hole", () => {
    const runs = bandRuns([row(BASE), row(BASE + GAP_THRESHOLD_SECONDS + 600)]);
    expect(runs).toHaveLength(2);
  });

  test("a row with no band at all is a null set, not an invented letter", () => {
    const runs = bandRuns([row(BASE, { lte_band: null, nr_band: null })]);
    expect(runs[0].bands).toBeNull();
  });

  test("time share per set, most samples first", () => {
    const rows = [
      row(BASE),
      row(BASE + 60),
      row(BASE + 120, { nr_band: null, nr_pci: null, nr_avail: 0 }),
    ];
    const combos = bandCombos(bandRuns(rows));
    expect(combos[0].bands).toBe("B3+N78");
    expect(combos[0].samples).toBe(2);
    expect(combos[1].bands).toBe("B3");
    expect(combos[1].first_ts).toBe(BASE + 120);
  });
});

describe("outageRows", () => {
  test("the serving cell is read off the run that covers the outage", () => {
    const rows = [
      row(BASE, { lte_pci: 104 }),
      row(BASE + 60, { lte_pci: 104, nr_avail: 0, nr_band: null, nr_pci: null }),
      row(BASE + 120, { lte_pci: 104, nr_avail: 0, nr_band: null, nr_pci: null }),
    ];
    const shapes = outageRows(nrOutages(rows), servingRuns(rows));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].ltePci).toBe(104);
    expect(shapes[0].lteBand).toBe("B3");
    expect(shapes[0].uncovered).toBe(false);
    expect(shapes[0].seconds).toBe(60);
  });

  test("no run covering the span says so instead of naming a cell", () => {
    const outages = [{ start_ts: BASE, end_ts: BASE + 60, samples: 2 }];
    const [shape] = outageRows(outages, []);
    expect(shape.uncovered).toBe(true);
    expect(shape.ltePci).toBeNull();
  });

  test("newest first", () => {
    const outages = [
      { start_ts: BASE, end_ts: BASE + 60, samples: 2 },
      { start_ts: BASE + 600, end_ts: BASE + 660, samples: 2 },
    ];
    expect(outageRows(outages, [])[0].startTs).toBe(BASE + 600);
  });
});

describe("metricSeries", () => {
  const window = win(BASE, BASE + 3600);

  test("a bucket holds the mean of its readings", () => {
    const series = metricSeries(
      [row(BASE + 60, { rsrp: -90 }), row(BASE + 120, { rsrp: -80 })],
      "rsrp",
      window,
      600,
    );
    expect(series[0].v).toBe(-85);
  });

  test("a bucket with no reading stays null, never 0", () => {
    const series = metricSeries([row(BASE + 60, { rsrp: null })], "rsrp", window, 600);
    expect(series[0].v).toBeNull();
  });

  test("the series covers the whole window, holes included", () => {
    const series = metricSeries([row(BASE + 60)], "sinr", window, 600);
    expect(series).toHaveLength(7);
    expect(series.filter((point) => point.v !== null)).toHaveLength(1);
  });
});

describe("bandRsrpSeries", () => {
  const window = win(BASE, BASE + 3600);

  test("one series per band the device served on", () => {
    const rows = [
      row(BASE + 60, { lte_band: "B3", rsrp: -90 }),
      row(BASE + 120, { lte_band: "B1", rsrp: -110 }),
    ];
    const series = bandRsrpSeries(rows, window, 600);
    expect(Object.keys(series).sort()).toEqual(["B1", "B3"]);
    expect(series["B3"][0].v).toBe(-90);
    expect(series["B1"][0].v).toBe(-110);
  });

  test("a row with no band is not plotted under an invented key", () => {
    const series = bandRsrpSeries([row(BASE + 60, { lte_band: null })], window, 600);
    expect(Object.keys(series)).toHaveLength(0);
  });
});

describe("newestSample", () => {
  test("the newest row wins even when the payload is out of order", () => {
    const sample = newestSample([row(BASE + 120), row(BASE)]);
    expect(sample?.as_of).toBe(BASE + 120);
  });

  test("an empty range has no sample", () => {
    expect(newestSample([])).toBeNull();
  });
});

describe("timelineSegments", () => {
  const window = win(BASE, BASE + 3600);

  test("a run becomes a positioned segment", () => {
    const [segment] = timelineSegments(
      servingRuns([row(BASE), row(BASE + 60)]),
      window,
    );
    expect(segment.leftPct).toBe(0);
    // One minute of an hour is a sixtieth of the track.
    expect(Math.round(segment.widthPct)).toBe(2);
  });

  test("a one-minute run keeps a visible floor width", () => {
    const [segment] = timelineSegments(
      servingRuns([row(BASE + 600), row(BASE + 660)]),
      win(BASE, BASE + 86_400),
    );
    expect(segment.widthPct).toBeGreaterThanOrEqual(0.5);
  });

  test("a run outside the window draws nothing", () => {
    const runs = servingRuns([row(BASE - 7200)]);
    expect(timelineSegments(runs, window)).toHaveLength(0);
  });
});
