import { describe, expect, it } from "bun:test";
import {
  calculateLteDistance,
  calculateNrDistance,
  formatDistance,
} from "./modem-status";

// The raw values below are what the modems actually answer on
// `AT+QNWCFG="nr5g_time_advance"` / `"lte_time_advance"`, and the distance row
// went blank on the NR leg because a negative N_TA was refused. What matters
// here is that neither leg can be silently dropped.

describe("calculateLteDistance", () => {
  it("converts a TA index to km (one step = 78.125 m)", () => {
    // Live device: lte.ta = 43 -> 3.36 km.
    expect(calculateLteDistance(43)).toBeCloseTo(3.359375, 6);
  });

  it("treats index 0 as inside the first step, not as absent", () => {
    expect(calculateLteDistance(0)).toBe(0);
    expect(formatDistance(calculateLteDistance(0))).toBe("< 10 m");
  });

  it("refuses an index past the 3GPP ceiling", () => {
    expect(calculateLteDistance(1283)).toBeNull();
    expect(calculateLteDistance(1968)).toBeNull();
  });

  it("returns null when the poller published nothing", () => {
    expect(calculateLteDistance(null)).toBeNull();
  });
});

describe("calculateNrDistance", () => {
  it("converts N_TA to km (one unit = 76.29 mm)", () => {
    expect(calculateNrDistance(25600)).toBeCloseTo(1.9531, 4);
  });

  it("renders a NEGATIVE N_TA, which means the cell is on the reference", () => {
    // Measured on a Quectel 5G modem: "nr5g_time_advance",1,-512,0.
    const km = calculateNrDistance(-512);
    expect(km).toBeCloseTo(0.03906, 5);
    expect(formatDistance(km)).toBe("39 m");
  });

  it("renders N_TA 0 as inside the first step, not as absent", () => {
    expect(calculateNrDistance(0)).toBe(0);
    expect(formatDistance(calculateNrDistance(0))).toBe("< 10 m");
  });

  it("refuses a large negative reading instead of clamping it to zero", () => {
    expect(calculateNrDistance(-2048)).toBeNull();
    expect(calculateNrDistance(-29696)).toBeNull();
  });

  it("returns null when the poller published nothing", () => {
    expect(calculateNrDistance(null)).toBeNull();
  });
});
