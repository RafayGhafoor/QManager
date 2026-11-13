"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "@/lib/auth-fetch";
import { resolveErrorMessage } from "@/lib/i18n/resolve-error";
import type {
  DeviceHardwareResponse,
  DeviceHardwareState,
} from "@/types/device-hardware";

// =============================================================================
// useDeviceHardware: read this device's own board and Ethernet link.
// =============================================================================
// Backend: /cgi-bin/quecmanager/network/ethernet.sh (GET) — the endpoint the
// Ethernet page already owns. This hook reads only its additive `link` and
// `board` fields and never writes: the Hardware page shows what the device
// has, it does not configure the port.
//
// READ-ONLY AND DEGRADING: a backend that predates those fields answers
// successfully without them, which maps to `state === null`. That is not an
// error — the card reports "not reported" and the page keeps working in front
// of an older install, which is the normal state after an OTA rolls the
// backend back.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/network/ethernet.sh";

function toState(json: DeviceHardwareResponse): DeviceHardwareState | null {
  if (!json.link) return null;
  return {
    link: {
      operstate: json.link.operstate ?? "",
      speed: typeof json.link.speed === "number" ? json.link.speed : null,
      duplex: json.link.duplex ?? null,
    },
    board: json.board ?? null,
  };
}

export interface UseDeviceHardwareReturn {
  /** `null` until a read lands, and on a backend that does not report it. */
  state: DeviceHardwareState | null;
  isLoading: boolean;
  /** Load error only; there is no mutator to report one from. */
  error: string | null;
  refresh: () => void;
}

export function useDeviceHardware(): UseDeviceHardwareReturn {
  const { t } = useTranslation("errors");
  const [state, setState] = useState<DeviceHardwareState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
      const json: DeviceHardwareResponse = await resp.json();
      if (!mountedRef.current) return;
      if (!json.success) {
        setError(
          resolveErrorMessage(
            t,
            json.error,
            json.detail,
            "Failed to read device hardware",
          ),
        );
        return;
      }
      setState(toState(json));
    } catch (err) {
      if (!mountedRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to read device hardware",
      );
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const refresh = useCallback(() => {
    fetchState();
  }, [fetchState]);

  return { state, isLoading, error, refresh };
}
