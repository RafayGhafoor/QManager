import { describe, expect, test } from "bun:test";
import { GRADES, gradeQuality, gradientStops } from "./quality-grade";

describe("quality-grade", () => {
  test("SINR -5..25: red below 0, amber 0..13, green above", () => {
    const stops = gradientStops(-5, 25, GRADES.sinr)!;
    expect(stops[0]).toEqual({ offset: 0, color: "var(--quality-5-bar)" });
    expect(stops.at(-1)).toEqual({ offset: 1, color: "var(--quality-2-bar)" });
    // the fair cut (0 dB) sits 25/30 of the way down
    const fair = stops.filter((s) => Math.abs(s.offset - 25 / 30) < 1e-9);
    expect(fair.map((s) => s.color)).toEqual(["var(--quality-3-bar)", "var(--quality-2-bar)"]);
  });
  test("flat line -> null (caller paints one solid colour)", () => {
    expect(gradientStops(10, 10, GRADES.sinr)).toBeNull();
  });
  test("lower-is-better: TX power near the 23 dBm limit is poor", () => {
    expect(gradeQuality(22, GRADES.tx_power)).toBe("poor");
    expect(gradeQuality(-10, GRADES.nr_tx_power)).toBe("excellent");
    expect(gradeQuality(null, GRADES.lat)).toBe("none");
  });
  test("antenna: -123 dBm is poor, -58 excellent", () => {
    expect(gradeQuality(-123, GRADES.rsrp)).toBe("poor");
    expect(gradeQuality(-58, GRADES.rsrp)).toBe("excellent");
  });
});
