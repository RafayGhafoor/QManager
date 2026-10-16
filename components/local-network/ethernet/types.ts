// =============================================================================
// The ethernet CGI's GET shape (`network/ethernet.sh`)
// =============================================================================
// One declaration shared by the page shell and the two components it renders.
// =============================================================================

export interface EthernetStatus {
  /** `"up"` or `"down"`. Anything else is treated as an unknown link. */
  link_status: string;
  /** `"2500Mb/s"` from sysfs, or `"Unknown"`. Meaningless while the link is down. */
  speed: string;
  /** `"full"` / `"half"` / `"Unknown"`. Same caveat. */
  duplex: string;
  /** The PHY's LIVE autonegotiation state: `"on"`, `"off"` or `"Unknown"`. */
  auto_negotiation: string;
  /** The SAVED limit: `"auto" | "10" | "100" | "1000" | "2500"`. */
  speed_limit: string;
  /** Whether the PHY can do 2.5G. Gates the dropdown option and the rate tile's ceiling caption. */
  supports_2500?: boolean;
  /**
   * Whether there is an `eth0` at all. A missing value means TRUE.
   *
   * The target's GET never sends this field: it answers
   * `{success: false, error: "interface_not_found"}` instead, and the shell maps
   * that envelope to `interface_present: false`. Kept optional so a backend that
   * does send it (the RM520N fork's) reads the same way.
   */
  interface_present?: boolean;
}
