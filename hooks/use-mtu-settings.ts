"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { MutationResult } from "@/types/mutation-result";

// =============================================================================
// useMtuSettings — One-Shot MTU Fetch & Save Hook
// =============================================================================
// Fetches current MTU and enabled status on mount.
// Provides saveMtu for applying new value, and disableMtu for removing it.
//
// Backend endpoint:
//   GET/POST /cgi-bin/quecmanager/network/mtu.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/mtu.sh";

export interface MtuSettingsData {
  /** Whether custom MTU is currently active */
  isEnabled: boolean;
  /** Current MTU value on the interface */
  currentValue: number;
}

export interface UseMtuSettingsReturn {
  /** Current MTU data (null before first fetch) */
  data: MtuSettingsData | null;
  /** True while initial fetch is in progress */
  isLoading: boolean;
  /** True while a save operation is in progress */
  isSaving: boolean;
  /** Error message if fetch or save failed */
  error: string | null;
  /** Apply a new MTU value. The caller toasts from the returned result. */
  saveMtu: (mtu: number) => Promise<MutationResult>;
  /** Disable custom MTU (revert to default). The caller toasts from the returned result. */
  disableMtu: () => Promise<MutationResult>;
  /** Re-fetch MTU data. Wrap it in an arrow: a bare `onClick` hands a truthy event in as `silent`. */
  refresh: (silent?: boolean) => Promise<void>;
}

const SUCCEEDED: MutationResult = { ok: true, code: null, error: null };
const UNMOUNTED: MutationResult = { ok: false, code: null, error: null };

export function useMtuSettings(): UseMtuSettingsReturn {
  const { t } = useTranslation("errors");
  const [data, setData] = useState<MtuSettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current MTU status
  // ---------------------------------------------------------------------------
  const fetchMtu = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return;

      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, undefined, "Failed to fetch MTU settings"));
        return;
      }

      setData({
        isEnabled: json.is_enabled,
        currentValue: json.current_value,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to fetch MTU settings",
      );
    } finally {
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, [t]);

  // Fetch on mount
  useEffect(() => {
    fetchMtu();
  }, [fetchMtu]);

  // ---------------------------------------------------------------------------
  // Save new MTU value
  // ---------------------------------------------------------------------------
  const saveMtu = useCallback(
    async (mtu: number): Promise<MutationResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mtu }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return UNMOUNTED;

        if (!json.success) {
          setError(resolveErrorMessage(t, json.error, json.detail, "Failed to apply MTU"));
          return { ok: false, code: json.error ?? null, error: json.detail ?? null };
        }

        // Silent re-fetch to update local state
        await fetchMtu(true);
        return SUCCEEDED;
      } catch (err) {
        if (!mountedRef.current) return UNMOUNTED;
        const message = err instanceof Error ? err.message : "Failed to apply MTU";
        setError(message);
        return { ok: false, code: null, error: message };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchMtu, t],
  );

  // ---------------------------------------------------------------------------
  // Disable custom MTU
  // ---------------------------------------------------------------------------
  const disableMtu = useCallback(async (): Promise<MutationResult> => {
    setError(null);
    setIsSaving(true);

    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mtu: "disable" }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json = await resp.json();
      if (!mountedRef.current) return UNMOUNTED;

      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, json.detail, "Failed to disable MTU"));
        return { ok: false, code: json.error ?? null, error: json.detail ?? null };
      }

      // Silent re-fetch to update local state
      await fetchMtu(true);
      return SUCCEEDED;
    } catch (err) {
      if (!mountedRef.current) return UNMOUNTED;
      const message = err instanceof Error ? err.message : "Failed to disable MTU";
      setError(message);
      return { ok: false, code: null, error: message };
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [fetchMtu, t]);

  return {
    data,
    isLoading,
    isSaving,
    error,
    saveMtu,
    disableMtu,
    refresh: fetchMtu,
  };
}
