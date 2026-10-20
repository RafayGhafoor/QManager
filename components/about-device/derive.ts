import type { AboutDeviceData } from "@/types/about-device";

import type { AboutView, DiscTone } from "./shapes";

// =============================================================================
// About Device — the surface's derived view state and its pure row builders
// =============================================================================
// The page shell calls `aboutView` ONCE and hands the answer down. No component
// on this surface may re-derive the condition from a payload's shape — that is
// how the retired page rendered a destructive alert in one card and six
// confident rows of "-" in the other, for a single failed request.
// =============================================================================

/**
 * The host `about.sh` asks for the public addresses, named in the Addresses
 * card's provenance line. It never decides reachability: that is the ping
 * daemon's verdict (`connectivity.internet_available`), the one source the
 * dashboard and watchdog read too.
 */
export const PUBLIC_IP_PROBE = "api.ipify.org";

/** The endpoint whose failure the band's notice quotes, in the machine voice. */
export const ABOUT_ENDPOINT_LABEL = "device/about.sh";

/** A field the device omitted arrives as `undefined`, not as an empty string. */
function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Everything the condition is derived FROM, as one argument. */
export interface AboutViewInput {
  data: AboutDeviceData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * The page's one condition. A failed re-read drops both cards to empty even
 * though stale figures are still in state, because the last thing the device
 * said is nothing.
 */
export function aboutView(input: AboutViewInput): AboutView {
  if (input.error) return "unreachable";
  if (input.data) return "loaded";
  if (input.isLoading) return "loading";
  return "unreachable";
}

/** The ping daemon's verdict: answering, not answering, or not reporting. */
export type InternetState = "reachable" | "unreachable" | "unknown";

export function internetState(data: AboutDeviceData): InternetState {
  const available = data.connectivity?.internet_available;
  if (available === true) return "reachable";
  if (available === false) return "unreachable";
  return "unknown";
}

/**
 * The ONE disc on this page that changes tone at runtime. A daemon that is not
 * reporting is neutral, not a fault.
 */
export function internetTone(data: AboutDeviceData): DiscTone {
  const state = internetState(data);
  if (state === "reachable") return "success";
  if (state === "unreachable") return "destructive";
  return "neutral";
}

/** "IPv4" / "IPv6" for the leg that answered, or "" when neither did. */
export function answeringFamily(data: AboutDeviceData): string {
  const family = text(data.connectivity?.last_family);
  if (family === "ipv4") return "IPv4";
  if (family === "ipv6") return "IPv6";
  return "";
}

/** The last round-trip in whole milliseconds, or null when there is none. */
export function internetLatency(data: AboutDeviceData): number | null {
  const ms = data.connectivity?.latency_ms;
  return typeof ms === "number" && Number.isFinite(ms) ? Math.round(ms) : null;
}

// -----------------------------------------------------------------------------
// Tile figures
// -----------------------------------------------------------------------------

/** The four band figures, normalized once so no tile re-reads the payload. */
export function identityFigures(data: AboutDeviceData) {
  return {
    model: text(data.device?.model),
    manufacturer: text(data.device?.manufacturer),
    firmware: text(data.device?.firmware),
    buildDate: text(data.device?.build_date),
    hostname: text(data.system?.hostname),
    kernel: text(data.system?.kernel_version),
  };
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

/**
 * One metric row. `labelKey` is a leaf under the surface's `aboutDevice`
 * section, so the builder stays free of `t()` and the component free of field
 * names.
 */
export interface MetricRow {
  id: string;
  labelKey: string;
  value: string;
  /** An identifier the device emits verbatim rides the mono face. */
  mono?: boolean;
}

/** A labelled cluster of rows. An absent `labelKey` means an unlabelled cluster. */
export interface MetricGroup {
  id: string;
  labelKey?: string;
  rows: MetricRow[];
}

/**
 * The Modem card. On this target `system.openwrt_version` is `DISTRIB_RELEASE`
 * from `/etc/openwrt_release` (the source read a Quectel Project Rev here), so
 * it is labelled as the OpenWrt version, beside Firmware.
 */
export function modemGroups(data: AboutDeviceData): MetricGroup[] {
  return [
    {
      id: "identity",
      rows: [
        {
          id: "manufacturer",
          labelKey: "rows.manufacturer",
          value: text(data.device?.manufacturer),
        },
        { id: "model", labelKey: "rows.model", value: text(data.device?.model) },
        {
          id: "firmware",
          labelKey: "rows.firmware",
          value: text(data.device?.firmware),
          mono: true,
        },
        {
          id: "openwrt_version",
          labelKey: "rows.openwrt_version",
          value: text(data.system?.openwrt_version),
          mono: true,
        },
        {
          id: "build_date",
          labelKey: "rows.build_date",
          value: text(data.device?.build_date),
        },
        {
          id: "imei",
          labelKey: "rows.imei",
          value: text(data.device?.imei),
          mono: true,
        },
      ],
    },
  ];
}

/** The Addresses card: where the device sits on the LAN and on the carrier. */
export function addressGroups(data: AboutDeviceData): MetricGroup[] {
  return [
    {
      id: "local",
      labelKey: "groups.local",
      rows: [
        {
          id: "device_ip",
          labelKey: "rows.device_ip",
          value: text(data.network?.device_ip),
          mono: true,
        },
        {
          id: "lan_subnet",
          labelKey: "rows.lan_subnet",
          value: text(data.network?.lan_subnet),
          mono: true,
        },
      ],
    },
    {
      id: "wwan",
      labelKey: "groups.wwan",
      rows: [
        {
          id: "wan_ipv4",
          labelKey: "rows.ipv4",
          value: text(data.network?.wan_ipv4),
          mono: true,
        },
        {
          id: "wan_ipv6",
          labelKey: "rows.ipv6",
          value: text(data.network?.wan_ipv6),
          mono: true,
        },
      ],
    },
    {
      id: "public",
      labelKey: "groups.public",
      rows: [
        {
          id: "public_ipv4",
          labelKey: "rows.ipv4",
          value: text(data.network?.public_ipv4),
          mono: true,
        },
        {
          id: "public_ipv6",
          labelKey: "rows.ipv6",
          value: text(data.network?.public_ipv6),
          mono: true,
        },
      ],
    },
  ];
}
