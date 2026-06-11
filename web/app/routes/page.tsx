import Link from "next/link";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct } from "@/lib/format";
import { brightenForDark, statusColor } from "@/lib/colors";
import { SiteNav } from "@/components/site-nav";

export const dynamic = "force-dynamic";

export const metadata = { title: "Route reliability" };

type RouteStat = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string | null;
  observations: number;
  onTimePct: number;
  avgDelaySec: number;
};

const RANGES = [7, 30, 90] as const;

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range = RANGES.find((r) => String(r) === rawRange) ?? 7;

  const res = await fetch(`${API_URL}/api/stats/routes?range=${range}`, { cache: "no-store" });
  const data: { routes: RouteStat[] } = res.ok ? await res.json() : { routes: [] };

  return (
    <>
      <SiteNav active="routes" />
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-fog">Route reliability</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            On time means arriving between 1 minute early and 5 minutes late, measured from
            COTA&apos;s own realtime feed. Today counts as far as it has happened.
          </p>
          <nav className="mt-5 flex gap-2">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/routes?range=${r}`}
                className={`rounded-full px-3.5 py-1 font-mono text-xs transition-colors ${
                  r === range
                    ? "bg-fog text-ink"
                    : "bg-raised text-muted hover:text-fog"
                }`}
              >
                {r}d
              </Link>
            ))}
          </nav>
        </header>

        {data.routes.length === 0 ? (
          <div className="panel px-6 py-10 text-center">
            <p className="text-sm text-muted">
              No arrivals recorded yet. The collector may have just started; check back in a few
              minutes.
            </p>
          </div>
        ) : (
          <ol>
            {data.routes.map((r, i) => (
              <li
                key={r.routeId}
                className="reveal border-b border-line"
                style={{ "--reveal-delay": `${Math.min(i * 35, 600)}ms` } as React.CSSProperties}
              >
                <Link
                  href={`/routes/${r.routeId}`}
                  className="group flex items-center gap-4 px-2 py-3.5 transition-colors hover:bg-panel"
                >
                  <span className="w-6 text-right font-mono text-xs text-faint">{i + 1}</span>
                  <span
                    className="inline-flex h-8 w-13 min-w-13 items-center justify-center rounded-md font-mono text-sm font-semibold text-ink"
                    style={{ backgroundColor: brightenForDark(r.color) }}
                  >
                    {r.shortName}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fog">
                      {r.longName}
                    </span>
                    <span className="block font-mono text-xs text-faint">
                      {r.observations.toLocaleString()} arrivals · avg {fmtDelay(r.avgDelaySec)}
                    </span>
                  </span>
                  <span className="flex w-36 items-center gap-3 max-sm:w-24">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(2, r.onTimePct)}%`,
                          backgroundColor: statusColor(r.onTimePct),
                        }}
                      />
                    </span>
                    <span className="w-13 text-right font-mono text-sm text-fog">
                      {fmtPct(r.onTimePct)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-8 font-mono text-xs text-faint">
          Data: COTA GTFS-realtime · collected continuously since June 2026
        </p>
      </main>
    </>
  );
}
