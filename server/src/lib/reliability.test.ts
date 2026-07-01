import { describe, expect, it } from "vitest";
import { hourToDaypart, isOnTime, mergeStats } from "./reliability.js";

describe("isOnTime", () => {
  it("accepts the on-time window boundaries", () => {
    expect(isOnTime(-60)).toBe(true);
    expect(isOnTime(0)).toBe(true);
    expect(isOnTime(300)).toBe(true);
  });

  it("rejects outside the window", () => {
    expect(isOnTime(-61)).toBe(false);
    expect(isOnTime(301)).toBe(false);
  });
});

describe("hourToDaypart", () => {
  it("buckets boundaries correctly", () => {
    expect(hourToDaypart(5)).toBe("overnight");
    expect(hourToDaypart(6)).toBe("am_peak");
    expect(hourToDaypart(8)).toBe("am_peak");
    expect(hourToDaypart(9)).toBe("midday");
    expect(hourToDaypart(14)).toBe("midday");
    expect(hourToDaypart(15)).toBe("pm_peak");
    expect(hourToDaypart(17)).toBe("pm_peak");
    expect(hourToDaypart(18)).toBe("evening");
    expect(hourToDaypart(23)).toBe("evening");
    expect(hourToDaypart(0)).toBe("overnight");
  });
});

describe("mergeStats", () => {
  it("passes through when one side is null", () => {
    const s = {
      observations: 5,
      onTimePct: 80,
      avgDelaySec: 60,
      medianDelaySec: 50,
      p90DelaySec: 200,
    };
    expect(mergeStats(null, s)).toEqual(s);
    expect(mergeStats(s, null)).toEqual(s);
  });

  it("weights by observations", () => {
    const a = {
      observations: 100,
      onTimePct: 90,
      avgDelaySec: 30,
      medianDelaySec: 20,
      p90DelaySec: 100,
    };
    const b = {
      observations: 300,
      onTimePct: 70,
      avgDelaySec: 90,
      medianDelaySec: 80,
      p90DelaySec: 300,
    };
    const merged = mergeStats(a, b)!;
    expect(merged.observations).toBe(400);
    expect(merged.onTimePct).toBeCloseTo(75); // (90*100 + 70*300) / 400
    expect(merged.avgDelaySec).toBeCloseTo(75);
    expect(merged.medianDelaySec).toBeCloseTo(65); // (20*100 + 80*300) / 400
    expect(merged.p90DelaySec).toBeCloseTo(250);
  });
});
