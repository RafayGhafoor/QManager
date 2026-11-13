"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/auth-fetch";
import {
  isCellHistoryFailure,
  type CellHistoryRange,
  type CellHistoryResponse,
  type CellHistorySuccess,
} from "@/types/cell-history";

// =============================================================================
// useCellHistory — one ranged read of the archived serving cell
// =============================================================================
// Reads `fetch_signal_history.sh?view=cells&range=`. Three rules, each of which
// has already broken a surface in this product:
//
//  1. ONLY THE NEWEST REQUEST MAY LAND. A 24 h read is many times the work of a
//     1 h read, so a range switch can land them out of order and paint the old
//     range's rows under the new range's pill. Every fetch takes a sequence
//     number and drops itself if a newer one started — it must not even clear
//     the newer request's loading flag.
//  2. A HIDDEN TAB READS NOTHING. The archive gains one row a minute, so 30 s is
//     already eager; there is no reason for a backgrounded tab to spend the
//     device's only core on a page nobody is looking at. Becoming visible reads
//     once at once (the answer aged while the tab was hidden), then resumes.
//  3. `dataRange` LAGS `range`. Anything that reads the payload's SHAPE keys on
//     `dataRange`, never on `range`: the moment between selecting a range and
//     its first answer would otherwise price a 24 h payload against the 1 h just
//     selected.
//
// There is no `now` range and no live row here. The dashboard is the live
// surface; this page reads a range, and a live strip above range cards
// disagrees with them the moment the range's last row is a minute old
// (`docs/reference/latency-monitor.md`).
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/at_cmd/fetch_signal_history.sh";

/** One archived row a minute; 30 s is already eager. */
const RANGE_POLL_MS = 30_000;

export interface UseCellHistoryReturn {
  data: CellHistorySuccess | null;
  /** The range `data` was read for; it lags `range` until the new read lands. */
  dataRange: CellHistoryRange | null;
  isLoading: boolean;
  /** The failed read's own message — diagnostic, never rendered raw. */
  error: string | null;
  refresh: () => void;
}

export function useCellHistory(range: CellHistoryRange): UseCellHistoryReturn {
  const [data, setData] = useState<CellHistorySuccess | null>(null);
  const [dataRange, setDataRange] = useState<CellHistoryRange | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const rangeRef = useRef(range);

  const fetchRange = useCallback(async (next: CellHistoryRange) => {
    const seq = ++seqRef.current;
    try {
      const res = await authFetch(`${ENDPOINT}?view=cells&range=${next}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as CellHistoryResponse;
      // A superseded request must not touch the state of the one in flight.
      if (!mountedRef.current || seq !== seqRef.current) return;
      if (isCellHistoryFailure(json)) throw new Error(json.detail ?? json.error);

      setData(json);
      setDataRange(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setError(err instanceof Error ? err.message : "history_read_failed");
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

  useEffect(() => {
    rangeRef.current = range;
    // A hidden tab leaves the read to the visibility handler, so selecting a
    // range in a background tab starts nothing.
    if (document.visibilityState !== "visible") return;
    void fetchRange(range);
  }, [range, fetchRange]);

  useEffect(() => {
    let id: number | null = null;
    const stop = () => {
      if (id !== null) window.clearInterval(id);
      id = null;
    };
    const start = () => {
      if (id === null) {
        id = window.setInterval(
          () => void fetchRange(rangeRef.current),
          RANGE_POLL_MS,
        );
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
  }, [fetchRange]);

  const refresh = useCallback(() => {
    void fetchRange(rangeRef.current);
  }, [fetchRange]);

  return { data, dataRange, isLoading, error, refresh };
}
