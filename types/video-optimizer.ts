/**
 * The two engines the Video Optimizer can run on. `nfqws` hands packets to a
 * kernel packet queue; `tpws` redirects them to a local port. The backend picks
 * `tpws` as its default wherever the packet queue is unavailable, and refuses
 * `nfqws` on such a kernel.
 */
export type DpiEngine = "nfqws" | "tpws";

export interface VideoOptimizerSettings {
  enabled: boolean;
  other_enabled: boolean;
  engine: DpiEngine;
  status: "running" | "stopped" | "restarting" | "error";
  uptime: string;
  packets_processed: number;
  domains_loaded: number;
  desync_repeats: number;
  /** The selected engine's binary is installed. */
  binary_installed: boolean;
  /** Per-engine binary presence, so an engine whose binary is missing is offered disabled. */
  nfqws_installed: boolean;
  tpws_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface VideoOptimizerResponse {
  success: boolean;
  enabled: boolean;
  other_enabled: boolean;
  engine: DpiEngine;
  status: "running" | "stopped" | "restarting" | "error";
  uptime: string;
  packets_processed: number;
  domains_loaded: number;
  desync_repeats: number;
  binary_installed: boolean;
  nfqws_installed: boolean;
  tpws_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface VerifyResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  passed?: boolean;
  test_domain?: string;
  packets?: number;
  message?: string;
  error?: string;
}

export interface VideoOptimizerSavePayload {
  action: "save";
  enabled: boolean;
  desync_repeats?: number;
  engine?: DpiEngine;
}

export interface VideoOptimizerVerifyPayload {
  action: "verify";
}

export interface InstallResult {
  success: boolean;
  status: "idle" | "running" | "complete" | "error";
  message?: string;
  detail?: string;
  /** Installer transcript, when the backend streams one. */
  log?: string;
}

export interface TrafficMasqueradeSettings {
  enabled: boolean;
  other_enabled: boolean;
  status: "running" | "stopped" | "error";
  uptime: string;
  packets_processed: number;
  sni_domain: string;
  binary_installed: boolean;
  kernel_module_loaded: boolean;
}

export interface TrafficMasqueradeResponse extends TrafficMasqueradeSettings {
  success: boolean;
}

export interface HostlistResponse {
  success: boolean;
  domains: string[];
  default_domains: string[];
  count: number;
}

export interface MasqueradeTestResult {
  status: "idle" | "running" | "complete" | "error";
  injected?: boolean;
  packets?: number;
  message?: string;
  error?: string;
}
