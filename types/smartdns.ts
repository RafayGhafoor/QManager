// =============================================================================
// smartdns.ts — the SmartDNS page's wire types
// =============================================================================
// Mirrors network/smartdns.sh's GET body. The endpoint reports TWO independent
// switches and they are deliberately not one boolean:
//
//   enabled  — the resolver process runs on 127.0.0.1
//   lan_dns  — dnsmasq's upstream list is ordered to try the resolver first
//
// Only `lan_dns` changes what a client on the LAN resolves through, which is why
// it is its own field, its own row and its own default (off).
//
// NULLABILITY IS THE POINT OF SEVERAL FIELDS HERE. `pid`, `uptime_sec`, `rss_kb`
// and `config_*` are `null` when there is nothing to report — not 0. A stopped
// resolver that rendered "0 MB RSS" would look like an instrument reading rather
// than an absence, and the whole page is an instrument.
// =============================================================================

/** Where a package operation got to. Absent (`null`) means never started. */
export interface SmartDnsInstallState {
  success: boolean;
  status: "installing" | "complete" | "error";
  /** Already-translated-free English from the device, e.g. "Installed". */
  message: string;
  /** The helper's own reason: an opkg tail, or the binary path. May be empty. */
  detail: string;
}

/** The settings the page edits — one object, saved in one POST. */
export interface SmartDnsSettings {
  enabled: boolean;
  lan_dns: boolean;
  cache_size: number;
  prefetch: boolean;
  /** Upstream URLs, e.g. `https://dns.google/dns-query`. */
  upstreams: string[];
}

/** Response from GET /cgi-bin/quecmanager/network/smartdns.sh */
export interface SmartDnsStatus {
  /** The resolver package is present on the device. False is a normal state. */
  installed: boolean;
  /** Absolute path of the resolver binary, or `null` when not installed. */
  binary: string | null;
  /** What the operator asked for. */
  enabled: boolean;
  /** A resolver process is running. `enabled && !running` is a real, drawable state. */
  running: boolean;
  /**
   * Something is bound to the configured loopback port. Separate from `running`
   * because a process that started and could not bind is the failure the page
   * most needs to show.
   */
  listening: boolean;
  pid: number | null;
  uptime_sec: number | null;
  rss_kb: number | null;
  /** The loopback port. Fixed by the backend; shown, never edited here. */
  port: number;
  config_path: string | null;
  config_size: number | null;
  /** Epoch seconds. */
  config_mtime: number | null;
  /** Configured upstream count, including ones this page does not offer. */
  upstream_count: number;
  cache_size: number;
  prefetch: boolean;
  lan_dns: boolean;
  /** The resolver entry is present in dnsmasq's upstream list. */
  wired: boolean;
  /**
   * `server` entries in dnsmasq that are neither the resolver nor the carrier
   * fallbacks this feature added — i.e. someone else's upstreams (Custom DNS,
   * or a hand edit). They sit behind the resolver because `strictorder` is on,
   * and the page says so instead of pretending the list is only ours.
   */
  other_upstreams: number;
  /**
   * The carrier's own nameservers, read live from the device. These are what
   * dnsmasq falls through to when the resolver does not answer. Empty means no
   * fallback was found — and in that case the backend refuses to wire at all.
   */
  carrier_resolvers: string[];
  settings: SmartDnsSettings;
  /** Recent daemon log lines, oldest first. A ring buffer read, not a counter. */
  logs_tail: string[];
  install: SmartDnsInstallState | null;
}
