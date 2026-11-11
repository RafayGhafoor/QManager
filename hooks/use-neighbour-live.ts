"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type { NeighbourCellResult } from "@/types/cell-scanner";

// =============================================================================
// Live neighbour cells — the 1 Hz transport
// =============================================================================
// One-shot reads are `useNeighbourScanner`; this is the continuous mode. They are
// separate hooks on purpose (same reasoning as the neighbour/cell split): a live
// view has a lifetime measured in minutes and a 1 s cadence, a one-shot has a
// running -> complete transition and a toast.
//
// The backend is a resident reader (`qmanager_neighbour_scanner --live`) that
// rewrites an already-JSON array once a second, so a poll here is a file read:
// measured 42 ms and 1134 bytes per frame (change 27).
//
// THE READER MUST NOT OUTLIVE THE PAGE. Three mechanisms, in order of speed:
//   1. unmount / `pagehide` -> sendBeacon(stop). Fire-and-forget, survives the
//      tab closing; this is what "stop when the page is removed" means.
//   2. `visibilitychange` hidden -> polling pauses, so the reader's own idle
//      stop (10 s) retires it. A tab left open in the background buys nothing
//      from the AT channel, so it should not keep paying for it.
//   3. the reader's idle stop, as the backstop for a killed tab or a lost beacon.
// =============================================================================

const POLL_MS = 1000;
/** Older than this and the table is marked stale rather than being trusted. */
const STALE_MS = 4000;
/** Consecutive poll failures before the live view reports an error. */
const MAX_FAILURES = 5;

const STATUS_URL = "/cgi-bin/quecmanager/at_cmd/neighbour_scan_status.sh";
const START_URL = "/cgi-bin/quecmanager/at_cmd/neighbour_scan_start.sh?live=1";
const STOP_URL = "/cgi-bin/quecmanager/at_cmd/neighbour_live_stop.sh";

export interface NeighbourLive {
  enabled: boolean;
  cells: NeighbourCellResult[];
  /** Age of the newest frame in ms, or null before the first one arrives. */
  ageMs: number | null;
  /** A frame exists but is older than STALE_MS. */
  stale: boolean;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

interface StatusResponse {
  status?: string;
  live?: boolean;
  scanned_at?: number;
  age_ms?: number;
  results?: NeighbourCellResult[];
  message?: string;
}

export function useNeighbourLive(): NeighbourLive {
  const [enabled, setEnabled] = useState(false);
  const [cells, setCells] = useState<NeighbourCellResult[]>([]);
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(false);
  const failuresRef = useRef(0);
  // The latest poll fn, so the interval never calls a stale closure (the bug that
  // bit `useNeighbourScanner` before its `pollStatusRef` was added).
  const pollRefFn = useRef<() => Promise<void>>(null!);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /**
   * Tell the backend to stop the reader. `sendBeacon` is deliberate: it is the
   * only request that reliably leaves the browser during unmount/pagehide, and a
   * plain fetch is routinely dropped. Same-origin, so the session cookie rides
   * along.
   */
  const stopReader = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(STOP_URL);
      return;
    }
    // No beacon (very old browser): best effort.
    void authFetch(STOP_URL, { method: "POST" }).catch(() => {});
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await authFetch(`${STATUS_URL}?_t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: StatusResponse = await res.json();
      failuresRef.current = 0;

      if (data.status === "complete" && Array.isArray(data.results)) {
        setCells(data.results);
        setError(null);
        // Prefer the server's own age: it is measured against the frame's
        // timestamp, so client clock skew cannot make a fresh frame look stale.
        const age =
          typeof data.age_ms === "number"
            ? data.age_ms
            : typeof data.scanned_at === "number"
              ? Math.max(0, Date.now() - data.scanned_at * 1000)
              : 0;
        setAgeMs(age);
        setStale(age > STALE_MS);
        return;
      }

      if (data.status === "error") {
        setError(data.message ?? "live_unavailable");
        return;
      }

      // "running" — the reader exists but has not published a frame yet.
      // Keep the previous frame; just let its age grow, which is honest.
      setAgeMs((prev) => (prev === null ? null : prev + POLL_MS));
    } catch {
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_FAILURES) {
        setError("live_unreachable");
        // Stop polling a surface that cannot answer, but leave the reader to its
        // idle stop: re-arming by hand is one click.
        clearPoll();
      }
    }
  }, [clearPoll]);

  pollRefFn.current = poll;

  const armPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void pollRefFn.current();
    }, POLL_MS);
  }, []);

  const stop = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    clearPoll();
    stopReader();
    setAgeMs(null);
    setStale(false);
    setError(null);
    failuresRef.current = 0;
  }, [clearPoll, stopReader]);

  const toggle = useCallback(async () => {
    if (enabledRef.current) {
      stop();
      return;
    }
    enabledRef.current = true;
    setEnabled(true);
    setError(null);
    failuresRef.current = 0;
    try {
      // Attaching is fine: the backend returns `attached: true` when a reader is
      // already running, and its own singleton means this can never start a
      // second 1 Hz AT reader.
      await authFetch(START_URL, { method: "POST" });
    } catch {
      setError("live_start_failed");
      enabledRef.current = false;
      setEnabled(false);
      return;
    }
    armPoll();
    void poll();
  }, [armPoll, poll, stop]);

  // Pause on hidden, resume on visible. The reader's 10 s idle stop retires it
  // while the tab is in the background; resuming re-attaches (or restarts it).
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearPoll();
        return;
      }
      void authFetch(START_URL, { method: "POST" }).catch(() => {});
      armPoll();
      void pollRefFn.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [enabled, armPoll, clearPoll]);

  // Page removal: stop the reader. `pagehide` covers tab close and navigation;
  // the effect cleanup covers leaving the route inside the app.
  useEffect(() => {
    if (!enabled) return;
    const onPageHide = () => stopReader();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      stopReader();
    };
  }, [enabled, stopReader]);

  // Unmount must never leave the interval armed.
  useEffect(() => clearPoll, [clearPoll]);

  return { enabled, cells, ageMs, stale, error, toggle, stop };
}
