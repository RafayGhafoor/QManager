"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import type { TFunction } from "i18next";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { InstallResult } from "@/types/video-optimizer";
import type {
  AlertsState,
  AlertsSavePayload,
  AlertChannel,
  AlertsMutationResult,
} from "@/types/alerts";

// =============================================================================
// useAlerts — one hook for the whole centralized Alerts surface
// =============================================================================
// Fetches the combined {channels, routing, capabilities} state, saves it in a
// single atomic POST, sends per-channel tests against the real send path, and
// drives the msmtp mailer install/uninstall lifecycle for the email channel.
//
// Backend: GET/POST /cgi-bin/quecmanager/monitoring/alerts.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/alerts.sh";

// Mutation outcomes. A null `error` on failure means "use the caller's own
// generic copy" (a transport failure has no translatable slug).
const SUCCEEDED: AlertsMutationResult = { ok: true, error: null, code: null };
const UNMOUNTED: AlertsMutationResult = { ok: false, error: null, code: null };
const TRANSPORT_FAILED: AlertsMutationResult = { ok: false, error: null, code: null };

/** A CGI failure envelope → translated message plus the raw slug. An unknown
 *  slug yields null, so the caller's generic copy shows, never English detail. */
function failedResult(
  t: TFunction,
  json: { error?: unknown; detail?: unknown },
): AlertsMutationResult {
  const code = typeof json.error === "string" && json.error !== "" ? json.error : null;
  const message = code ? resolveErrorMessage(t, code, undefined, "") : "";
  return { ok: false, error: message || null, code };
}

export interface UseAlertsReturn {
  state: AlertsState | null;
  isLoading: boolean;
  isSaving: boolean;
  testingChannel: AlertChannel | null;
  isUninstalling: boolean;
  installResult: InstallResult;
  /** Load failures only; a mutation returns its failure in its own result. */
  error: string | null;
  saveSettings: (payload: AlertsSavePayload) => Promise<AlertsMutationResult>;
  sendTest: (channel: AlertChannel) => Promise<AlertsMutationResult>;
  runInstall: () => Promise<void>;
  uninstall: () => Promise<AlertsMutationResult>;
  refresh: () => void;
}

export function useAlerts(): UseAlertsReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<AlertsState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [testingChannel, setTestingChannel] = useState<AlertChannel | null>(
    null,
  );
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [installResult, setInstallResult] = useState<InstallResult>({
    success: true,
    status: "idle",
  });
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installPollRef.current) clearInterval(installPollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch combined state
  // ---------------------------------------------------------------------------
  const fetchState = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const resp = await authFetch(CGI_ENDPOINT);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

        const json = await resp.json();
        if (!mountedRef.current) return;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              undefined,
              "Failed to load alert settings",
            ),
          );
          return;
        }

        setState({
          channels: json.channels,
          routing: json.routing,
          capabilities: json.capabilities,
          reboots: Array.isArray(json.reboots) ? json.reboots : [],
        });
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load alert settings",
        );
      } finally {
        if (mountedRef.current && !silent) setIsLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // ---------------------------------------------------------------------------
  // Save (one atomic POST covering both channels + routing)
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    async (payload: AlertsSavePayload): Promise<AlertsMutationResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

        const json = await resp.json();
        if (!mountedRef.current) return UNMOUNTED;

        if (!json.success) return failedResult(t, json);

        await fetchState(true);
        return SUCCEEDED;
      } catch {
        return TRANSPORT_FAILED;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchState, t],
  );

  // ---------------------------------------------------------------------------
  // Per-channel test send (real path, gated on saved config by the caller)
  // ---------------------------------------------------------------------------
  const sendTest = useCallback(
    async (channel: AlertChannel): Promise<AlertsMutationResult> => {
      setTestingChannel(channel);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_test", channel }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const json = await resp.json();
        if (!mountedRef.current) return UNMOUNTED;

        if (!json.success) return failedResult(t, json);
        return SUCCEEDED;
      } catch {
        return TRANSPORT_FAILED;
      } finally {
        if (mountedRef.current) setTestingChannel(null);
      }
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // msmtp install lifecycle (email channel only)
  // ---------------------------------------------------------------------------
  const stopInstallPolling = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  const pollInstallStatus = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_status" }),
      });
      if (!resp.ok) return;
      const data: InstallResult = await resp.json();
      if (!mountedRef.current) return;
      setInstallResult(data);
      if (data.status === "complete" || data.status === "error") {
        stopInstallPolling();
        await fetchState(true);
      }
    } catch {
      // Silently retry on the next poll tick.
    }
  }, [stopInstallPolling, fetchState]);

  const runInstall = useCallback(async () => {
    setInstallResult({
      success: true,
      status: "running",
      message: "Starting installation...",
    });
    try {
      await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install" }),
      });
      installPollRef.current = setInterval(pollInstallStatus, 2000);
    } catch (err) {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to start installation",
        });
      }
    }
  }, [pollInstallStatus]);

  const uninstall = useCallback(async (): Promise<AlertsMutationResult> => {
    setIsUninstalling(true);
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall" }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (!mountedRef.current) return UNMOUNTED;
      if (!json.success) return failedResult(t, json);
      await fetchState(true);
      return SUCCEEDED;
    } catch {
      return TRANSPORT_FAILED;
    } finally {
      if (mountedRef.current) setIsUninstalling(false);
    }
  }, [fetchState, t]);

  return {
    state,
    isLoading,
    isSaving,
    testingChannel,
    isUninstalling,
    installResult,
    error,
    saveSettings,
    sendTest,
    runInstall,
    uninstall,
    refresh: fetchState,
  };
}
