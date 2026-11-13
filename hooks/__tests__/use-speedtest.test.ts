import { describe, expect, it } from "bun:test";
import { asRunningPhase, LIVE_INTERVAL_MS } from "../use-speedtest";

// `speedtest_status.sh` answers `"phase":"running"` for any NDJSON line whose
// `type` it does not model, and `{"type":"log",...}` events are interleaved with
// the progress lines. Adopting that string as a phase made `isRunning` false, so
// this hook's self-scheduling poll loop stopped mid-run (and the dialog, which
// only polls while running, froze for good). Only the four steps may be adopted.

describe("asRunningPhase", () => {
  it("accepts the four steps the poll loop can be in", () => {
    expect(asRunningPhase("initializing")).toBe("initializing");
    expect(asRunningPhase("ping")).toBe("ping");
    expect(asRunningPhase("download")).toBe("download");
    expect(asRunningPhase("upload")).toBe("upload");
  });

  it("refuses the endpoint's catch-all 'running' phase", () => {
    expect(asRunningPhase("running")).toBeNull();
  });

  it("refuses an absent phase (the endpoint's lock-contention answer)", () => {
    expect(asRunningPhase(undefined)).toBeNull();
    expect(asRunningPhase(null)).toBeNull();
    expect(asRunningPhase("")).toBeNull();
  });

  it("refuses the terminal states, which arrive as `status`, not `phase`", () => {
    expect(asRunningPhase("complete")).toBeNull();
    expect(asRunningPhase("error")).toBeNull();
    expect(asRunningPhase("idle")).toBeNull();
  });
});

describe("LIVE_INTERVAL_MS", () => {
  // speedtest-dialog.tsx animates the meter linearly over exactly this number;
  // a second copy there would leave the bar lagging with no error anywhere.
  it("is the single number the meter's transition duration is derived from", () => {
    expect(LIVE_INTERVAL_MS).toBe(500);
  });
});
