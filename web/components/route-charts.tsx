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

function pctColor(pct: number): string {
  return pct >= 85 ? "#16a34a" : pct >= 70 ? "#d97706" : "#dc2626";
}

export function DailyOnTimeChart({ series, color }: { series: SeriesPoint[]; color: string }) {
  const data = series.map((s) => ({
    ...s,
    label: s.serviceDate.slice(5).replace("-", "/") + (s.partial ? "*" : ""),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} fontSize={11} />
        <YAxis domain={[0, 100]} tickLine={false} fontSize={11} unit="%" />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "on time"]}
          labelFormatter={(label) =>
            String(label).endsWith("*") ? `${String(label).slice(0, -1)} (today so far)` : label
          }
        />
        <Bar dataKey="onTimePct" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DaypartChart({ dayparts }: { dayparts: DaypartStat[] }) {
  const data = DAYPART_ORDER.map((dp) => dayparts.find((d) => d.daypart === dp))
    .filter((d): d is DaypartStat => d != null)
    .map((d) => ({ ...d, label: DAYPART_LABELS[d.daypart] ?? d.daypart }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 0, left: 24 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" domain={[0, 100]} tickLine={false} fontSize={11} unit="%" />
        <YAxis type="category" dataKey="label" tickLine={false} fontSize={11} width={96} />
        <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "on time"]} />
        <Bar dataKey="onTimePct" radius={[0, 3, 3, 0]}>
          {data.map((d) => (
            <Cell key={d.daypart} fill={pctColor(d.onTimePct)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
