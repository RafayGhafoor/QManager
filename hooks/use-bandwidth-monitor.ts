"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  BandwidthSettings,
  BandwidthStatus,
  BandwidthMessage,
  BandwidthInterfaceData,
  BandwidthChartPoint,
} from "@/types/bandwidth-monitor";

// =============================================================================
// useBandwidthMonitor — WebSocket hook for live bandwidth data (Dashboard)
// =============================================================================
// Fetches bandwidth settings via HTTP, then connects to the WebSocket server
// when bandwidth monitoring is enabled and running.
//
// Returns rolling chart data (15 seconds), current speeds,
// per-interface breakdown, and connection state.
// =============================================================================

const CGI_ENDPOINT = "/cgi-bin/quecmanager/monitoring/bandwidth.sh";
const CHART_WINDOW_MS = 15_000; // keep last 15 seconds of data
const STATE_SYNC_INTERVAL = 500; // ms — coalesce buffer→state updates
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/** Interfaces to exclude from aggregate speed calculation and display */
const EXCLUDED_INTERFACES = new Set(["rmnet_ipa0", "rmnet_data2", "tailscale0"]);

/**
 * The modem bearer namespace: `rmnet_mhi0`, `rmnet_mhi0.1`, `rmnet_data0`, ...
 * (QMAP/MHI modems) and `wwan0` (qmi_wwan in raw-ip mode, e.g. some RM500Q
 * firmware). Anything else that reports traffic — bridges, bridge member
 * ports, tunnels — is not a bearer.
 */
const BEARER_NAME_RE = /^(?:rmnet_|wwan\d)/;

// =============================================================================
// selectAggregateInterfaces — sum every byte exactly once
// =============================================================================
// The monitor reports EVERY interface it discovers, and the same bytes appear
// on more than one of them:
//
//   rmnet_mhi0 + rmnet_mhi0.1   parent netdev and its data sub-interface; both
//                               counters advance for the same bearer bytes
//   br-lan + eth0               a bridge and the member port it forwards to
//
// Summing the whole array therefore roughly doubles the reading. Measured on a
// Suncomm X75 (RM551E-GL) on 2026-10-18: a download the wire (and Ookla's own
// final result) put at 265.7 Mbps read 534-574 Mbps in the Live Traffic row,
// and a 43.6 Mbps upload read 88-105 Mbps.
//
// The aggregate answers one question — how busy is the modem link — so it sums
// the bearer only. The LAN side and the bearer's parent netdev are aliases of
// the same traffic, not extra traffic.
//
// This is deliberately conservative for other hardware:
//   - A unit that reports no bearer at all (WAN is an ethernet port, or an
//     unrecognised modem namespace) keeps the previous behaviour exactly:
//     sum every interface that is not explicitly excluded.
//   - Multiple bearers are still summed, so a multi-PDN QMAP setup
//     (rmnet_data0 + rmnet_data1) reports the same total as before.
//   - A parent is dropped only when its `.N` sub-interface is actually
//     reported, so an RM520N exposing just `rmnet_mhi0` is unaffected.
//   - Down interfaces and EXCLUDED_INTERFACES are dropped as before.
// The per-interface array handed to callers is never modified.
function selectAggregateInterfaces(
  ifaces: BandwidthInterfaceData[],
): BandwidthInterfaceData[] {
  const up = ifaces.filter(
    (iface) => iface.state === "up" && !EXCLUDED_INTERFACES.has(iface.name),
  );

  const bearers = up.filter((iface) => BEARER_NAME_RE.test(iface.name));
  if (bearers.length === 0) return up;

  // Drop a parent netdev when its data sub-interface is also reported.
  const bearerNames = bearers.map((iface) => iface.name);
  return bearers.filter(
    (iface) =>
      !bearerNames.some((name) => name.startsWith(`${iface.name}.`)),
  );
}

export { selectAggregateInterfaces };

export interface UseBandwidthMonitorReturn {
  /** Rolling chart data points (last 15 seconds) */
  chartData: BandwidthChartPoint[];
  /** Latest aggregate download speed in bits per second */
  currentDownload: number;
  /** Latest aggregate upload speed in bits per second */
  currentUpload: number;
  /** Per-interface data from the latest message */
  interfaces: BandwidthInterfaceData[];
  /** Whether the WebSocket is currently connected */
  isConnected: boolean;
  /** Whether bandwidth monitoring is enabled in settings */
  isEnabled: boolean;
  /** Whether settings are still loading */
  isLoading: boolean;
  /** WebSocket error message, if any */
  wsError: string | null;
}

export function useBandwidthMonitor(): UseBandwidthMonitorReturn {
  // ─── Settings state (from HTTP) ────────────────────────────────────────────
  const [settings, setSettings] = useState<BandwidthSettings | null>(null);
  const [status, setStatus] = useState<BandwidthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ─── WebSocket state ───────────────────────────────────────────────────────
  const [chartData, setChartData] = useState<BandwidthChartPoint[]>([]);
  const [currentDownload, setCurrentDownload] = useState(0);
  const [currentUpload, setCurrentUpload] = useState(0);
  const [interfaces, setInterfaces] = useState<BandwidthInterfaceData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_BASE_MS);
  const bufferRef = useRef<BandwidthChartPoint[]>([]);
  const latestDownloadRef = useRef(0);
  const latestUploadRef = useRef(0);
  const latestInterfacesRef = useRef<BandwidthInterfaceData[]>([]);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ─── Fetch settings via HTTP ───────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    try {
      const resp = await authFetch(CGI_ENDPOINT);
      if (!resp.ok) return;
      const json = await resp.json();
      if (!mountedRef.current || !json.success) return;
      setSettings(json.settings);
      setStatus(json.status);
    } catch {
      // Settings fetch failure is non-fatal — feature just won't connect
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ─── Buffer → state sync (coalesced to avoid excessive re-renders) ────────

  useEffect(() => {
    syncTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const buf = bufferRef.current;
      if (buf.length > 0) {
        setChartData([...buf]);
      }
      setCurrentDownload(latestDownloadRef.current);
      setCurrentUpload(latestUploadRef.current);
      setInterfaces([...latestInterfacesRef.current]);
    }, STATE_SYNC_INTERVAL);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, []);

  // ─── WebSocket connection ──────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (!settings || !mountedRef.current) return;

    const host =
      typeof window !== "undefined" && window.location.hostname === "localhost"
        ? "192.168.224.1"
        : typeof window !== "undefined"
          ? window.location.hostname
          : "192.168.224.1";

    const url = `ws://${host}:${settings.ws_port}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setIsConnected(true);
        setWsError(null);
        reconnectDelayRef.current = RECONNECT_BASE_MS;
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const msg: BandwidthMessage = JSON.parse(event.data);
          if (msg.channel !== "network-monitor") return;

          // Keep only real, non-aliased interfaces before summing — see
          // selectAggregateInterfaces above.
          const activeInterfaces = selectAggregateInterfaces(msg.interfaces || []);

          // Aggregate speeds across active interfaces
          const totalDownload = activeInterfaces.reduce(
            (sum, iface) => sum + (iface.rx?.bps || 0),
            0,
          );
          const totalUpload = activeInterfaces.reduce(
            (sum, iface) => sum + (iface.tx?.bps || 0),
            0,
          );

          // Update refs (synced to state periodically)
          latestDownloadRef.current = totalDownload;
          latestUploadRef.current = totalUpload;
          latestInterfacesRef.current = msg.interfaces || [];

          // Push to rolling buffer, trim by time window
          const now = Date.now();
          const point: BandwidthChartPoint = {
            timestamp: now,
            download: totalDownload,
            upload: totalUpload,
          };

          const buf = bufferRef.current;
          buf.push(point);
          // Evict points older than the time window
          const cutoff = now - CHART_WINDOW_MS;
          const firstValid = buf.findIndex((p) => p.timestamp >= cutoff);
          if (firstValid > 0) {
            bufferRef.current = buf.slice(firstValid);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        wsRef.current = null;

        // Schedule reconnect with exponential backoff
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(
          delay * 2,
          RECONNECT_MAX_MS,
        );
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setWsError("WebSocket connection error");
        // onclose will handle reconnect
      };
    } catch {
      if (mountedRef.current) {
        setWsError("Failed to create WebSocket connection");
      }
    }
  }, [settings]);

  // ─── Connect/disconnect based on settings ──────────────────────────────────

  useEffect(() => {
    const shouldConnect =
      settings?.enabled &&
      status?.websocat_running &&
      status?.monitor_running;

    if (shouldConnect) {
      connect();
    }

    return () => {
      // Cleanup on unmount or settings change
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [settings, status, connect]);

  return {
    chartData,
    currentDownload,
    currentUpload,
    interfaces,
    isConnected,
    isEnabled: settings?.enabled ?? false,
    isLoading,
    wsError,
  };
}
