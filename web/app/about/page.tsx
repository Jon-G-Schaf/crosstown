import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <SiteNav active="about" />
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-fog">
          What Crosstown is
        </h1>

        <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-muted">
          <p>
            Crosstown shows every COTA bus in Columbus in real time and keeps a permanent
            record of how the system performs. The schedule says when each bus should
            arrive. Crosstown records when it did. The longer it runs, the more those
            records can tell you about a route.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            Where the data comes from
          </h2>
          <p>
            COTA publishes two public GTFS-realtime feeds: vehicle positions and trip updates.
            A worker polls positions every 15 seconds and trip updates every 30 seconds,
            around the clock. The position feed is what moves the buses on the{" "}
            <Link href="/" className="link-quiet text-fog">
              live map
            </Link>
            .
          </p>
          <p>
            COTA&apos;s feed publishes predicted arrival times but not delays, so Crosstown
            computes each delay by joining the prediction against the published schedule.
            The last prediction before the bus reaches a stop is taken as the observed
            arrival. It is not perfect ground truth, but it is the same number COTA&apos;s
            own arrival screens run on. Stops the bus has not reached are never counted,
            and predictions left behind by trips that drop out of the feed are discarded
            rather than treated as arrivals.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            What counts as on time
          </h2>
          <p>
            A bus counts as on time if it arrives no more than 1 minute early and no more
            than 5 minutes late, the standard most US transit agencies report. Early counts
            against a route because an early bus is one its riders missed. Every arrival
            lands in a per-route daily rollup, broken out by time of day. Raw arrival
            records are kept for 90 days, and the rollups are kept permanently.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            How it is built
          </h2>
          <p>
            The project is two deployable pieces in one repo. A TypeScript Fastify service
            handles ingestion, Postgres, and the API, and pushes live positions to the
            browser over server-sent events. The frontend is Next.js, with MapLibre
            rendering the map and bus motion interpolated client-side between feed updates.
            The aggregations are plain SQL. Source is on{" "}
            <a
              href="https://github.com/Jon-G-Schaf/crosstown"
              className="link-quiet text-fog"
            >
              GitHub
            </a>
            .
          </p>

          <div className="panel mt-2 px-5 py-4 font-mono text-xs leading-loose text-muted">
            <p className="text-faint">{"// the shape of it"}</p>
            <p>COTA GTFS-RT ──&gt; poller (15s / 30s) ──&gt; Postgres</p>
            <p>static GTFS ───&gt; loader ────────────────┘</p>
            <p>Postgres ──&gt; nightly rollups ──&gt; stats API ──&gt; charts</p>
            <p>poller ──&gt; SSE ──&gt; live map</p>
          </div>

          <p className="pt-2">
            Built by{" "}
            <a href="https://jongschaf.com" className="link-quiet text-fog">
              Jonathan Schafer
            </a>
            , a full-stack developer in Columbus. The data comes from COTA&apos;s open data
            program. This site is not affiliated with COTA.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
