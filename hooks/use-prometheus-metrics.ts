"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  MetricsFreshness,
  PrometheusStatusResponse,
} from "@/types/prometheus-metrics";

// =============================================================================
// usePrometheusMetrics — settings for the Prometheus scrape endpoint
// =============================================================================
// GET on mount, then a silent re-read every 15 s while the tab is visible, so
// the card's "Last scrape" and "Holding polling" facts stay honest without a
// reload. Mutators RETURN their outcome (reason already translated through
// `resolveErrorMessage`) so the card toasts from the result, never from hook
// state read after an `await`.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/prometheus.sh";
const POLL_INTERVAL_MS = 15_000;

export interface PrometheusMutationResult {
  success: boolean;
  /** Translated reason; absent on success or when the backend gave none. */
  message?: string;
}

export interface UsePrometheusMetricsReturn {
  data: PrometheusStatusResponse | null;
  isLoading: boolean;
  /** Load failure only; mutations report through their return value. */
  error: string | null;
  isSaving: boolean;
  isRegenerating: boolean;
  refresh: () => void;
  save: (
    enabled: boolean,
    freshness: MetricsFreshness,
  ) => Promise<PrometheusMutationResult>;
  regenerateToken: () => Promise<PrometheusMutationResult>;
}

export function usePrometheusMetrics(): UsePrometheusMetricsReturn {
  const { t } = useTranslation("errors");
  const [data, setData] = useState<PrometheusStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT);
        const body = (await resp.json()) as PrometheusStatusResponse;
        if (!mountedRef.current) return;
        if (!body.success || !body.settings) {
          // A silent re-read keeps the last good view rather than flashing an
          // error over a card the user may be editing.
          if (!silent) {
            setError(
              resolveErrorMessage(t, body.error, body.detail, t("unknown")),
            );
          }
          return;
        }
        setData(body);
        setError(null);
      } catch {
        if (mountedRef.current && !silent) setError(t("unknown"));
      } finally {
        if (mountedRef.current && !silent) setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchStatus(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<PrometheusMutationResult> => {
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = (await resp.json()) as PrometheusStatusResponse;
        if (!result.success || !result.settings) {
          const message = resolveErrorMessage(
            t,
            result.error,
            result.detail,
            "",
          );
          return { success: false, message: message || undefined };
        }
        if (mountedRef.current) {
          setData(result);
          setError(null);
        }
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    [t],
  );

  const save = useCallback(
    async (enabled: boolean, freshness: MetricsFreshness) => {
      setIsSaving(true);
      try {
        return await post({ action: "save", enabled, freshness });
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [post],
  );

  const regenerateToken = useCallback(async () => {
    setIsRegenerating(true);
    try {
      return await post({ action: "regenerate_token" });
    } finally {
      if (mountedRef.current) setIsRegenerating(false);
    }
  }, [post]);

  const refresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    data,
    isLoading,
    error,
    isSaving,
    isRegenerating,
    refresh,
    save,
    regenerateToken,
  };
}
