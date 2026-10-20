"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  SystemSettings,
  ScheduleConfig,
  SystemSettingsResponse,
} from "@/types/system-settings";

// =============================================================================
// useSystemSettings — Fetch & Save Hook for System Settings
// =============================================================================
// Fetches all system settings on mount (preferences + schedules).
// Provides separate save functions for each settings group.
//
// Backend: GET/POST /cgi-bin/quecmanager/system/settings.sh
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/settings.sh";

// ─── Save Payload Types ───────────────────────────────────────────────────

export interface SaveSettingsPayload {
  action: "save_settings";
  hostname?: string;
  temp_unit?: "celsius" | "fahrenheit";
  distance_unit?: "km" | "miles";
  timezone?: string;
  zonename?: string;
}

export interface SaveScheduledRebootPayload {
  action: "save_scheduled_reboot";
  enabled: boolean;
  time: string;
  days: number[];
}

// ─── Save Result ──────────────────────────────────────────────────────────

/**
 * What a save returns. Callers toast from this and never from the hook's
 * `error`, which a save no longer touches (it describes the last READ only, so
 * a rejected edit cannot mislabel the card as stale).
 */
export interface SaveResult {
  success: boolean;
  /**
   * The reason the device gave, already translated through `resolveErrorMessage`.
   * Absent on success and when the device (or the network) gave none, in which
   * case the caller shows its own generic line.
   */
  message?: string;
}

export interface UseSystemSettingsReturn {
  settings: SystemSettings | null;
  scheduledReboot: ScheduleConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Set only by a failed READ. Cleared by the next read. */
  error: string | null;
  saveSettings: (payload: SaveSettingsPayload) => Promise<SaveResult>;
  saveScheduledReboot: (
    payload: SaveScheduledRebootPayload,
  ) => Promise<SaveResult>;
  refresh: (silent?: boolean) => Promise<void>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSystemSettings(): UseSystemSettingsReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [scheduledReboot, setScheduledReboot] =
    useState<ScheduleConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // Responses settle out of order, so every read claims a sequence at ISSUE
  // time and a late one that lost the race is dropped instead of applied.
  const reqSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch current settings
  // ---------------------------------------------------------------------------
  const fetchSettings = useCallback(async (silent = false) => {
    const seq = ++reqSeqRef.current;
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const json: SystemSettingsResponse = await resp.json();
      if (!mountedRef.current) return;
      // A newer answer already landed, so this one is stale by definition.
      if (seq <= appliedSeqRef.current) return;
      appliedSeqRef.current = seq;

      if (!json.success) {
        setError("Failed to fetch system settings");
        return;
      }

      setSettings(json.settings);
      setScheduledReboot(json.scheduled_reboot);
    } catch (err) {
      if (!mountedRef.current) return;
      if (seq <= appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      setError(
        err instanceof Error ? err.message : "Failed to fetch system settings",
      );
    } finally {
      // Deliberately unsequenced: gating this would strand the spinner whenever
      // a silent refetch supersedes a visible one and never clears it.
      if (mountedRef.current && !silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ---------------------------------------------------------------------------
  // Generic POST helper
  // ---------------------------------------------------------------------------
  const postAction = useCallback(
    async (
      payload: SaveSettingsPayload | SaveScheduledRebootPayload,
    ): Promise<SaveResult> => {
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
        if (!mountedRef.current) return { success: false };

        if (!json.success) {
          const message = resolveErrorMessage(t, json.error, json.detail, "");
          return { success: false, message: message || undefined };
        }

        // Silent re-fetch to sync all state
        await fetchSettings(true);
        return { success: true };
      } catch {
        // Transport failure: no device reason to quote, the caller's generic
        // line covers it.
        return { success: false };
      } finally {
        if (mountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [fetchSettings, t],
  );

  // ---------------------------------------------------------------------------
  // Per-action save wrappers
  // ---------------------------------------------------------------------------
  const saveSettings = useCallback(
    (payload: SaveSettingsPayload) => postAction(payload),
    [postAction],
  );

  const saveScheduledReboot = useCallback(
    (payload: SaveScheduledRebootPayload) => postAction(payload),
    [postAction],
  );

  return {
    settings,
    scheduledReboot,
    isLoading,
    isSaving,
    error,
    saveSettings,
    saveScheduledReboot,
    refresh: fetchSettings,
  };
}

// =============================================================================
// useUnitPreferences — Lightweight hook for dashboard unit display
// =============================================================================
// Fetches unit preferences on mount. Used by device-metrics.tsx to display
// temperature in °F and distance in miles when configured.
// =============================================================================

interface UnitPreferences {
  tempUnit: "celsius" | "fahrenheit";
  distanceUnit: "km" | "miles";
}

export function useUnitPreferences(): UnitPreferences | null {
  const [prefs, setPrefs] = useState<UnitPreferences | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Plain fetch, NOT authFetch: this is a best-effort display-preference read
    // that also runs on the public Overview splash ("/"), where the visitor is
    // logged out and this endpoint returns 401. authFetch turns any 401 into a
    // global `window.location = "/login/"` redirect — which would bounce the
    // public splash straight to the login form the instant it mounts. A display
    // preference must never drive session-loss routing. Cookies still ride along
    // (same-origin default credentials), so the logged-in dashboard keeps
    // getting the user's real °F/miles prefs; logged-out simply falls through to
    // the celsius/km defaults below.
    fetch(CGI_ENDPOINT, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: SystemSettingsResponse | null) => {
        if (!cancelled && json?.success && json.settings) {
          setPrefs({
            tempUnit: json.settings.temp_unit || "celsius",
            distanceUnit: json.settings.distance_unit || "km",
          });
        }
      })
      .catch(() => {
        // Silent: fall back to the celsius/km defaults on any error.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return prefs;
}
