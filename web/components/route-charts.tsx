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
import { DAYPART_LABELS, DAYPART_ORDER } from "@/lib/format";
import { statusColor } from "@/lib/colors";

type SeriesPoint = {
  serviceDate: string;
  onTimePct: number;
  observations: number;
  partial?: boolean;
};

type DaypartStat = {
  daypart: string;
  onTimePct: number;
  observations: number;
};

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

export function DailyOnTimeChart({ series, color }: { series: SeriesPoint[]; color: string }) {
  const data = series.map((s) => ({
    ...s,
    label: s.serviceDate.slice(5).replace("-", "/") + (s.partial ? "*" : ""),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={TICK} />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tick={TICK}
          unit="%"
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(232, 236, 244, 0.05)" }}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "on time"]}
          labelFormatter={(label) =>
            String(label).endsWith("*") ? `${String(label).slice(0, -1)} (today so far)` : label
          }
        />
        <Bar dataKey="onTimePct" fill={color} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DaypartChart({ dayparts }: { dayparts: DaypartStat[] }) {
  const data = DAYPART_ORDER.map((dp) => dayparts.find((d) => d.daypart === dp))
    .filter((d): d is DaypartStat => d != null)
    .map((d) => ({ ...d, label: DAYPART_LABELS[d.daypart] ?? d.daypart }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 24 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tick={TICK}
          unit="%"
        />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={TICK} width={100} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(232, 236, 244, 0.05)" }}
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "on time"]}
        />
        <Bar dataKey="onTimePct" radius={[0, 3, 3, 0]} maxBarSize={20}>
          {data.map((d) => (
            <Cell key={d.daypart} fill={statusColor(d.onTimePct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
