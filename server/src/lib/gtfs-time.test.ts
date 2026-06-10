import { describe, expect, it } from "vitest";
import { gtfsTimeToSeconds } from "./gtfs-time.js";

describe("gtfsTimeToSeconds", () => {
  it("parses normal times", () => {
    expect(gtfsTimeToSeconds("08:30:00")).toBe(8 * 3600 + 30 * 60);
  });

  it("parses past-midnight times", () => {
    expect(gtfsTimeToSeconds("25:10:30")).toBe(25 * 3600 + 10 * 60 + 30);
  });

  it("rejects junk", () => {
    expect(gtfsTimeToSeconds("")).toBeNull();
    expect(gtfsTimeToSeconds("8:30")).toBeNull();
    expect(gtfsTimeToSeconds("08:61:00")).toBeNull();
  });
});
