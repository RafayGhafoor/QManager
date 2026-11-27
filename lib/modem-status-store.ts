import type { ModemStatus } from "@/types/modem-status";

// =============================================================================
// Modem status store — one shared poll of fetch_data.sh (ledger B5.28)
// =============================================================================
// Every `useModemStatus()` instance used to run its own interval, so a page
// fetched the same cached JSON once per mounted consumer: the dashboard (2 s)
// plus the sidebar watchdog indicator (15 s) on every page, three instances on
// the Watchdog page, and so on. This store runs ONE loop for all of them.
//
//   - The loop ticks at the FASTEST subscriber's interval. Its phase is that
//     subscriber's: the dashboard's tier-aligned interval (poller cycle plus a
//     write buffer) still lands just after each daemon write.
//   - Each subscriber is handed a result only at its OWN cadence (within half
//     a base tick), so a 15 s consumer still re-renders about every 15 s and
//     sees errors and staleness on the same schedule as before.
//   - Subscribing, or refresh(), fetches at once and delivers that result to
//     the caller regardless of cadence, as the per-instance hook did on mount.
//     Requests never overlap: a fetch already in flight serves the caller.
//   - The loop PAUSES while the tab is hidden (known-issues 15). Every request
//     refreshes the router's UI heartbeat, so a backgrounded dashboard kept the
//     poller pinned in its `active` tier and its backoff never engaged. Hiding
//     clears the interval; becoming visible fetches at once and restarts it.
//     The store watches visibility itself - one listener for the whole app, on
//     while anyone is subscribed - so the number of consumers cannot multiply it.
//     Subscribers keep the last data they were handed, so a pause shows stale
//     data, not a blank. A subscriber that mounts in a hidden tab still gets one
//     read so it has something to show.
//
// The store keeps no snapshot of its own. Each hook instance holds its last
// data, so an error keeps showing the data that instance had, as before.
// =============================================================================

/** After this many seconds without a fresh timestamp, data is "stale". */
export const STALE_THRESHOLD_SECONDS = 10;

export type ModemStatusEvent =
  | { kind: "data"; data: ModemStatus; receivedAtMs: number; isStale: boolean }
  | { kind: "error"; message: string };

export interface ModemStatusSubscription {
  /** Fetch now and deliver the result to this subscriber. */
  refresh: () => void;
  unsubscribe: () => void;
}

export interface ModemStatusStoreDeps {
  fetchStatus: () => Promise<ModemStatus>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /**
   * Page visibility. Omit to poll unconditionally (tests, non-browser hosts).
   * `onChange` returns its own unsubscribe.
   */
  visibility?: {
    isHidden: () => boolean;
    onChange: (listener: () => void) => () => void;
  };
}

interface Subscriber {
  intervalMs: number;
  listener: (event: ModemStatusEvent) => void;
  /** When this subscriber last received an event; null = never. */
  lastDeliveredMs: number | null;
  /** Deliver the next result regardless of cadence (mount or refresh). */
  force: boolean;
}

export function createModemStatusStore(deps: ModemStatusStoreDeps) {
  const subscribers = new Set<Subscriber>();
  let timer: unknown = null;
  let timerIntervalMs: number | null = null;
  let inFlight = false;
  let paused = false;
  let stopWatchingVisibility: (() => void) | null = null;

  const baseInterval = (): number | null => {
    let min: number | null = null;
    for (const s of subscribers) {
      if (min === null || s.intervalMs < min) min = s.intervalMs;
    }
    return min;
  };

  const deliver = (event: ModemStatusEvent) => {
    const nowMs = deps.now();
    const base = baseInterval() ?? 0;
    // Results land once per base tick, so a subscriber whose interval is not a
    // multiple of it is served at the first tick within half a tick of due.
    const slack = base / 2;
    for (const s of Array.from(subscribers)) {
      const due =
        s.force ||
        s.lastDeliveredMs === null ||
        nowMs - s.lastDeliveredMs + slack >= s.intervalMs;
      if (!due) continue;
      s.force = false;
      s.lastDeliveredMs = nowMs;
      s.listener(event);
    }
  };

  const fetchNow = async () => {
    if (inFlight) return;
    inFlight = true;
    let event: ModemStatusEvent;
    try {
      const data = await deps.fetchStatus();
      // One clock read per landed response, shared by the arrival time and the
      // staleness check. The modem stamps `timestamp`; the 10 s threshold
      // absorbs the drift between its clock and the browser's.
      const receivedAtMs = deps.now();
      const age = Math.floor(receivedAtMs / 1000) - data.timestamp;
      event = {
        kind: "data",
        data,
        receivedAtMs,
        isStale: age > STALE_THRESHOLD_SECONDS,
      };
    } catch (err) {
      event = {
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to fetch modem status",
      };
    } finally {
      inFlight = false;
    }
    deliver(event);
  };

  /** Keep the loop at the fastest subscriber's interval; stop it when none are left. */
  const reschedule = () => {
    const base = paused ? null : baseInterval();
    if (base === timerIntervalMs) return;
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    timerIntervalMs = base;
    if (base !== null) timer = deps.setInterval(() => void fetchNow(), base);
  };

  /** Pause on hidden, resume with an immediate read on visible. */
  const syncVisibility = () => {
    const hidden = deps.visibility?.isHidden() ?? false;
    if (hidden === paused) return;
    paused = hidden;
    reschedule();
    if (!paused && subscribers.size > 0) void fetchNow();
  };

  const startWatchingVisibility = () => {
    if (stopWatchingVisibility || !deps.visibility) return;
    stopWatchingVisibility = deps.visibility.onChange(syncVisibility);
    // Anything subscribing in a hidden tab starts paused.
    paused = deps.visibility.isHidden();
  };

  const stopWatching = () => {
    stopWatchingVisibility?.();
    stopWatchingVisibility = null;
    paused = false;
  };

  const subscribe = (
    intervalMs: number,
    listener: (event: ModemStatusEvent) => void,
  ): ModemStatusSubscription => {
    const sub: Subscriber = {
      intervalMs,
      listener,
      lastDeliveredMs: null,
      force: true,
    };
    subscribers.add(sub);
    startWatchingVisibility();
    reschedule();
    void fetchNow();

    return {
      refresh: () => {
        if (!subscribers.has(sub)) return;
        sub.force = true;
        void fetchNow();
      },
      unsubscribe: () => {
        if (!subscribers.delete(sub)) return;
        if (subscribers.size === 0) stopWatching();
        reschedule();
      },
    };
  };

  return {
    subscribe,
    /** Test hook: how many consumers share the loop. */
    subscriberCount: () => subscribers.size,
    /** Test hook: is the loop paused for a hidden tab? */
    isPaused: () => paused,
  };
}

export type ModemStatusStore = ReturnType<typeof createModemStatusStore>;
