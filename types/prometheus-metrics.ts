// =============================================================================
// Prometheus metrics — settings contract
// =============================================================================
// Mirrors `monitoring/prometheus.sh` (GET / POST). The scrape endpoint itself
// (`metrics/prometheus.sh`) speaks Prometheus text, not JSON, and is never
// called by the UI. See docs/features/prometheus-metrics.md.
// =============================================================================

/** Whether scrapes may hold the adaptive poller at a faster cadence. */
export type MetricsFreshness = "adaptive" | "balanced" | "realtime";

export const METRICS_FRESHNESS: readonly MetricsFreshness[] = [
  "adaptive",
  "balanced",
  "realtime",
] as const;

export interface PrometheusSettings {
  enabled: boolean;
  freshness: MetricsFreshness;
  /** 64 lowercase hex, or "" when none has been generated yet. */
  token: string;
}

export interface PrometheusLastScrape {
  age_seconds: number;
  mode: string;
}

export interface PrometheusStatusResponse {
  success: boolean;
  settings?: PrometheusSettings;
  /** Path of the scrape endpoint on this device, e.g. `/cgi-bin/…/prometheus.sh`. */
  endpoint_path?: string;
  /** The HTTPS port the web UI listens on; the scrape config targets it. */
  https_port?: number;
  /** `null` when no authenticated scrape has arrived since boot. */
  last_scrape?: PrometheusLastScrape | null;
  /** True while a recent scrape is holding the poller at a faster tier. */
  holding?: boolean;
  poller?: {
    adaptive_enabled: boolean;
    tier: string | null;
  };
  error?: string;
  detail?: string;
}

export type PrometheusSaveRequest = {
  action: "save";
  enabled: boolean;
  freshness: MetricsFreshness;
};

export type PrometheusRegenerateRequest = { action: "regenerate_token" };
