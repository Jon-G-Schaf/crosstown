import Link from "next/link";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct, DAYPART_LABELS } from "@/lib/format";
import { brightenForDark } from "@/lib/colors";
import { CountUp } from "@/components/count-up";
import { DailyOnTimeChart, DaypartChart } from "@/components/route-charts";
import { SiteNav } from "@/components/site-nav";

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

  const color = brightenForDark(data.route.color);
  const total = data.series.reduce(
    (acc, s) => ({
      obs: acc.obs + s.observations,
      weighted: acc.weighted + s.onTimePct * s.observations,
    }),
    { obs: 0, weighted: 0 },
  );
  const overallPct = total.obs > 0 ? total.weighted / total.obs : null;

  return (
    <>
      <SiteNav active="routes" />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Link href="/routes" className="text-sm text-muted transition-colors hover:text-fog">
          &larr; All routes
        </Link>

        <header className="mb-10 mt-4 flex items-start gap-4">
          <span
            className="inline-flex h-11 w-15 min-w-15 items-center justify-center rounded-md font-mono text-lg font-semibold text-ink"
            style={{ backgroundColor: color }}
          >
            {data.route.shortName}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fog">
              {data.route.longName}
            </h1>
            {overallPct == null ? (
              <p className="mt-1 text-sm text-muted">No arrivals recorded yet.</p>
            ) : (
              <p className="mt-1 text-sm text-muted">
                <span className="text-lg text-fog">
                  <CountUp value={overallPct} suffix="%" />
                </span>{" "}
                on time over the last {data.range} days ·{" "}
                <span className="font-mono">{total.obs.toLocaleString()}</span> arrivals
              </p>
            )}
          </div>
        </header>

        {data.series.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-label text-faint">
              On-time by day
            </h2>
            <div className="panel px-4 py-4">
              <DailyOnTimeChart series={data.series} color={color} />
            </div>
          </section>
        )}

        {data.dayparts.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-label text-faint">
              On-time by time of day
            </h2>
            <div className="panel px-4 py-4">
              <DaypartChart dayparts={data.dayparts} />
            </div>
          </section>
        )}

        {data.dayparts.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-label text-faint">
              Breakdown
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 text-right font-medium">Arrivals</th>
                  <th className="py-2 text-right font-medium">On time</th>
                  <th className="py-2 text-right font-medium">Avg delay</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.dayparts.map((d) => (
                  <tr key={d.daypart} className="border-b border-line/50">
                    <td className="py-2.5 font-sans text-fog">
                      {DAYPART_LABELS[d.daypart] ?? d.daypart.replace("_", " ")}
                    </td>
                    <td className="py-2.5 text-right text-muted">
                      {d.observations.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right text-fog">{fmtPct(d.onTimePct)}</td>
                    <td className="py-2.5 text-right text-muted">{fmtDelay(d.avgDelaySec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
