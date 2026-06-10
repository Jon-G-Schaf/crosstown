import Link from "next/link";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct } from "@/lib/format";
import { DailyOnTimeChart, DaypartChart } from "@/components/route-charts";

export const dynamic = "force-dynamic";

type Detail = {
  route: { routeId: string; shortName: string; longName: string; color: string | null };
  range: number;
  series: {
    serviceDate: string;
    observations: number;
    onTimePct: number;
    avgDelaySec: number;
    partial?: boolean;
  }[];
  dayparts: { daypart: string; observations: number; onTimePct: number; avgDelaySec: number }[];
};

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await fetch(`${API_URL}/api/stats/routes/${id}?range=30`, { cache: "no-store" });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
  const data: Detail = await res.json();

  const color = data.route.color ? `#${data.route.color}` : "#404040";
  const total = data.series.reduce(
    (acc, s) => ({
      obs: acc.obs + s.observations,
      weighted: acc.weighted + s.onTimePct * s.observations,
    }),
    { obs: 0, weighted: 0 },
  );
  const overallPct = total.obs > 0 ? total.weighted / total.obs : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <Link href="/routes" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; All routes
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="inline-flex h-10 w-14 items-center justify-center rounded-md text-lg font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {data.route.shortName}
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.route.longName}</h1>
            <p className="text-sm text-neutral-600">
              {overallPct == null
                ? "No arrivals recorded yet"
                : `${fmtPct(overallPct)} on time over the last ${data.range} days (${total.obs.toLocaleString()} arrivals)`}
            </p>
          </div>
        </div>
      </header>

      {data.series.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            On-time by day
          </h2>
          <DailyOnTimeChart series={data.series} color={color} />
        </section>
      )}

      {data.dayparts.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            On-time by time of day
          </h2>
          <DaypartChart dayparts={data.dayparts} />
        </section>
      )}

      {data.dayparts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Breakdown
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 text-right font-medium">Arrivals</th>
                <th className="py-2 text-right font-medium">On time</th>
                <th className="py-2 text-right font-medium">Avg delay</th>
              </tr>
            </thead>
            <tbody>
              {data.dayparts.map((d) => (
                <tr key={d.daypart} className="border-b border-neutral-100">
                  <td className="py-2">{d.daypart.replace("_", " ")}</td>
                  <td className="py-2 text-right tabular-nums">
                    {d.observations.toLocaleString()}
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtPct(d.onTimePct)}</td>
                  <td className="py-2 text-right tabular-nums">{fmtDelay(d.avgDelaySec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
