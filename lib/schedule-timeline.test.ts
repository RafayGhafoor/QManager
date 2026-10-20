// Run with: bun test lib/schedule-timeline.test.ts
import { describe, it, expect } from "bun:test";
import {
  buildDayTimeline,
  nextScenarioChange,
  formatMinute,
} from "./schedule-timeline";
import { resolveScheduledScenario } from "./scenario-schedule";
import type { ScenarioSchedule, DayOfWeek } from "@/types/sim-profile";

const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

/** 2024-01-07 is a Sunday; add `dow` days for the target weekday. */
function at(dow: DayOfWeek, hh: number, mm: number): Date {
  return new Date(2024, 0, 7 + dow, hh, mm, 0, 0);
}

function segAt(
  s: ScenarioSchedule,
  dow: DayOfWeek,
  minute: number,
  def = "balanced",
): string {
  const tl = buildDayTimeline(s, def, at(dow, Math.floor(minute / 60), minute % 60));
  const seg = tl.segments.find(
    (x) => minute >= x.startMinute && minute < x.endMinute,
  );
  return seg!.scenarioId;
}

function totals(s: ScenarioSchedule) {
  const tl = buildDayTimeline(s, "balanced", at(1, 12, 0));
  let cursor = 0;
  for (const seg of tl.segments) {
    expect(seg.startMinute).toBe(cursor);
    cursor = seg.endMinute;
  }
  expect(cursor).toBe(1440);
  expect(tl.segments.filter((x) => x.isLive).length).toBe(1);
}

describe("buildDayTimeline", () => {
  it("no schedule -> one default segment", () => {
    const s: ScenarioSchedule = { enabled: false, blocks: [] };
    const tl = buildDayTimeline(s, "balanced", at(1, 9, 30));
    expect(tl.segments).toHaveLength(1);
    expect(tl.segments[0]).toMatchObject({
      startMinute: 0,
      endMinute: 1440,
      scenarioId: "balanced",
      isLive: true,
      flexBasis: 1440,
    });
    expect(tl.nowMinute).toBe(570);
  });

  it("normal window", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [{ start: "08:00", end: "12:00", days: ALL_DAYS, scenario: "gaming" }],
    };
    totals(s);
    const tl = buildDayTimeline(s, "balanced", at(1, 9, 0));
    expect(tl.segments.map((x) => [x.startMinute, x.endMinute, x.scenarioId])).toEqual([
      [0, 480, "balanced"],
      [480, 720, "gaming"],
      [720, 1440, "balanced"],
    ]);
    expect(tl.segments[1].isLive).toBe(true);
  });

  it("overnight wrap draws two bands", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [{ start: "22:00", end: "06:00", days: ALL_DAYS, scenario: "streaming" }],
    };
    totals(s);
    const tl = buildDayTimeline(s, "balanced", at(1, 3, 0));
    expect(tl.segments.map((x) => [x.startMinute, x.endMinute, x.scenarioId])).toEqual([
      [0, 360, "streaming"],
      [360, 1320, "balanced"],
      [1320, 1440, "streaming"],
    ]);
  });

  it("overlap: first block in array order wins", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [
        { start: "08:00", end: "12:00", days: ALL_DAYS, scenario: "gaming" },
        { start: "10:00", end: "14:00", days: ALL_DAYS, scenario: "streaming" },
      ],
    };
    expect(segAt(s, 1, 11 * 60)).toBe("gaming");
    expect(segAt(s, 1, 12 * 60 + 30)).toBe("streaming");
  });

  it("touching blocks: end exclusive, start inclusive", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [
        { start: "08:00", end: "12:00", days: ALL_DAYS, scenario: "gaming" },
        { start: "12:00", end: "18:00", days: ALL_DAYS, scenario: "streaming" },
      ],
    };
    expect(segAt(s, 1, 719)).toBe("gaming");
    expect(segAt(s, 1, 720)).toBe("streaming");
  });

  it("segment at midnight (block starting at 00:00)", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [{ start: "00:00", end: "06:00", days: ALL_DAYS, scenario: "gaming" }],
    };
    totals(s);
    expect(segAt(s, 1, 0)).toBe("gaming");
    expect(segAt(s, 1, 359)).toBe("gaming");
    expect(segAt(s, 1, 360)).toBe("balanced");
  });

  it("empty days is inert and zero-length never matches", () => {
    const s: ScenarioSchedule = {
      enabled: true,
      blocks: [
        { start: "08:00", end: "12:00", days: [], scenario: "gaming" },
        { start: "13:00", end: "13:00", days: ALL_DAYS, scenario: "streaming" },
      ],
    };
    const tl = buildDayTimeline(s, "balanced", at(1, 9, 0));
    expect(tl.segments).toHaveLength(1);
  });
});

describe("nextScenarioChange / formatMinute", () => {
  const s: ScenarioSchedule = {
    enabled: true,
    blocks: [{ start: "08:00", end: "12:00", days: ALL_DAYS, scenario: "gaming" }],
  };
  it("finds the next boundary and wraps", () => {
    const tl = buildDayTimeline(s, "balanced", at(1, 9, 0));
    expect(nextScenarioChange(tl.segments, 540)).toEqual({
      atMinute: 720,
      scenarioId: "balanced",
    });
    expect(nextScenarioChange(tl.segments, 800)).toEqual({
      atMinute: 480,
      scenarioId: "gaming",
    });
  });
  it("null when constant", () => {
    const tl = buildDayTimeline({ enabled: false, blocks: [] }, "balanced", at(1, 9, 0));
    expect(nextScenarioChange(tl.segments, 540)).toBeNull();
  });
  it("formats", () => {
    expect(formatMinute(510)).toBe("08:30");
  });
});

describe("agrees with resolveScheduledScenario for every minute", () => {
  const s: ScenarioSchedule = {
    enabled: true,
    blocks: [
      { start: "22:00", end: "06:00", days: ALL_DAYS, scenario: "streaming" },
      { start: "08:00", end: "12:00", days: [1, 2, 3, 4, 5], scenario: "gaming" },
      { start: "11:00", end: "15:00", days: [1, 2, 3, 4, 5], scenario: "custom-1" },
      { start: "12:00", end: "18:00", days: [0, 6], scenario: "custom-2" },
      { start: "09:00", end: "09:00", days: ALL_DAYS, scenario: "never" },
      { start: "19:00", end: "20:00", days: [], scenario: "inert" },
    ],
  };
  for (const dow of ALL_DAYS) {
    it(`weekday ${dow}`, () => {
      const tl = buildDayTimeline(s, "balanced", at(dow, 0, 0));
      for (let m = 0; m < 1440; m++) {
        const seg = tl.segments.find((x) => m >= x.startMinute && m < x.endMinute)!;
        const live = resolveScheduledScenario(
          at(dow, Math.floor(m / 60), m % 60),
          s,
          "balanced",
        );
        expect(seg.scenarioId).toBe(live);
      }
    });
  }
});
