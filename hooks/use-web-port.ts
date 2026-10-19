"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  WebPortResponse,
  WebPortSaveResult,
  WebPortState,
} from "@/types/web-port";
import { DEFAULT_HTTP_PORT, DEFAULT_HTTPS_PORT } from "@/types/web-port";

// =============================================================================
// useWebPort: read/change the ports QManager is served on.
// =============================================================================
// Backend: /cgi-bin/quecmanager/system/web_port.sh
//   GET                                   → { http_port, https_port, listening, last_result }
//   POST {"http_port": N, "https_port": N} → { apply_in_progress, http_port, https_port }
//
// A POST that moves the port is self-severing: the server restarts about 1 s
// after replying, so the caller moves the browser (lib/web-port.ts). The
// mutator returns its own result for the caller's toast.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/system/web_port.sh";

function toState(json: WebPortResponse): WebPortState {
  return {
    httpPort: json.http_port ?? DEFAULT_HTTP_PORT,
    httpsPort: json.https_port ?? DEFAULT_HTTPS_PORT,
    listening: {
      http: json.listening?.http === true,
      https: json.listening?.https === true,
    },
    lastResult: json.last_result ?? null,
  };
}

export interface UseWebPortReturn {
  state: WebPortState | null;
  isLoading: boolean;
  isSaving: boolean;
  /** Load error only; a failed save is reported through the mutator's result. */
  error: string | null;
  save: (httpPort: number, httpsPort: number) => Promise<WebPortSaveResult>;
  refresh: () => void;
}

export function useWebPort(): UseWebPortReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<WebPortState | null>(null);
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
      const json: WebPortResponse = await resp.json();
      if (!mountedRef.current) return;
      if (!json.success) {
        setError(resolveErrorMessage(t, json.error, json.detail, "Failed to read the web port"));
        return;
      }
      setState(toState(json));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to read the web port");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const save = useCallback(
    async (httpPort: number, httpsPort: number): Promise<WebPortSaveResult> => {
      setIsSaving(true);
      try {
        const resp = await authFetch(CGI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ http_port: httpPort, https_port: httpsPort }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const json: WebPortResponse = await resp.json();
        if (!json.success) {
          return {
            ok: false,
            error: resolveErrorMessage(t, json.error, json.detail, "Failed to change the web port"),
          };
        }
        const next = {
          ok: true,
          moving: json.apply_in_progress === true,
          httpPort: json.http_port ?? httpPort,
          httpsPort: json.https_port ?? httpsPort,
        };
        if (mountedRef.current) {
          setState((prev) =>
            prev ? { ...prev, httpPort: next.httpPort, httpsPort: next.httpsPort } : prev,
          );
        }
        return next;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to change the web port",
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

  return { state, isLoading, isSaving, error, save, refresh };
}
