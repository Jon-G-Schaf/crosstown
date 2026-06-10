export function fmtDelay(sec: number): string {
  const sign = sec < 0 ? "-" : "+";
  const abs = Math.abs(Math.round(sec));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${String(s).padStart(2, "0")}`;
}

export function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export const DAYPART_LABELS: Record<string, string> = {
  am_peak: "AM peak (6-9)",
  midday: "Midday (9-3)",
  pm_peak: "PM peak (3-6)",
  evening: "Evening (6-12)",
  overnight: "Overnight",
};

export const DAYPART_ORDER = ["am_peak", "midday", "pm_peak", "evening", "overnight"];
