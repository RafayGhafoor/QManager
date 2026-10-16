"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  HostAtPortsResponse,
  HostAtPortsState,
  MutationResult,
} from "@/types/at-engine";

// =============================================================================
// useHostAtPorts: read/toggle the host AT ports (vendor port-bridge).
// =============================================================================
// Backend: /cgi-bin/quecmanager/system/host_at_ports.sh
//   GET                        → { available, enabled, running, pcie }
//   POST {"enabled": boolean}  → same shape, after applying
//
// PESSIMISTIC: state comes from the POST read-back, never a local flip. The
// mutator returns its own result for the caller's toast.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/host_at_ports.sh";

function toState(json: HostAtPortsResponse): HostAtPortsState {
  return {
    available: json.available === true,
    enabled: json.enabled === true,
    running: json.running === true,
    pcie: json.pcie === true,
  };
}

export interface UseHostAtPortsReturn {
  state: HostAtPortsState | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Load error only; a failed save is reported through the mutator's result. */
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<MutationResult>;
  refresh: () => void;
}

export function useHostAtPorts(): UseHostAtPortsReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<HostAtPortsState | null>(null);
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
      const json: HostAtPortsResponse = await resp.json();
      if (!mountedRef.current) return;
      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, json.detail, "Failed to read host AT ports"));
        return;
      }
      setState(toState(json));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read host AT ports");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<MutationResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json: HostAtPortsResponse = await resp.json();
        if (!mountedRef.current) return { ok: false };
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, json.error, json.detail, "Failed to update host AT ports"),
          };
        }
        setState(toState(json));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to update host AT ports",
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

  return { state, isLoading, isSaving, error, setEnabled, refresh };
}
