// =============================================================================
// Host AT ports — shared types
// =============================================================================
// Backend: /cgi-bin/quecmanager/system/host_at_ports.sh (port-bridge on/off)
// See docs/features/at-broker.md.
// =============================================================================

export interface HostAtPortsState {
  /** The vendor bridge service exists on this firmware. */
  available: boolean;
  /** Saved choice (UCI). */
  enabled: boolean;
  /** The bridge is actually running. */
  running: boolean;
  /** The modem is installed in a PCIe host (the host's AT port is the PCIe link). */
  pcie: boolean;
}

export interface HostAtPortsResponse {
  success: boolean;
  available?: boolean;
  enabled?: boolean;
  running?: boolean;
  pcie?: boolean;
  error?: string;
  detail?: string;
}

/** What a mutator returns, so the caller toasts from the call's own result. */
export interface MutationResult {
  ok: boolean;
  error?: string;
}
