// GTFS times are HH:MM:SS where HH can exceed 24 (a 25:10:00 arrival is
// 1:10am on the next service day). Stored as seconds to keep math sane.
export function gtfsTimeToSeconds(time: string): number | null {
  const m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
