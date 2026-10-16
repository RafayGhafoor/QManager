"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  AtEngine,
  AtEngineResponse,
  AtEngineState,
  MutationResult,
} from "@/types/at-engine";

// =============================================================================
// useAtEngine: read/switch the AT engine (broker | legacy).
// =============================================================================
// Backend: /cgi-bin/quecmanager/system/at_engine.sh
//   GET                          → { engine, effective, broker_available, broker_running }
//   POST {"engine": AtEngine}    → same shape, after applying
//
// PESSIMISTIC: the POST response IS the authoritative read-back (the CGI
// re-reads link + daemon state after applying), so state is set from it, never
// flipped locally. The mutator returns its own result for the caller's toast.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/at_engine.sh";

function toState(json: AtEngineResponse): AtEngineState {
  return {
    engine: json.engine === "legacy" ? "legacy" : "broker",
    effective: json.effective ?? "unknown",
    brokerAvailable: json.broker_available === true,
    brokerRunning: json.broker_running === true,
  };
}

export interface UseAtEngineReturn {
  state: AtEngineState | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Load error only; a failed save is reported through the mutator's result. */
  error: string | null;
  setEngine: (engine: AtEngine) => Promise<MutationResult>;
  refresh: () => void;
}

export function useAtEngine(): UseAtEngineReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<AtEngineState | null>(null);
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

  const fetchState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const json: AtEngineResponse = await resp.json();
      if (!mountedRef.current) return;
      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, json.detail, "Failed to read the modem command setting"));
        return;
      }
      setState(toState(json));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read the modem command setting");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const setEngine = useCallback(
    async (engine: AtEngine): Promise<MutationResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json: AtEngineResponse = await resp.json();
        if (!mountedRef.current) return { ok: false };
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, json.error, json.detail, "Failed to switch the modem command engine"),
          };
        }
        setState(toState(json));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to switch the modem command engine",
        };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [t],
  );

  const refresh = useCallback(() => {
    fetchState();
  }, [fetchState]);

  return { state, isLoading, isSaving, error, setEngine, refresh };
}
