"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { StorageResponse } from "@/types/data-used";

// =============================================================================
// useStorage: usage of the modem's writable volume (ledger B5.22)
// =============================================================================
// GET /cgi-bin/quecmanager/system/storage.sh, polled every 30 s (one df per
// request; storage moves slowly). `data` is null until read or when df failed.
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/storage.sh";
const POLL_MS = 30_000;

export interface StorageUsage {
  totalKb: number;
  usedKb: number;
}

export function useStorage(): { data: StorageUsage | null; isLoading: boolean } {
  const [data, setData] = useState<StorageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const resp = await authFetch(ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: StorageResponse = await resp.json();
      if (!mountedRef.current) return;
      const s = json.success ? json.storage : null;
      setData(
        s && s.total_kb > 0 ? { totalKb: s.total_kb, usedKb: s.used_kb } : null,
      );
    } catch {
      // Keep the last value; the next poll retries.
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    const id = window.setInterval(() => void fetchData(), POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [fetchData]);

  return { data, isLoading };
}
