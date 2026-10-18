"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { InstallResult } from "@/types/video-optimizer";

// =============================================================================
// useNetBird — Fetch & Action Hook for NetBird VPN Management
// =============================================================================
// Fetches NetBird status on mount (tiered: not installed → stopped → full).
// Provides action methods for connect, disconnect, service, boot toggle,
// install and uninstall. Fixed 10s polling (no adaptive auth-wait).
//
// Every action RETURNS its outcome (`NetBirdActionResult`) instead of parking
// the failure reason in hook state: a caller that toasts after an `await` would
// read a stale closure of that state. The `error` field is the status READ only.
//
// Backend: GET/POST /cgi-bin/quecmanager/vpn/netbird.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/vpn/netbird.sh";

const POLL_INTERVAL_MS = 10_000;

/** Daemon state takes a moment to propagate after these actions. */
const SETTLE_MS = 2000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NetBirdPeer {
  hostname: string;
  netbird_ip: string;
  status: string;
  connection_type: string;
  direct: string;
  last_seen: string;
  transfer_received: string;
  transfer_sent: string;
}

export interface NetBirdStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  version?: string;
  backend_state?: string;
  management?: string;
  signal?: string;
  fqdn?: string;
  netbird_ip?: string;
  interface_type?: string;
  peers_connected?: number;
  peers_total?: number;
  peers?: NetBirdPeer[];
  install_hint?: string;
  error_detail?: string;
  other_vpn_installed?: boolean;
  other_vpn_name?: string;
}

/**
 * The outcome of one mutation. `error` is the backend's own explanation,
 * already resolved through `resolveErrorMessage`; it is absent when the backend
 * gave none, so the caller supplies its translated fallback.
 */
export interface NetBirdActionResult {
  success: boolean;
  error?: string;
}

export interface UseNetBirdReturn {
  status: NetBirdStatus | null;
  isLoading: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingBoot: boolean;
  isUninstalling: boolean;
  installResult: InstallResult;
  error: string | null;
  connect: (setupKey?: string) => Promise<NetBirdActionResult>;
  disconnect: () => Promise<NetBirdActionResult>;
  startService: () => Promise<NetBirdActionResult>;
  stopService: () => Promise<NetBirdActionResult>;
  setBootEnabled: (enabled: boolean) => Promise<NetBirdActionResult>;
  uninstall: () => Promise<NetBirdActionResult>;
  runInstall: () => Promise<void>;
  refresh: () => void;
}

interface PostResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useNetBird(): UseNetBirdReturn {
  const { t } = useTranslation("errors");
  const [status, setStatus] = useState<NetBirdStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [isTogglingBoot, setIsTogglingBoot] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [installResult, setInstallResult] = useState<InstallResult>({
    success: true,
    status: "idle",
  });
  const installPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installPollRef.current) clearInterval(installPollRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current status
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(
    async (silent = false) => {
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
          setError(
            resolveErrorMessage(
              t,
              json.error,
              undefined,
              t("netbird.errors.fetch_failed", { ns: "monitoring" }),
            ),
          );
          return;
        }

        setStatus(json);
      } catch {
        if (!mountedRef.current) return;
        setError(
          t("netbird.errors.fetch_failed", { ns: "monitoring" }),
        );
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  // ---------------------------------------------------------------------------
  // Fixed-interval polling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchStatus(true), POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // POST helper
  // ---------------------------------------------------------------------------
  const postAction = useCallback(
    async (body: Record<string, unknown>): Promise<PostResponse> => {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      return resp.json();
    },
    [],
  );

  /**
   * One mutation: POST, optionally let the daemon settle, refetch on success,
   * return the outcome. `setBusy` is the flag the caller owns for the call.
   */
  const runAction = useCallback(
    async (
      body: Record<string, unknown>,
      setBusy?: (busy: boolean) => void,
      settleMs = 0,
    ): Promise<NetBirdActionResult> => {
      setBusy?.(true);
      try {
        const json = await postAction(body);
        if (!json.success) {
          return {
            success: false,
            error:
              resolveErrorMessage(t, json.error, json.detail, "") || undefined,
          };
        }
        if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
        if (mountedRef.current) await fetchStatus(true);
        return { success: true };
      } catch {
        return {
          success: false,
          error: undefined,
        };
      } finally {
        if (mountedRef.current) setBusy?.(false);
      }
    },
    [postAction, fetchStatus, t],
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const connect = useCallback(
    (setupKey?: string) => {
      const body: Record<string, unknown> = { action: "connect" };
      if (setupKey) body.setup_key = setupKey;
      return runAction(body, setIsConnecting, SETTLE_MS);
    },
    [runAction],
  );

  const disconnect = useCallback(
    () => runAction({ action: "disconnect" }, setIsDisconnecting, SETTLE_MS),
    [runAction],
  );

  const startService = useCallback(
    () =>
      runAction({ action: "start_service" }, setIsTogglingService, SETTLE_MS),
    [runAction],
  );

  const stopService = useCallback(
    () =>
      runAction({ action: "stop_service" }, setIsTogglingService, SETTLE_MS),
    [runAction],
  );

  const setBootEnabled = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_boot_enabled", enabled }, setIsTogglingBoot),
    [runAction],
  );

  const uninstall = useCallback(
    () => runAction({ action: "uninstall" }, setIsUninstalling),
    [runAction],
  );

  // ---------------------------------------------------------------------------
  // Install via opkg, polled until terminal
  // ---------------------------------------------------------------------------
  const stopInstallPolling = useCallback(() => {
    if (installPollRef.current) {
      clearInterval(installPollRef.current);
      installPollRef.current = null;
    }
  }, []);

  const pollInstallStatus = useCallback(async () => {
    try {
      const json = await postAction({ action: "install_status" });
      if (!mountedRef.current) return;
      const r = json as unknown as InstallResult;
      setInstallResult(r);
      if (r.status === "complete" || r.status === "error") {
        stopInstallPolling();
        await fetchStatus(true);
      }
    } catch {
      // Silently retry on next poll
    }
  }, [postAction, stopInstallPolling, fetchStatus]);

  const runInstall = useCallback(async () => {
    stopInstallPolling();
    setInstallResult({ success: true, status: "running" });
    try {
      const json = await postAction({ action: "install" });
      if (!mountedRef.current) return;
      if (!json.success) {
        // Refused up front (another VPN, already installed, ...): no
        // background job exists to poll.
        setInstallResult({
          success: false,
          status: "error",
          message: resolveErrorMessage(t, json.error, json.detail, ""),
        });
        return;
      }
      installPollRef.current = setInterval(pollInstallStatus, 2000);
    } catch {
      if (mountedRef.current) {
        setInstallResult({
          success: false,
          status: "error",
          message: "",
        });
      }
    }
  }, [postAction, pollInstallStatus, stopInstallPolling, t]);

  return {
    status,
    isLoading,
    isConnecting,
    isDisconnecting,
    isTogglingService,
    isTogglingBoot,
    isUninstalling,
    installResult,
    error,
    connect,
    disconnect,
    startService,
    stopService,
    setBootEnabled,
    uninstall,
    runInstall,
    refresh: fetchStatus,
  };
}
