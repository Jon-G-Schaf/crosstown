import Link from "next/link";
import { API_URL } from "@/lib/api";
import { fmtDelay, fmtPct, DAYPART_LABELS, DAYPART_ORDER } from "@/lib/format";
import { brightenForDark, statusColor } from "@/lib/colors";
import { CountUp } from "@/components/count-up";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";
import { SystemPulseChart, type PulseHour } from "@/components/system-pulse";

export const dynamic = "force-dynamic";

export const metadata = { title: "Route reliability" };

type DaypartStat = { daypart: string; observations: number; onTimePct: number };

type RouteStat = {
  routeId: string;
  shortName: string;
  longName: string;
  color: string | null;
  observations: number;
  onTimePct: number;
  avgDelaySec: number;
  dayparts?: DaypartStat[];
};

const RANGES = [7, 30, 90] as const;

// A percentage built on a handful of arrivals is noise. Routes need this
// many recorded arrivals per day in the window to be ranked; the rest are
// listed below the ranking without a position.
const MIN_OBS_PER_DAY = 15;

// Five cells, one per daypart, colored by that period's on-time rate: a
// route's whole day legible at a glance, right in the ranking row.
function DaypartStrip({ dayparts }: { dayparts?: DaypartStat[] }) {
  if (!dayparts || dayparts.length === 0) return null;
  const by = new Map(dayparts.map((d) => [d.daypart, d]));
  return (
    <span className="flex gap-[3px] max-md:hidden">
      {DAYPART_ORDER.map((dp) => {
        const d = by.get(dp);
        return (
          <span
            key={dp}
            className={`h-5 w-2.5 rounded-[3px] ${d ? "" : "bg-raised"}`}
            title={
              d
                ? `${DAYPART_LABELS[dp]}: ${fmtPct(d.onTimePct)} of ${d.observations.toLocaleString()}`
                : `${DAYPART_LABELS[dp]}: no data`
            }
            style={d ? { backgroundColor: statusColor(d.onTimePct), opacity: 0.8 } : undefined}
          />
        );
      })}
    </span>
  );
}

// One row of the list. Ranked rows get a position number; low-sample rows
// get a quiet dot in its place.
function RankingRow({
  route: r,
  rank,
  delayIndex,
}: {
  route: RouteStat;
  rank?: number;
  delayIndex: number;
}) {
  return (
    <li
      className="reveal border-b border-line"
      style={{ "--reveal-delay": `${Math.min(delayIndex * 35, 600)}ms` } as React.CSSProperties}
    >
      <Link
        href={`/routes/${r.routeId}`}
        className="group flex items-center gap-4 px-2 py-3.5 transition-colors hover:bg-panel"
      >
        <span className="w-7 text-right font-mono text-xs text-faint">
          {rank != null ? String(rank).padStart(2, "0") : "·"}
        </span>
        <span
          className="inline-flex h-8 w-13 min-w-13 items-center justify-center rounded-md font-mono text-sm font-semibold text-ink"
          style={{ backgroundColor: brightenForDark(r.color) }}
        >
          {r.shortName}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fog">{r.longName}</span>
          <span className="block font-mono text-xs text-faint">
            {r.observations.toLocaleString()} arrivals · avg {fmtDelay(r.avgDelaySec)}
          </span>
        </span>
        <DaypartStrip dayparts={r.dayparts} />
        <span className="flex w-36 items-center gap-3 max-sm:w-24">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(2, r.onTimePct)}%`,
                backgroundColor: statusColor(r.onTimePct),
                boxShadow: `0 0 8px ${statusColor(r.onTimePct)}66`,
              }}
            />
          </span>
          <span className="w-13 text-right font-mono text-sm text-fog">
            {fmtPct(r.onTimePct)}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rawRange } = await searchParams;
  const range = RANGES.find((r) => String(r) === rawRange) ?? 7;

  const [res, sysRes, pulseRes] = await Promise.all([
    fetch(`${API_URL}/api/stats/routes?range=${range}`, { cache: "no-store" }),
    fetch(`${API_URL}/api/stats/system`, { cache: "no-store" }),
    fetch(`${API_URL}/api/stats/pulse`, { cache: "no-store" }),
  ]);
  const data: { routes: RouteStat[] } = res.ok ? await res.json() : { routes: [] };
  const sys: {
    todayOnTimePct: number | null;
    arrivalsToday: number;
    arrivalsOnRecord: number;
  } | null = sysRes.ok ? await sysRes.json() : null;
  const pulse: { serviceDate: string; hours: PulseHour[] } | null = pulseRes.ok
    ? await pulseRes.json()
    : null;

  const sysColor = sys?.todayOnTimePct != null ? statusColor(sys.todayOnTimePct) : null;

  const minObs = range * MIN_OBS_PER_DAY;
  const ranked = data.routes.filter((r) => r.observations >= minObs);
  const lowSample = data.routes.filter((r) => r.observations < minObs);

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

          {sys && (
            <div className="panel relative mt-6 overflow-hidden px-6 py-5">
              {/* a status-colored wash; the day's mood leaks into the room */}
              {sysColor && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full blur-3xl"
                  style={{ backgroundColor: sysColor, opacity: 0.07 }}
                />
              )}
              <div className="relative flex items-end gap-10 max-md:flex-col max-md:items-stretch max-md:gap-6">
                <div className="shrink-0">
                  <p className="text-[10px] font-medium uppercase tracking-label text-faint">
                    System on time today
                  </p>
                  <p
                    className="mt-1.5 text-6xl tracking-tight"
                    style={
                      sysColor
                        ? { color: sysColor, textShadow: `0 0 28px ${sysColor}59` }
                        : undefined
                    }
                  >
                    {sys.todayOnTimePct == null ? (
                      <span className="font-mono text-fog">—</span>
                    ) : (
                      <CountUp value={sys.todayOnTimePct} suffix="%" />
                    )}
                  </p>
                  <div className="mt-5 flex gap-8">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-label text-faint">
                        Arrivals today
                      </p>
                      <p className="mt-0.5 font-mono text-lg text-fog">
                        <CountUp value={sys.arrivalsToday} decimals={0} />
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-label text-faint">
                        On record
                      </p>
                      <p className="mt-0.5 font-mono text-lg text-fog">
                        <CountUp value={sys.arrivalsOnRecord} decimals={0} />
                      </p>
                    </div>
                  </div>
                </div>
                {pulse && pulse.hours.length > 0 && (
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-right text-[10px] font-medium uppercase tracking-label text-faint max-md:text-left">
                      On-time % by hour
                    </p>
                    <SystemPulseChart hours={pulse.hours} />
                  </div>
                )}
              </div>
            </div>
          )}

          <nav className="mt-5 inline-flex rounded-full border border-line bg-panel p-1">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/routes?range=${r}`}
                className={`rounded-full px-3.5 py-1 font-mono text-xs transition-colors ${
                  r === range ? "bg-fog text-ink" : "text-muted hover:text-fog"
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
          <>
            <ol>
              {ranked.map((r, i) => (
                <RankingRow key={r.routeId} route={r} rank={i + 1} delayIndex={i} />
              ))}
            </ol>
            {lowSample.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[11px] font-medium uppercase tracking-label text-faint">
                  Not enough data to rank
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-faint">
                  These routes have fewer than {minObs.toLocaleString()} recorded arrivals in
                  this window, so a percentage would say more about luck than the route.
                </p>
                <ol className="mt-3">
                  {lowSample.map((r, i) => (
                    <RankingRow
                      key={r.routeId}
                      route={r}
                      delayIndex={ranked.length + i}
                    />
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

      </main>
      <SiteFooter />
    </>
  );
}
