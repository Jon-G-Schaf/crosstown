import Link from "next/link";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Live map
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Route reliability</h1>
        <p className="mt-1 text-sm text-neutral-600">
          On-time means arriving between 1 minute early and 5 minutes late, measured from
          COTA&apos;s own realtime feed. Today counts as far as it has happened.
        </p>
        <nav className="mt-4 flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/routes?range=${r}`}
              className={`rounded-full px-3 py-1 text-sm ${
                r === range
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {r} days
            </Link>
          ))}
        </nav>
      </header>

      {data.routes.length === 0 ? (
        <p className="text-neutral-600">No data yet. The collector may have just started.</p>
      ) : (
        <ol className="divide-y divide-neutral-200">
          {data.routes.map((r, i) => (
            <li key={r.routeId}>
              <Link
                href={`/routes/${r.routeId}`}
                className="flex items-center gap-4 py-3 hover:bg-neutral-50"
              >
                <span className="w-6 text-right text-sm tabular-nums text-neutral-400">
                  {i + 1}
                </span>
                <span
                  className="inline-flex h-8 w-12 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white"
                  style={{ backgroundColor: r.color ? `#${r.color}` : "#404040" }}
                >
                  {r.shortName}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.longName}</span>
                  <span className="block text-xs text-neutral-500">
                    {r.observations.toLocaleString()} arrivals &middot; avg{" "}
                    {fmtDelay(r.avgDelaySec)}
                  </span>
                </span>
                <span className="flex w-32 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(2, r.onTimePct)}%`,
                        backgroundColor:
                          r.onTimePct >= 85 ? "#16a34a" : r.onTimePct >= 70 ? "#d97706" : "#dc2626",
                      }}
                    />
                  </span>
                  <span className="w-12 text-right text-sm tabular-nums">{fmtPct(r.onTimePct)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
