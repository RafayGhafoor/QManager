import { describe, expect, it } from "bun:test";
import type { BandwidthInterfaceData } from "@/types/bandwidth-monitor";
import { selectAggregateInterfaces } from "../use-bandwidth-monitor";

// =============================================================================
// selectAggregateInterfaces — the Live Traffic aggregate must count each byte
// once, on every hardware QManager ships on, and must not change behaviour on
// hardware where none of this applies.
// =============================================================================

function iface(
  name: string,
  rxMbps = 0,
  txMbps = 0,
  state: "up" | "down" = "up",
): BandwidthInterfaceData {
  return {
    name,
    state,
    rx: { bps: rxMbps * 1_000_000 },
    tx: { bps: txMbps * 1_000_000 },
  };
}

const names = (ifaces: BandwidthInterfaceData[]) => ifaces.map((i) => i.name);

/** Total the hook would publish for this feed. */
function aggregate(ifaces: BandwidthInterfaceData[]) {
  const selected = selectAggregateInterfaces(ifaces);
  return {
    names: names(selected),
    downloadMbps:
      selected.reduce((sum, i) => sum + i.rx.bps, 0) / 1_000_000,
    uploadMbps: selected.reduce((sum, i) => sum + i.tx.bps, 0) / 1_000_000,
  };
}

describe("selectAggregateInterfaces", () => {
  describe("the reported bug: a 260/40 line read 550/530", () => {
    // Real feed from the Suncomm X75 / RM551E-GL this was diagnosed on
    // (2026-10-18, during an Ookla run whose final result was 265.7/43.6).
    const feed = [
      iface("rmnet_mhi0.1", 265.7, 43.6),
      iface("rmnet_mhi0", 267.1, 43.4), // parent — same bytes
      iface("br-lan", 0.1, 0.4), // LAN bridge
      iface("eth0", 0.1, 0.4), // bridge member — same bytes as br-lan
      iface("ipsec0", 0, 0),
    ];

    it("reports the wire rate, not the double-counted sum", () => {
      const { downloadMbps, uploadMbps } = aggregate(feed);
      expect(downloadMbps).toBeCloseTo(265.7, 1);
      expect(uploadMbps).toBeCloseTo(43.6, 1);
    });

    it("does not double count the parent netdev or the bridge", () => {
      expect(names(selectAggregateInterfaces(feed))).toEqual(["rmnet_mhi0.1"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Other units — each of these must keep reporting a sane total.
  // ---------------------------------------------------------------------------

  describe("RM551E-GL / RM520N-GL (QMAP, multiple PDNs)", () => {
    it("sums the data interfaces and drops only the parent", () => {
      const selected = selectAggregateInterfaces([
        iface("rmnet_mhi0"),
        iface("rmnet_mhi0.1"),
        iface("rmnet_data0"),
        iface("rmnet_data1"),
        iface("br-lan"),
        iface("eth0"),
      ]);
      expect(names(selected)).toEqual([
        "rmnet_mhi0.1",
        "rmnet_data0",
        "rmnet_data1",
      ]);
    });
  });

  describe("single bearer without a sub-interface", () => {
    it("keeps rmnet_mhi0 when no rmnet_mhi0.N is reported", () => {
      expect(
        names(selectAggregateInterfaces([iface("rmnet_mhi0"), iface("br-lan")])),
      ).toEqual(["rmnet_mhi0"]);
    });

    it("drops rmnet_data0 when rmnet_data0.1 is reported", () => {
      expect(
        names(
          selectAggregateInterfaces([
            iface("rmnet_data0"),
            iface("rmnet_data0.1"),
            iface("br-lan"),
          ]),
        ),
      ).toEqual(["rmnet_data0.1"]);
    });
  });

  describe("RM500Q in raw-ip mode (wwan0, no rmnet namespace)", () => {
    it("uses wwan0 rather than the bridge + member sum", () => {
      expect(
        names(
          selectAggregateInterfaces([
            iface("wwan0"),
            iface("br-lan"),
            iface("eth0"),
            iface("wlan0"),
          ]),
        ),
      ).toEqual(["wwan0"]);
    });
  });

  describe("IPA-era modems", () => {
    it("ignores rmnet_ipa0 and counts the data interface", () => {
      expect(
        names(
          selectAggregateInterfaces([
            iface("rmnet_ipa0"),
            iface("rmnet_data0"),
            iface("br-lan"),
          ]),
        ),
      ).toEqual(["rmnet_data0"]);
    });
  });

  describe("hardware with no bearer (ethernet WAN)", () => {
    it("falls back to the previous behaviour: sum every non-excluded interface", () => {
      const feed = [iface("br-lan"), iface("eth0"), iface("wlan0")];
      expect(names(selectAggregateInterfaces(feed))).toEqual([
        "br-lan",
        "eth0",
        "wlan0",
      ]);
    });

    it("falls back when the only bearer-looking interface is excluded", () => {
      expect(
        names(
          selectAggregateInterfaces([
            iface("rmnet_ipa0"),
            iface("tailscale0"),
            iface("br-lan"),
            iface("eth0"),
          ]),
        ),
      ).toEqual(["br-lan", "eth0"]);
    });
  });

  describe("filters that existed before this fix", () => {
    it("drops down interfaces and the known aliases", () => {
      expect(
        names(
          selectAggregateInterfaces([
            iface("rmnet_mhi0.1", 1, 1, "down"),
            iface("rmnet_mhi0.2", 1, 1),
            iface("tailscale0", 1, 1),
            iface("rmnet_data2", 1, 1),
          ]),
        ),
      ).toEqual(["rmnet_mhi0.2"]);
    });

    it("returns an empty selection for an empty feed", () => {
      expect(selectAggregateInterfaces([])).toEqual([]);
    });
  });
});
