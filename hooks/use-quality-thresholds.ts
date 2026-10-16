"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type { QualityThresholdsSettings } from "@/types/modem-status";

// =============================================================================
// useQualityThresholds — read/write latency & packet-loss event thresholds
// =============================================================================
// GET  → { success: true, thresholds: { latency: { preset, custom_ms? },
//          loss: { preset, custom_pct? } }, alert_after_min, isDefault }
// POST → { action: "save", latency_preset, loss_preset,
//          latency_custom_ms?, loss_custom_pct? }
//        The nested settings shape is flattened to flat wire keys here because
//        the shell CGI parses flat fields. `alert_after_min` is owned by the
//        Alerts page and is never sent from here (an absent key leaves it alone).
//        success: { success: true }
//        failure: { success: false, error, detail }
//
// `save` never throws: it returns a result whose `error` is the translated
// backend reason (or null for the caller's generic copy).
//
// CGI: /cgi-bin/quecmanager/system/quality_thresholds.sh
// =============================================================================

const ENDPOINT = "/cgi-bin/quecmanager/system/quality_thresholds.sh";

interface QualityThresholdsGetResponse {
  success: boolean;
  thresholds?: QualityThresholdsSettings;
  isDefault?: boolean;
  error?: string;
  detail?: string;
}

export interface QualityThresholdsSaveResult {
  ok: boolean;
  /** Translated backend reason; null means use the caller's generic copy. */
  error: string | null;
}

export interface UseQualityThresholdsReturn {
  thresholds: QualityThresholdsSettings | null;
  /** No preset stored on the device yet; the built-in defaults apply. */
  isDefault: boolean;
  isLoading: boolean;
  loadFailed: boolean;
  isSaving: boolean;
  save: (settings: QualityThresholdsSettings) => Promise<QualityThresholdsSaveResult>;
  refresh: () => Promise<void>;
}

function failure(
  t: TFunction,
  json: { error?: unknown; detail?: unknown },
): QualityThresholdsSaveResult {
  const code = typeof json.error === "string" && json.error !== "" ? json.error : null;
  const message = code ? resolveErrorMessage(t, code, undefined, "") : "";
  return { ok: false, error: message || null };
}

export function useQualityThresholds(): UseQualityThresholdsReturn {
  const { t } = useTranslation("errors");
  const [thresholds, setThresholds] = useState<QualityThresholdsSettings | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const mountedRef = useRef(true);

  const fetchThresholds = useCallback(async () => {
    try {
      const response = await authFetch(ENDPOINT);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: QualityThresholdsGetResponse = await response.json();
      if (!mountedRef.current) return;

      if (!json.success || !json.thresholds) {
        setLoadFailed(true);
        return;
      }
      setThresholds(json.thresholds);
      setIsDefault(json.isDefault ?? false);
      setLoadFailed(false);
    } catch {
      if (mountedRef.current) setLoadFailed(true);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchThresholds();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchThresholds]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await fetchThresholds();
  }, [fetchThresholds]);

  const save = useCallback(
    async (settings: QualityThresholdsSettings): Promise<QualityThresholdsSaveResult> => {
      setIsSaving(true);
      try {
        // Custom raw values ride along only when their side's preset is `custom`.
        const body: Record<string, string | number> = {
          action: "save",
          latency_preset: settings.latency.preset,
          loss_preset: settings.loss.preset,
        };
        if (settings.latency.preset === "custom" && settings.latency.custom_ms != null) {
          body.latency_custom_ms = settings.latency.custom_ms;
        }
        if (settings.loss.preset === "custom" && settings.loss.custom_pct != null) {
          body.loss_custom_pct = settings.loss.custom_pct;
        }

        const response = await authFetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) return { ok: false, error: null };
        const json = await response.json();
        if (!json?.success) return failure(t, json ?? {});

        if (mountedRef.current) {
          // Saving an explicit preset clears the "using defaults" state.
          setThresholds(settings);
          setIsDefault(false);
        }
        return { ok: true, error: null };
      } catch {
        return { ok: false, error: null };
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [t],
  );

  return { thresholds, isDefault, isLoading, loadFailed, isSaving, save, refresh };
}
