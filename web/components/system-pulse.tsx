"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { statusColor } from "@/lib/colors";

export type PulseHour = { hour: number; observations: number; onTimePct: number };

const GRID = "rgba(232, 236, 244, 0.07)";
const TICK = { fill: "#8b94a7", fontSize: 11, fontFamily: "var(--font-plex-mono)" };

const TOOLTIP_STYLE = {
  backgroundColor: "#1b2230",
  border: "1px solid rgba(232, 236, 244, 0.1)",
  borderRadius: 8,
  color: "#e8ecf4",
  fontSize: 12,
  fontFamily: "var(--font-plex-mono)",
};

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

// The service day runs from ~4am to past midnight, so hours sort by
// service-day position (4am first, overnight 0-3 last), not clock value.
const servicePos = (hour: number) => (hour - 4 + 24) % 24;

export function SystemPulseChart({ hours }: { hours: PulseHour[] }) {
  const data = [...hours]
    .sort((a, b) => servicePos(a.hour) - servicePos(b.hour))
    .map((h) => ({ ...h, label: hourLabel(h.hour) }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={TICK} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={TICK} unit="%" />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(232, 236, 244, 0.05)" }}
          formatter={(value, _name, item) => [
            `${Number(value).toFixed(1)}% of ${(item?.payload as PulseHour).observations.toLocaleString()} arrivals`,
            "on time",
          ]}
        />
        <Bar dataKey="onTimePct" radius={[3, 3, 0, 0]} maxBarSize={22}>
          {data.map((d) => (
            <Cell key={d.hour} fill={statusColor(d.onTimePct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
