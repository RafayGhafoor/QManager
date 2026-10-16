"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { InstallResult } from "@/types/video-optimizer";

// =============================================================================
// useTailscale — Fetch & Action Hook for Tailscale VPN Management
// =============================================================================
// Fetches Tailscale status on mount (tiered: not installed → stopped → full).
// Provides action methods for connect, disconnect, logout, service, boot and
// exit-node toggles, install and uninstall.
// Adaptive polling: 10s normal, 3s during auth wait.
//
// Every action RETURNS its outcome (`TailscaleActionResult`) instead of parking
// the failure reason in hook state: a caller that toasts after an `await` would
// read a stale closure of that state. The `error` field is the status READ only.
//
// Backend: GET/POST /cgi-bin/quecmanager/vpn/tailscale.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/vpn/tailscale.sh";

const POLL_NORMAL_MS = 10_000;
const POLL_AUTH_MS = 3_000;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TailscaleSelf {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  online: boolean;
  os: string;
  relay: string;
}

export interface TailscaleTailnet {
  name: string;
  magic_dns_suffix: string;
  magic_dns_enabled: boolean;
}

export interface TailscalePeer {
  hostname: string;
  dns_name: string;
  tailscale_ips: string[];
  os: string;
  online: boolean;
  last_seen: string;
  relay: string;
  exit_node: boolean;
}

export interface TailscaleStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  version?: string;
  backend_state?: string;
  auth_url?: string;
  self?: TailscaleSelf;
  tailnet?: TailscaleTailnet;
  peers?: TailscalePeer[];
  health?: string[];
  install_hint?: string;
  install_variant?: "official" | "tiny" | "opkg";
  exit_node_advertised?: boolean;
  error_detail?: string;
  other_vpn_installed?: boolean;
  other_vpn_name?: string;
}

export type TailscaleInstallVariant = "official" | "tiny";

/**
 * The outcome of one mutation. `reason` is the backend's own explanation,
 * already resolved through `resolveErrorMessage`; it is empty when the backend
 * gave none, so the caller supplies its translated fallback.
 */
export interface TailscaleActionResult {
  ok: boolean;
  reason: string;
}

export interface UseTailscaleReturn {
  status: TailscaleStatus | null;
  isLoading: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingBoot: boolean;
  isTogglingExitNode: boolean;
  isUninstalling: boolean;
  installResult: InstallResult;
  error: string | null;
  connect: () => Promise<TailscaleActionResult>;
  disconnect: () => Promise<TailscaleActionResult>;
  logout: () => Promise<TailscaleActionResult>;
  startService: () => Promise<TailscaleActionResult>;
  stopService: () => Promise<TailscaleActionResult>;
  setBootEnabled: (enabled: boolean) => Promise<TailscaleActionResult>;
  setExitNodeAdvertised: (enabled: boolean) => Promise<TailscaleActionResult>;
  uninstall: () => Promise<TailscaleActionResult>;
  runInstall: (variant: TailscaleInstallVariant) => Promise<void>;
  refresh: () => void;
}

interface PostResponse {
  success: boolean;
  error?: string;
  detail?: string;
}

const OK: TailscaleActionResult = { ok: true, reason: "" };

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useTailscale(): UseTailscaleReturn {
  const { t } = useTranslation("errors");
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [isTogglingBoot, setIsTogglingBoot] = useState(false);
  const [isTogglingExitNode, setIsTogglingExitNode] = useState(false);
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
              "Failed to fetch Tailscale status",
            ),
          );
          return;
        }

        setStatus(json);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch Tailscale status",
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
  // Adaptive polling — faster during auth wait
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const isAuthWaiting =
      status?.backend_state === "NeedsLogin" && !!status?.auth_url;
    const interval = isAuthWaiting ? POLL_AUTH_MS : POLL_NORMAL_MS;

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchStatus(true), interval);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus, status?.backend_state, status?.auth_url]);

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
   * One mutation: POST, refetch on success, return the outcome. `setBusy` is
   * the flag the caller owns for the duration of the call.
   */
  const runAction = useCallback(
    async (
      body: Record<string, unknown>,
      setBusy?: (busy: boolean) => void,
    ): Promise<TailscaleActionResult> => {
      setBusy?.(true);
      try {
        const json = await postAction(body);
        if (!json.success) {
          return {
            ok: false,
            reason: resolveErrorMessage(t, json.error, json.detail, ""),
          };
        }
        await fetchStatus(true);
        return OK;
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : "",
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
    () => runAction({ action: "connect" }, setIsConnecting),
    [runAction],
  );

  const disconnect = useCallback(
    () => runAction({ action: "disconnect" }, setIsDisconnecting),
    [runAction],
  );

  const logout = useCallback(
    () => runAction({ action: "logout" }, setIsDisconnecting),
    [runAction],
  );

  const startService = useCallback(
    () => runAction({ action: "start_service" }, setIsTogglingService),
    [runAction],
  );

  const stopService = useCallback(
    () => runAction({ action: "stop_service" }, setIsTogglingService),
    [runAction],
  );

  const setBootEnabled = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_boot_enabled", enabled }, setIsTogglingBoot),
    [runAction],
  );

  const setExitNodeAdvertised = useCallback(
    (enabled: boolean) =>
      runAction({ action: "set_exit_node", enabled }, setIsTogglingExitNode),
    [runAction],
  );

  const uninstall = useCallback(
    () => runAction({ action: "uninstall" }, setIsUninstalling),
    [runAction],
  );

  // ---------------------------------------------------------------------------
  // Install (official tarball or tiny opkg), polled until terminal
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

  const runInstall = useCallback(
    async (variant: TailscaleInstallVariant) => {
      stopInstallPolling();
      setInstallResult({ success: true, status: "running" });
      try {
        const json = await postAction({ action: "install", variant });
        if (!mountedRef.current) return;
        if (!json.success) {
          // Refused up front (another VPN, install already running, ...): no
          // background job exists to poll.
          setInstallResult({
            success: false,
            status: "error",
            message: resolveErrorMessage(t, json.error, json.detail, ""),
          });
          return;
        }
        installPollRef.current = setInterval(pollInstallStatus, 2000);
      } catch (err) {
        if (mountedRef.current) {
          setInstallResult({
            success: false,
            status: "error",
            message: err instanceof Error ? err.message : "",
          });
        }
      }
    },
    [postAction, pollInstallStatus, stopInstallPolling, t],
  );

  return {
    status,
    isLoading,
    isConnecting,
    isDisconnecting,
    isTogglingService,
    isTogglingBoot,
    isTogglingExitNode,
    isUninstalling,
    installResult,
    error,
    connect,
    disconnect,
    logout,
    startService,
    stopService,
    setBootEnabled,
    setExitNodeAdvertised,
    uninstall,
    runInstall,
    refresh: fetchStatus,
  };
}
