// Industry-standard on-time window: up to 1 min early, up to 5 min late.
export const ON_TIME_EARLY_SEC = -60;
export const ON_TIME_LATE_SEC = 300;

export function isOnTime(delaySec: number): boolean {
  return delaySec >= ON_TIME_EARLY_SEC && delaySec <= ON_TIME_LATE_SEC;
}

export type Daypart = "am_peak" | "midday" | "pm_peak" | "evening" | "overnight";

// Buckets by local hour. Mirrors the CASE expression in the rollup SQL;
// change both together.
export function hourToDaypart(hour: number): Daypart {
  if (hour >= 6 && hour < 9) return "am_peak";
  if (hour >= 9 && hour < 15) return "midday";
  if (hour >= 15 && hour < 18) return "pm_peak";
  if (hour >= 18 && hour < 24) return "evening";
  return "overnight";
}

// SQL fragment equivalents, kept next to the JS so drift is obvious.
export const DAYPART_CASE_SQL = `
  case
    when h >= 6  and h < 9  then 'am_peak'
    when h >= 9  and h < 15 then 'midday'
    when h >= 15 and h < 18 then 'pm_peak'
    when h >= 18 and h < 24 then 'evening'
    else 'overnight'
  end
`;

export type StatRow = {
  observations: number;
  onTimePct: number;
  avgDelaySec: number;
  p90DelaySec: number;
};

// Combine two aggregates weighted by observation count. Exact for the
// averages; approximate for p90 (true p90 needs raw values, which the
// rollups deliberately discard).
export function mergeStats(a: StatRow | null, b: StatRow | null): StatRow | null {
  if (!a) return b;
  if (!b) return a;
  const total = a.observations + b.observations;
  if (total === 0) return { observations: 0, onTimePct: 0, avgDelaySec: 0, p90DelaySec: 0 };
  const w = (x: StatRow, pick: (s: StatRow) => number) =>
    (pick(x) * x.observations) / total;
  return {
    observations: total,
    onTimePct: w(a, (s) => s.onTimePct) + w(b, (s) => s.onTimePct),
    avgDelaySec: w(a, (s) => s.avgDelaySec) + w(b, (s) => s.avgDelaySec),
    p90DelaySec: w(a, (s) => s.p90DelaySec) + w(b, (s) => s.p90DelaySec),
  };
}
