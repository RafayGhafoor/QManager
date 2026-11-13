// =============================================================================
// The device's own hardware, as the Hardware page reads it
// =============================================================================
// A narrow view of `network/ethernet.sh`'s GET; the endpoint's full shape is
// declared once in `components/local-network/ethernet/types.ts` and is not
// restated here. This file carries only the additive `link` / `board` fields
// the Hardware page's read-only card needs.
//
// Both are optional ON PURPOSE. A backend older than those fields answers
// without them, and the card must report "not reported" rather than claim a
// port that does not exist in the payload.
// =============================================================================

export interface DeviceHardwareLink {
  /** `"up"` / `"down"` from `/sys/class/net/eth0/operstate`; `""` when absent. */
  operstate: string;
  /** Negotiated rate in Mb/s, or `null` while the link is down (sysfs says -1). */
  speed: number | null;
  /** `"full"` / `"half"`, or `null` before the link negotiates. */
  duplex: string | null;
}

export interface DeviceHardwareState {
  link: DeviceHardwareLink;
  /** The board model (`ZX7981POEQ`), or `null` when sysinfo has neither file. */
  board: string | null;
}

/** The GET's payload. Fields beyond these belong to the Ethernet page. */
export interface DeviceHardwareResponse {
  success: boolean;
  error?: string;
  detail?: string;
  link?: DeviceHardwareLink | null;
  board?: string | null;
}
