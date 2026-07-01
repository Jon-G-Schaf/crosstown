import { afterEach, describe, expect, it, vi } from "vitest";
import { startSingleFlight } from "./single-flight.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("startSingleFlight", () => {
  it("maintains start cadence when runs finish before the interval", async () => {
    vi.useFakeTimers();
    const base = Date.now();
    const starts: number[] = [];
    const stop = startSingleFlight({
      intervalMs: 1000,
      run: async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
      onError: () => {},
    });

    await vi.advanceTimersByTimeAsync(2200);
    stop();
    expect(starts.map((start) => start - base)).toEqual([0, 1000, 2000]);
  });

  it("waits for a slow run instead of overlapping it", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    let starts = 0;
    const stop = startSingleFlight({
      intervalMs: 1000,
      run: async () => {
        starts++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        active--;
      },
      onError: () => {},
    });

    await vi.advanceTimersByTimeAsync(3100);
    stop();
    expect(starts).toBe(3);
    expect(maxActive).toBe(1);
  });
});
