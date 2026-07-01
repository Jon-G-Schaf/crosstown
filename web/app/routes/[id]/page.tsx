import Link from "next/link";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct, DAYPART_LABELS } from "@/lib/format";
import { brightenForDark, statusColor } from "@/lib/colors";
import { CountUp } from "@/components/count-up";
import { DailyOnTimeChart, DaypartChart } from "@/components/route-charts";
import { RouteMap } from "@/components/route-map";
import { SiteFooter } from "@/components/site-footer";
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
    medianDelaySec: number;
    partial?: boolean;
  }[];
  dayparts: {
    daypart: string;
    observations: number;
    onTimePct: number;
    avgDelaySec: number;
    medianDelaySec: number;
  }[];
};

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [res, shapeRes] = await Promise.all([
    fetch(`${API_URL}/api/stats/routes/${id}?range=30`, { cache: "no-store" }),
    fetch(`${API_URL}/api/routes/${id}`, { next: { revalidate: 3600 } }),
  ]);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`stats request failed: ${res.status}`);
  const data: Detail = await res.json();
  const shapeData: { directions: { coordinates: [number, number][] }[] } | null = shapeRes.ok
    ? await shapeRes.json()
    : null;
  const lines = (shapeData?.directions ?? [])
    .map((d) => d.coordinates)
    .filter((c) => c.length > 1);

  const color = brightenForDark(data.route.color);
  const total = data.series.reduce(
    (acc, s) => ({
      obs: acc.obs + s.observations,
      weightedPct: acc.weightedPct + s.onTimePct * s.observations,
      weightedDelay: acc.weightedDelay + s.medianDelaySec * s.observations,
    }),
    { obs: 0, weightedPct: 0, weightedDelay: 0 },
  );
  const overallPct = total.obs > 0 ? total.weightedPct / total.obs : null;
  const overallDelay = total.obs > 0 ? total.weightedDelay / total.obs : null;

  return (
    <>
      <SiteNav active="routes" />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <Link href="/routes" className="text-sm text-muted transition-colors hover:text-fog">
          &larr; All routes
        </Link>

        <header className="mt-4 flex items-start gap-4">
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
            <p className="mt-1 text-sm text-muted">{`Last ${data.range} days, measured from COTA's realtime feed`}</p>
          </div>
        </header>

        {lines.length > 0 && (
          <div className="panel mt-6 h-52 overflow-hidden max-sm:h-40">
            <RouteMap lines={lines} color={color} />
          </div>
        )}

        <section className="panel relative mt-6 mb-10 grid grid-cols-3 divide-x divide-line overflow-hidden max-sm:grid-cols-1 max-sm:divide-x-0 max-sm:divide-y">
          {overallPct != null && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-12 -top-16 h-48 w-48 rounded-full blur-3xl"
              style={{ backgroundColor: statusColor(overallPct), opacity: 0.08 }}
            />
          )}
          <div className="relative px-5 py-4">
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">On time</p>
            <p
              className="mt-1 text-3xl tracking-tight"
              style={
                overallPct != null
                  ? {
                      color: statusColor(overallPct),
                      textShadow: `0 0 22px ${statusColor(overallPct)}59`,
                    }
                  : undefined
              }
            >
              {overallPct == null ? (
                <span className="font-mono text-fog">—</span>
              ) : (
                <CountUp value={overallPct} suffix="%" />
              )}
            </p>
          </div>
          <div className="relative px-5 py-4">
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">
              Median delay
            </p>
            <p className="mt-1 font-mono text-3xl tracking-tight text-fog">
              {overallDelay == null ? "—" : fmtDelay(overallDelay)}
            </p>
          </div>
          <div className="relative px-5 py-4">
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">
              Arrivals
            </p>
            <p className="mt-1 text-3xl tracking-tight text-fog">
              <CountUp value={total.obs} decimals={0} />
            </p>
          </div>
        </section>

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
                  <th className="py-2 text-right font-medium">Median delay</th>
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
                    <td
                      className="py-2.5 text-right"
                      style={{ color: statusColor(d.onTimePct) }}
                    >
                      {fmtPct(d.onTimePct)}
                    </td>
                    <td className="py-2.5 text-right text-muted">{fmtDelay(d.medianDelaySec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
