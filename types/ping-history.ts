// =============================================================================
// ping-history.ts — the persisted ping archive + restart log (history-v3)
// =============================================================================
// `fetch_ping_history.sh?range=` contract. The no-query form of the same CGI
// is unchanged (the 10 s NDJSON ring, `PingHistoryEntry` in modem-status.ts).
// Absent readings are `null`, never `0` (same rule as cell-history.ts).
// =============================================================================

export const PING_HISTORY_RANGES = ["1h", "6h", "24h", "7d"] as const;
export type PingHistoryRange = (typeof PING_HISTORY_RANGES)[number];

/** One bucket of the per-minute ping archive. */
export interface PingHistoryPoint {
  /** Bucket start, epoch seconds. */
  ts: number;
  /** Probes sent in the bucket. */
  n: number;
  /** Probes answered. */
  ok: number;
  /** RTT ms over answered probes; null when none answered. */
  avg: number | null;
  min: number | null;
  max: number | null;
  /** Jitter ms (mean abs delta of consecutive RTTs). */
  jit: number | null;
  /** 0-100 percent of probes lost. */
  loss: number;
}

/**
 * One device restart. Classified from the gap between the last persisted
 * ping-minute row ("last alive") and boot time.
 * - power_loss  gap > 180 s (power cut or long hang)
 * - restart     gap <= 180 s (kernel panic / watchdog / fast reset)
 * - planned     a planned reboot was logged (UI, scheduled, watchdog action)
 * - unknown     no heartbeat to compare against
 */
export type RestartCause = "power_loss" | "restart" | "planned" | "unknown";

export interface RestartEntry {
  boot_ts: number;
  last_alive_ts: number | null;
  down_sec: number | null;
  cause: RestartCause;
}

export interface PingHistoryRanged {
  success: true;
  range: PingHistoryRange;
  bucket_sec: number;
  generated_at: number;
  window: { start: number; end: number };
  /** Oldest first; buckets with no probes are omitted (chart breaks there). */
  points: PingHistoryPoint[];
  restarts: RestartEntry[];
  device_utc_offset_min: number;
}

export interface PingHistoryFailure {
  success: false;
  error: string;
  message?: string;
}

export type PingHistoryRangedResponse = PingHistoryRanged | PingHistoryFailure;
