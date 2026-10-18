import { describe, expect, it } from "bun:test";

import type { ModemStatus } from "@/types/modem-status";
import {
  createModemStatusStore,
  type ModemStatusEvent,
} from "./modem-status-store";

/** A fake clock plus interval scheduler the test advances by hand. */
function harness() {
  let nowMs = 1_000_000;
  let fetches = 0;
  let fail = false;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  let nextId = 1;

  const store = createModemStatusStore({
    fetchStatus: async () => {
      fetches += 1;
      if (fail) throw new Error("HTTP 502: Bad Gateway");
      return { timestamp: Math.floor(nowMs / 1000) } as ModemStatus;
    },
    now: () => nowMs,
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, ms, next: nowMs + ms });
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id as number);
    },
  });

  /** Let pending fetch promises settle. */
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  /** Advance the clock in 100 ms steps, firing due intervals and settling fetches. */
  const advance = async (ms: number) => {
    const end = nowMs + ms;
    while (nowMs < end) {
      nowMs += 100;
      for (const iv of Array.from(intervals.values())) {
        if (iv.next <= nowMs) {
          iv.next += iv.ms;
          iv.fn();
        }
      }
      await flush();
    }
  };

  return {
    store,
    flush,
    advance,
    fetches: () => fetches,
    activeIntervals: () => intervals.size,
    setFail: (v: boolean) => {
      fail = v;
    },
  };
}

function collector() {
  const events: ModemStatusEvent[] = [];
  return { events, listener: (e: ModemStatusEvent) => events.push(e) };
}

describe("modem status store", () => {
  it("runs one loop for two consumers at the fastest interval", async () => {
    const h = harness();
    const dash = collector();
    const side = collector();
    h.store.subscribe(2000, dash.listener);
    h.store.subscribe(15_000, side.listener);
    await h.flush();

    // Both mounts in the same tick share the one in-flight fetch.
    expect(h.fetches()).toBe(1);
    expect(dash.events.length).toBe(1);
    expect(side.events.length).toBe(1);
    expect(h.activeIntervals()).toBe(1);

    await h.advance(30_000);
    // 15 base ticks, not 15 + 2 from a second loop.
    expect(h.fetches()).toBe(16);
    expect(dash.events.length).toBe(16);
    // The slow consumer keeps its own cadence (every ~15 s).
    expect(side.events.length).toBe(3);
  });

  it("serves a late subscriber at once, then at its own cadence", async () => {
    const h = harness();
    const dash = collector();
    h.store.subscribe(2000, dash.listener);
    await h.flush();
    await h.advance(3000);

    const watchdog = collector();
    h.store.subscribe(5000, watchdog.listener);
    await h.flush();
    expect(watchdog.events.length).toBe(1);

    await h.advance(20_000);
    // Delivered within half a base tick of every 5 s: roughly every 4-6 s.
    expect(watchdog.events.length).toBeGreaterThanOrEqual(4);
    expect(watchdog.events.length).toBeLessThanOrEqual(6);
  });

  it("refresh delivers to the caller regardless of cadence", async () => {
    const h = harness();
    const side = collector();
    const sub = h.store.subscribe(15_000, side.listener);
    await h.flush();
    expect(side.events.length).toBe(1);

    sub.refresh();
    await h.flush();
    expect(side.events.length).toBe(2);
  });

  it("slows down and stops as consumers leave", async () => {
    const h = harness();
    const dash = h.store.subscribe(2000, () => {});
    const side = h.store.subscribe(15_000, () => {});
    await h.flush();

    dash.unsubscribe();
    const before = h.fetches();
    await h.advance(30_000);
    expect(h.fetches() - before).toBe(2);

    side.unsubscribe();
    expect(h.activeIntervals()).toBe(0);
    expect(h.store.subscriberCount()).toBe(0);
  });

  it("reports errors and staleness per landed response", async () => {
    const h = harness();
    const dash = collector();
    h.store.subscribe(2000, dash.listener);
    await h.flush();
    expect(dash.events[0]).toMatchObject({ kind: "data", isStale: false });

    h.setFail(true);
    await h.advance(2000);
    expect(dash.events.at(-1)).toEqual({
      kind: "error",
      message: "HTTP 502: Bad Gateway",
    });
  });
});
