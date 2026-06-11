// COTA's brand route colors were picked for print on white. On the dark map
// the navy (#00205B) all but disappears, so colors get a lightness floor
// before they're used on dark surfaces.

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

export function brightenForDark(hex: string | null, minLightness = 0.55): string {
  const fallback = "#7da2ff";
  if (!hex) return fallback;
  const hsl = hexToHsl(hex.startsWith("#") ? hex : `#${hex}`);
  if (!hsl) return fallback;
  const [h, s, l] = hsl;
  const lifted = Math.max(l, minLightness);
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(lifted * 100).toFixed(0)}%)`;
}

export function statusColor(onTimePct: number): string {
  return onTimePct >= 85 ? "#34d399" : onTimePct >= 70 ? "#fbbf24" : "#f87171";
}
