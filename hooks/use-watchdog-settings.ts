"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/watchdog.sh";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WatchdogSettings {
  enabled: boolean;
  /** Consecutive failed PROBES (raw ping streak) before recovery begins. */
  fail_threshold: number;
  /**
   * The effective ping cadence in seconds (`interval_sec` from the GET). The
   * CGI writes it to `ping_profile.interval_override` only when it changed.
   */
  probe_interval: number;
  /** Watchdog loop cadence. Pass-through only: no card edits it. */
  check_interval: number;
  cooldown: number;
  tier1_enabled: boolean;
  tier2_enabled: boolean;
  tier3_enabled: boolean;
  tier4_enabled: boolean;
  backup_sim_slot: number | null;
  max_reboots_per_hour: number;
  // Quality recovery (opt-in). The thresholds it acts on are the SHARED
  // quality_thresholds owned by Connection Quality; the watchdog owns only
  // whether to recover and how sustained a breach must be.
  quality_enabled: boolean;
  quality_consecutive: number;
  // SSR-aware hold: let a recoverable baseband restart self-heal first.
  ssr_aware: boolean;
  ssr_grace: number;
  // Blind periodic swap back to the primary SIM after a Tier-3 failover. Each
  // attempt is a real outage, so it is opt-in. Interval in MINUTES (5-1440).
  primary_recheck_enabled: boolean;
  primary_recheck_interval: number;
}

/**
 * One card's commit. Every key is optional on the wire: the CGI writes only
 * the keys present, so a card sends its own fields and nothing else.
 */
export type WatchdogSavePayload = Partial<
  Omit<WatchdogSettings, "check_interval">
> & {
  action: "save_settings";
};

/** Read-only resolved view of the SHARED quality thresholds. */
export interface WatchdogQualityThresholds {
  latency_ms: number;
  loss_pct: number;
  latency_preset: string;
  loss_preset: string;
}

/**
 * The save outcome, RETURNED rather than only stored: `error` state set in the
 * same tick is stale in the caller's closure, so the reason travels here.
 */
export interface WatchdogSaveResult {
  ok: boolean;
  /** Already-translated failure reason, or null on success. */
  message: string | null;
  /** The rejected field's backend name, when the failure names one. */
  field: string | null;
}

// Live state (`watchcat`, `sim_failover`, connectivity) is read from the poller
// snapshot by the page, which is the fresher source. The CGI's own copies are
// not surfaced here.
export interface UseWatchdogSettingsReturn {
  settings: WatchdogSettings | null;
  qualityThresholds: WatchdogQualityThresholds | null;
  autoDisabled: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveSettings: (payload: WatchdogSavePayload) => Promise<WatchdogSaveResult>;
  revertSim: () => Promise<boolean>;
  refresh: () => void;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useWatchdogSettings(): UseWatchdogSettingsReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<WatchdogSettings | null>(null);
  const [qualityThresholds, setQualityThresholds] =
    useState<WatchdogQualityThresholds | null>(null);
  const [autoDisabled, setAutoDisabled] = useState(false);
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

  const fetchSettings = useCallback(
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
              "Failed to fetch watchdog settings",
            ),
          );
          return;
        }

        const s = json.settings ?? {};
        setSettings({
          ...s,
          fail_threshold: num(s.fail_threshold, 5),
          // interval_sec is the cadence the ping daemon runs (B2.1).
          probe_interval: num(json.interval_sec ?? json.effective_interval, 5),
          check_interval: num(s.check_interval, 10),
          cooldown: num(s.cooldown, 60),
          max_reboots_per_hour: num(s.max_reboots_per_hour, 3),
          quality_consecutive: num(s.quality_consecutive, 5),
          ssr_grace: num(s.ssr_grace, 45),
          primary_recheck_interval: num(s.primary_recheck_interval, 30),
        });
        setQualityThresholds(json.quality_thresholds ?? null);
        setAutoDisabled(json.auto_disabled === true);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to fetch watchdog settings",
        );
      } finally {
        if (mountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    fetchSettings();
    const id = setInterval(() => {
      fetchSettings(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [fetchSettings]);

  const saveSettings = useCallback(
    async (payload: WatchdogSavePayload): Promise<WatchdogSaveResult> => {
      setError(null);
      setIsSaving(true);

      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const json = await resp.json();
        if (!mountedRef.current) {
          return { ok: false, message: null, field: null };
        }

        if (!json.success) {
          // The watchdog CGI carries its detail in `reason`, not `detail`.
          const message = resolveErrorMessage(
            t,
            json.error,
            json.reason,
            "Failed to save watchdog settings",
          );
          setError(message);
          return {
            ok: false,
            message,
            field: typeof json.field === "string" ? json.field : null,
          };
        }

        await fetchSettings(true);
        return { ok: true, message: null, field: null };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save settings";
        if (mountedRef.current) setError(message);
        return { ok: false, message, field: null };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings, t],
  );

  // Request a SIM revert (watchcat picks up the flag).
  const revertSim = useCallback(async (): Promise<boolean> => {
    try {
      const resp = await authFetch(CGI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revert_sim" }),
      });
      if (!resp.ok) return false;
      const json = await resp.json();
      return json.success === true;
    } catch {
      return false;
    }
  }, []);

  return {
    settings,
    qualityThresholds,
    autoDisabled,
    isLoading,
    isSaving,
    error,
    saveSettings,
    revertSim,
    refresh: fetchSettings,
  };
}
