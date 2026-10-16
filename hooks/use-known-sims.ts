"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/known_sims.sh";

/** Envelope returned by both the GET and the clear POST. */
interface KnownSimsResponse {
  success: boolean;
  count: number;
  error?: string;
  detail?: string;
}

/** Outcome of a clear, detailed enough for the caller to tell the truth. */
export interface ClearKnownSimsResult {
  ok: boolean;
  /** The device's reason, already translated. Absent on success. */
  message?: string;
}

export interface UseKnownSimsReturn {
  /**
   * How many SIMs the device will not flag as new, or `null` when no read has
   * succeeded. A failed GET is silent here, so without the null a swallowed
   * failure is indistinguishable from a genuine zero.
   */
  count: number | null;
  isLoading: boolean;
  isClearing: boolean;
  refresh: () => Promise<void>;
  clear: () => Promise<ClearKnownSimsResult>;
}

/**
 * Reads and clears the known-SIMs set: the "is this SIM new" membership store.
 * Clearing keeps the SIM that is inserted right now, so the active SIM is never
 * re-flagged as new.
 *
 * The count is small and changes only on SIM insertion or an explicit clear,
 * so this fetches on mount rather than polling.
 */
export function useKnownSims(): UseKnownSimsReturn {
  const { t } = useTranslation("errors");
  const [count, setCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return;
      setCount(json.success ? (json.count ?? null) : null);
    } catch {
      // A failed re-read drops to unknown rather than stranding a stale number.
      if (mountedRef.current) setCount(null);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = useCallback(async (): Promise<ClearKnownSimsResult> => {
    setIsClearing(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: KnownSimsResponse = await resp.json();
      if (!mountedRef.current) return { ok: false };

      if (!json.success) {
        const message = resolveErrorMessage(t, json.error, json.detail, "");
        return { ok: false, message: message || undefined };
      }

      setCount(json.count ?? null);
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      if (mountedRef.current) setIsClearing(false);
    }
  }, [t]);

  return { count, isLoading, isClearing, refresh, clear };
}
