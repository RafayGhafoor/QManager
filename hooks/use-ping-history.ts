"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import type {
  PingHistoryRange,
  PingHistoryRanged,
  PingHistoryRangedResponse,
} from "@/types/ping-history";

// =============================================================================
// usePingHistory — the persisted ping archive, one range at a time
// =============================================================================
// Reads `fetch_ping_history.sh?range=` for the Connection Quality full view.
// This is the ranged form of the same CGI the dashboard strips use without a
// query; it reads a file on the CGI side, so nothing here holds a lease.
//
// Three rules, the same ones `use-cell-history.ts` carries:
//
//  1. ONLY WHILE WANTED. `enabled` is the dialog's `open`. A closed dialog
//     reads nothing and keeps no timer; the archive gains one row a minute, so
//     60 s is already eager.
//  2. ONLY THE NEWEST REQUEST MAY LAND. A 7d read is far more work than a 1h
//     read, so a range switch can land them out of order and paint the old
//     range under the new range's pill. Every fetch takes a sequence number and
//     drops itself if a newer one started, and it must not clear the newer
//     request's loading flag either.
//  3. A HIDDEN TAB READS NOTHING. Becoming visible reads once at once (the
//     answer aged while the tab was away) and then resumes the cadence.
//
// `dataRange` exists because `range` changes before the answer does: anything
// that decides what to draw from the payload keys on `dataRange`, never on
// `range`, or the moment between picking a range and its first answer would
// render the old range's points under the new range's label.
//
// Usage:
//   const { data, dataRange, isLoading, error, refresh } =
//     usePingHistory(range, { enabled: open });
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_ping_history.sh";

/** The archive gains one row a minute; 60 s is already eager. */
const POLL_MS = 60_000;

export interface UsePingHistoryOptions {
  /** Whether reading is wanted at all (default true). Pass the dialog's `open`. */
  enabled?: boolean;
}

export interface UsePingHistoryReturn {
  /** The newest answer; null until the first read lands. */
  data: PingHistoryRanged | null;
  /** The range `data` was read for; it lags `range` until the new read lands. */
  dataRange: PingHistoryRange | null;
  /** True while a read is in flight and nothing has landed yet for it. */
  isLoading: boolean;
  /** The failed read's own message — diagnostic, never rendered raw. */
  error: string | null;
  /** Read now, for the current range. */
  refresh: () => void;
}

export function usePingHistory(
  range: PingHistoryRange,
  options: UsePingHistoryOptions = {},
): UsePingHistoryReturn {
  const { enabled = true } = options;

  const [data, setData] = useState<PingHistoryRanged | null>(null);
  const [dataRange, setDataRange] = useState<PingHistoryRange | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const rangeRef = useRef(range);

  const fetchRange = useCallback(async (next: PingHistoryRange) => {
    const seq = ++seqRef.current;
    setIsLoading(true);
    try {
      const res = await authFetch(`${ENDPOINT}?range=${next}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PingHistoryRangedResponse | unknown[];
      // A superseded request must not touch the state of the one in flight.
      if (!mountedRef.current || seq !== seqRef.current) return;
      // An older backend ignores `range` and answers with the bare 10 s ring.
      if (Array.isArray(json)) throw new Error("Ranged history is not available");
      if (!json.success) throw new Error(json.message ?? json.error);

      setData(json);
      setDataRange(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read the history");
    } finally {
      if (mountedRef.current && seq === seqRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A range change, or the dialog opening, reads once. A hidden tab leaves the
  // read to the visibility handler below.
  useEffect(() => {
    rangeRef.current = range;
    if (!enabled) return;
    if (document.visibilityState !== "visible") return;
    void fetchRange(range);
  }, [range, enabled, fetchRange]);

  useEffect(() => {
    if (!enabled) return;

    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const start = () => {
      if (id === null) {
        id = window.setInterval(() => void fetchRange(rangeRef.current), POLL_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchRange(rangeRef.current);
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [enabled, fetchRange]);

  const refresh = useCallback(() => {
    void fetchRange(rangeRef.current);
  }, [fetchRange]);

  return { data, dataRange, isLoading, error, refresh };
}
