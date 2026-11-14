"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { MutationResult } from "@/types/mutation-result";
import type { SmartDnsSettings, SmartDnsStatus } from "@/types/smartdns";

// =============================================================================
// useSmartDns — SmartDNS status read, settings save, package install/remove
// =============================================================================
// Backend endpoints (one file, four actions):
//   GET  /cgi-bin/quecmanager/network/smartdns.sh
//   POST {"action":"save"|"install"|"uninstall", ...}
//
// -----------------------------------------------------------------------------
// NO POLLING, EXCEPT WHILE A PACKAGE OPERATION IS RUNNING
// -----------------------------------------------------------------------------
// The resolver's own state changes only when this page changes it, so a timer
// would spend the box's CPU to tell us what we already know (AGENTS.md: no
// per-cycle work faster than it needs to be). The exception is `opkg`, which
// takes tens of seconds and reports through a result file on the device: while
// `install.status` is "installing" the hook re-reads every 2 s and stops the
// moment the status moves.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/smartdns.sh";

/** How often to re-read while an opkg install/removal is in flight. */
const INSTALL_POLL_MS = 2000;

export interface UseSmartDnsReturn {
  /** The last good read, or null before the first one. */
  status: SmartDnsStatus | null;
  /** True while the initial read is in flight. */
  isLoading: boolean;
  /** True while a settings save is in flight. */
  isSaving: boolean;
  /** True while an install/removal is in flight on the device. */
  isInstalling: boolean;
  /** True while a package action request itself is in flight. */
  isStartingInstall: boolean;
  /** The last failure, already translated. Null when the last call succeeded. */
  error: string | null;
  save: (settings: SmartDnsSettings) => Promise<MutationResult>;
  install: () => Promise<MutationResult>;
  uninstall: () => Promise<MutationResult>;
  /** Kick off the device-side latency benchmark; the read polls until it ends. */
  runBenchmark: () => Promise<MutationResult>;
  /** Validate and install a free-text config file on the device. */
  saveCustomConf: (text: string) => Promise<MutationResult>;
  refresh: () => void;
}

const SUCCEEDED: MutationResult = { ok: true, code: null, error: null };
const UNMOUNTED: MutationResult = { ok: false, code: null, error: null };

export function useSmartDns(): UseSmartDnsReturn {
  const { t } = useTranslation("errors");
  const [status, setStatus] = useState<SmartDnsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingInstall, setIsStartingInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------
  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);

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
              json.detail,
              t("smartdns.errors.fetch_failed", { ns: "local-network" }),
            ),
          );
          return;
        }

        setStatus(json as SmartDnsStatus);
        // Only a good read clears the failure: a save that failed must stay on
        // screen until the page has re-read the device successfully.
        setError(null);
      } catch {
        if (!mountedRef.current) return;
        setError(t("smartdns.errors.fetch_failed", { ns: "local-network" }));
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Do not dim the page on a background re-read; only the first one owns the
  // skeleton.
  const refresh = useCallback(() => {
    void fetchStatus(true);
  }, [fetchStatus]);

  // ---------------------------------------------------------------------------
  // Package operations finish on the device, not in the response
  // ---------------------------------------------------------------------------
  const installState = status?.install ?? null;
  const isInstalling =
    isStartingInstall ||
    installState?.status === "installing";

  // The benchmark runs on the device and reports through the same GET, so the
  // page polls exactly while one is in flight - same shape as the install poll,
  // and no timer at any other time.
  const benchmarkRunning = status?.benchmark_running === true;
  useEffect(() => {
    if (!benchmarkRunning) return;
    const id = window.setInterval(() => {
      void fetchStatus(true);
    }, 1500);
    return () => window.clearInterval(id);
  }, [benchmarkRunning, fetchStatus]);

  useEffect(() => {
    if (installState?.status !== "installing") return;
    const id = window.setInterval(() => {
      void fetchStatus(true);
    }, INSTALL_POLL_MS);
    return () => window.clearInterval(id);
  }, [installState?.status, fetchStatus]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  const save = useCallback(
    async (settings: SmartDnsSettings): Promise<MutationResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", ...settings }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return UNMOUNTED;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              t("smartdns.errors.save_failed", { ns: "local-network" }),
            ),
          );
          return { ok: false, code: json.error ?? null, error: json.detail ?? null };
        }

        // The save can change the wiring, the process and the config at once, so
        // state comes from a re-read rather than from the response.
        await fetchStatus(true);
        return SUCCEEDED;
      } catch {
        if (!mountedRef.current) return UNMOUNTED;
        setError(t("smartdns.errors.save_failed", { ns: "local-network" }));
        return { ok: false, code: null, error: null };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchStatus, t],
  );

  // ---------------------------------------------------------------------------
  // Install / remove
  // ---------------------------------------------------------------------------
  const runPackageAction = useCallback(
    async (action: "install" | "uninstall"): Promise<MutationResult> => {
      setError(null);
      setIsStartingInstall(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) return UNMOUNTED;

        if (!json.success) {
          setError(
            resolveErrorMessage(
              t,
              json.error,
              json.detail,
              t(`smartdns.errors.${action}_failed`, { ns: "local-network" }),
            ),
          );
          return { ok: false, code: json.error ?? null, error: json.detail ?? null };
        }

        // The helper is now running on the device; the poll effect takes over.
        await fetchStatus(true);
        return SUCCEEDED;
      } catch {
        if (!mountedRef.current) return UNMOUNTED;
        setError(t(`smartdns.errors.${action}_failed`, { ns: "local-network" }));
        return { ok: false, code: null, error: null };
      } finally {
        if (mountedRef.current) {
          setIsStartingInstall(false);
        }
      }
    },
    [fetchStatus, t],
  );

  const install = useCallback(() => runPackageAction("install"), [runPackageAction]);
  const uninstall = useCallback(() => runPackageAction("uninstall"), [runPackageAction]);

  // ---------------------------------------------------------------------------
  // Tools: benchmark and the free-text config
  // ---------------------------------------------------------------------------
  const runBenchmark = useCallback(async (): Promise<MutationResult> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "benchmark" }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || !json?.success) {
        return { ok: false, code: json?.error ?? null, error: json?.detail ?? null };
      }
      // The run continues on the device; poll until benchmark_running clears.
      window.setTimeout(() => void fetchStatus(true), 800);
      return SUCCEEDED;
    } catch {
      return { ok: false, code: null, error: null };
    }
  }, [fetchStatus]);

  const saveCustomConf = useCallback(
    async (text: string): Promise<MutationResult> => {
      setIsSaving(true);
      setError(null);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save_custom", text }),
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.success) {
          const msg = resolveErrorMessage(
            t,
            json?.error,
            json?.detail,
            t("smartdns.errors.save_failed", { ns: "local-network" }),
          );
          setError(msg);
          return { ok: false, code: json?.error ?? null, error: json?.detail ?? null };
        }
        await fetchStatus(true);
        return SUCCEEDED;
      } catch {
        const msg = t("smartdns.errors.save_failed", { ns: "local-network" });
        setError(msg);
        return { ok: false, code: null, error: null };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [fetchStatus, t],
  );

  return {
    status,
    isLoading,
    isSaving,
    isInstalling,
    isStartingInstall,
    error,
    save,
    install,
    uninstall,
    runBenchmark,
    saveCustomConf,
    refresh,
  };
}
