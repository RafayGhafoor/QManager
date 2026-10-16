"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { PingProfile } from "@/types/modem-status";

// =============================================================================
// usePingProfile — read/write the ping-daemon sensitivity profile + targets
// =============================================================================
// GET  → { success: true, profile, target_ipv4, target_ipv6, interval_override,
//          effective_interval, interval_sec, fail_secs, recover_secs }
// POST → { action: "save", profile, target_ipv4, target_ipv6 }
//        success: { success: true }
//        failure: { success: false, error, detail }
//
// The daemon probes via ICMP: the IPv4 target is pinged first; the IPv6 target
// is only used when the IPv4 probe fails, so an IPv6-only bearer never reads as
// "down". Targets are bare hosts/IP literals (no URL scheme).
//
// `save` never throws: it returns a `PingProfileSaveResult` whose `error` is the
// translated backend reason (or null for the caller's generic copy). Read it
// from the result, never from hook state after the await (stale closure).
//
// CGI: /cgi-bin/quecmanager/system/ping_profile.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/ping_profile.sh";

interface PingProfileGetResponse {
  success: boolean;
  profile?: PingProfile;
  target_ipv4?: string;
  target_ipv6?: string;
  /** Custom probe interval set by the Watchdog; it wins over the profile. */
  interval_override?: number | null;
  effective_interval?: number;
  interval_sec?: number;
  fail_secs?: number;
  recover_secs?: number;
  error?: string;
  detail?: string;
}

export interface PingProfileSettings {
  profile: PingProfile;
  /** IPv4 address or hostname, pinged first. */
  target_ipv4: string;
  /** IPv6 literal, the fallback for IPv6-only connections. */
  target_ipv6: string;
}

export interface PingProfileCadence {
  /** Effective probe interval in seconds (override applied). */
  intervalSec: number | null;
  /** The profile's time-to-fail in seconds. */
  failSecs: number | null;
  /** The profile's time-to-recover in seconds. */
  recoverSecs: number | null;
  /** Watchdog override in seconds; null = the profile's own interval. */
  intervalOverride: number | null;
}

export interface PingProfileSaveResult {
  ok: boolean;
  /** Translated backend reason; null means use the caller's generic copy. */
  error: string | null;
}

export interface UsePingProfileReturn {
  /** The saved settings; null until the first GET lands (or when it failed). */
  settings: PingProfileSettings | null;
  cadence: PingProfileCadence | null;
  isLoading: boolean;
  /** True when the last GET failed. */
  loadFailed: boolean;
  isSaving: boolean;
  save: (next: PingProfileSettings) => Promise<PingProfileSaveResult>;
  refresh: () => Promise<void>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function failure(t: TFunction, json: { error?: unknown; detail?: unknown }): PingProfileSaveResult {
  const code = typeof json.error === "string" && json.error !== "" ? json.error : null;
  const message = code ? resolveErrorMessage(t, code, undefined, "") : "";
  return { ok: false, error: message || null };
}

export function usePingProfile(): UsePingProfileReturn {
  const { t } = useTranslation("errors");
  const [settings, setSettings] = useState<PingProfileSettings | null>(null);
  const [cadence, setCadence] = useState<PingProfileCadence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const mountedRef = useRef(true);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: PingProfileGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.profile) {
        setLoadFailed(true);
        return;
      }

      setSettings({
        profile: json.profile,
        target_ipv4: json.target_ipv4 ?? "",
        target_ipv6: json.target_ipv6 ?? "",
      });
      setCadence({
        intervalSec: num(json.interval_sec) ?? num(json.effective_interval),
        failSecs: num(json.fail_secs),
        recoverSecs: num(json.recover_secs),
        intervalOverride: num(json.interval_override),
      });
      setLoadFailed(false);
    } catch {
      if (mountedRef.current) setLoadFailed(true);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchProfile();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchProfile]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchProfile();
  }, [fetchProfile]);

  const save = useCallback(
    async (next: PingProfileSettings): Promise<PingProfileSaveResult> => {
      setIsSaving(true);
      try {
        const response = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", ...next }),
        });
        if (!response.ok) return { ok: false, error: null };
        const json = await response.json();
        if (!json?.success) return failure(t, json ?? {});
        // The saved profile changes the cadence: re-read it from the CGI.
        if (mountedRef.current) {
          setSettings(next);
          void fetchProfile();
        }
        return { ok: true, error: null };
      } catch {
        return { ok: false, error: null };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [t, fetchProfile],
  );

  return { settings, cadence, isLoading, loadFailed, isSaving, save, refresh };
}
