import { afterEach, describe, expect, mock, test } from "bun:test";

import type { CellHistorySuccess } from "@/types/cell-history";

// =============================================================================
// Cell History — the page renders in all four states
// =============================================================================
// The states a data surface must never get wrong are the ones with nothing to
// draw: a failed read, an empty record, and the first paint before any answer.
// Each shipped as a blank page somewhere in this product before, and a blank page
// on a history surface reads as "5G never dropped" — the inversion of the truth.
//
// This renders the real page component to static markup with the fetch hook and
// i18n stubbed. It proves structure, not pixels: that the empty record states
// itself instead of drawing an empty strip, that a failed read offers a retry,
// and that a record with an outage and a cell change renders every card.
// =============================================================================

// The hook is the only thing that touches the network; everything below it is the
// component tree this test is about.
let hookResult: {
  data: CellHistorySuccess | null;
  dataRange: "24h" | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

const realI18n = await import("react-i18next");

mock.module("@/hooks/use-cell-history", () => ({
  useCellHistory: () => hookResult,
}));

// `t` returns the key so the assertions can name the state they expect, and the
// ICU plural is resolved roughly (the copy itself is exercised by i18n:check).
mock.module("react-i18next", () => ({
  ...realI18n,
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (values && typeof values === "object") {
        const pairs = Object.entries(values)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",");
        return `${key}(${pairs})`;
      }
      return key;
    },
  }),
}));

const { renderToStaticMarkup } = await import("react-dom/server");
const { CellHistory } = await import("./history");

const BASE = 1_792_530_000;

function payload(rows: CellHistorySuccess["rows"]): CellHistorySuccess {
  return {
    success: true,
    view: "cells",
    range: "24h",
    generated_at: BASE + 3600,
    interval_sec: 60,
    sane_epoch: true,
    window_end: rows.length > 0 ? rows[rows.length - 1].ts : BASE + 3600,
    rows,
  };
}

const row: CellHistorySuccess["rows"][number] = {
  ts: BASE,
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
};

function render(): string {
  return renderToStaticMarkup(<CellHistory />);
}

afterEach(() => {
  hookResult = {
    data: null,
    dataRange: null,
    isLoading: true,
    error: null,
    refresh: () => {},
  };
});

describe("CellHistory page", () => {
  test("first paint: the header is real, the cards are skeletons", () => {
    hookResult = {
      data: null,
      dataRange: null,
      isLoading: true,
      error: null,
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.page.title");
    // aria-hidden skeleton wrapper, and no card content yet.
    expect(html).toContain("aria-hidden");
    expect(html).not.toContain("history.availability.title");
  });

  test("failed first read: a condition screen with a retry, not a blank page", () => {
    hookResult = {
      data: null,
      dataRange: null,
      isLoading: false,
      error: "HTTP 500",
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.error.title");
    expect(html).toContain("history.refresh");
    // The raw error text is diagnostic and must never be rendered.
    expect(html).not.toContain("HTTP 500");
  });

  test("no rows yet: the empty record states itself", () => {
    hookResult = {
      data: payload([]),
      dataRange: "24h",
      isLoading: false,
      error: null,
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.empty.title");
    // No availability strip: an empty strip reads as "no 5G".
    expect(html).not.toContain("history.availability.strip_aria");
  });

  test("a clock that is not set says so instead of showing an empty window", () => {
    hookResult = {
      data: { ...payload([]), sane_epoch: false },
      dataRange: "24h",
      isLoading: false,
      error: null,
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.clock.title");
    expect(html).not.toContain("history.empty.title");
  });

  test("rows with an outage and a cell change render every card", () => {
    const rows = [
      { ...row, ts: BASE, nr_avail: null as const },
      { ...row, ts: BASE + 60, nr_avail: 0 as const },
      { ...row, ts: BASE + 120, nr_avail: 0 as const },
      { ...row, ts: BASE + 180, nr_avail: 1 as const, lte_pci: 342, nr_pci: 305 },
      { ...row, ts: BASE + 240, nr_avail: 1 as const, lte_pci: 342, nr_pci: 305 },
    ];
    hookResult = {
      data: payload(rows),
      dataRange: "24h",
      isLoading: false,
      error: null,
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.availability.title");
    expect(html).toContain("history.availability.strip_aria");
    expect(html).toContain("history.timeline.title");
    expect(html).toContain("history.events.title");
    // Both cells in the table, and the change from 123 to 342.
    expect(html).toContain(">123<");
    expect(html).toContain(">342<");
    expect(html).toContain("history.events.field.lte_pci");
    // The outage is reported, so the "no outage" sentence must be absent.
    expect(html).not.toContain("history.availability.no_outage");
  });

  test("a stale read keeps the cards and says they are not updating", () => {
    hookResult = {
      data: payload([row]),
      dataRange: "24h",
      isLoading: false,
      error: "HTTP 500",
      refresh: () => {},
    };
    const html = render();
    expect(html).toContain("history.stale.title");
    expect(html).toContain("history.availability.title");
  });
});
