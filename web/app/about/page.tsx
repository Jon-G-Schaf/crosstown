import Link from "next/link";
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
            Crosstown watches every COTA bus in Columbus in real time and keeps the receipts.
            The schedule tells you when the bus should come; this tells you when it actually
            does. The longer it runs, the better the answer gets.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            Where the data comes from
          </h2>
          <p>
            COTA publishes two public GTFS-realtime feeds: vehicle positions and trip updates.
            A worker polls positions every 15 seconds (that&apos;s what moves the dots on the{" "}
            <Link href="/" className="link-quiet text-fog">
              live map
            </Link>
            ) and trip updates every minute, around the clock.
          </p>
          <p>
            One wrinkle worth knowing: COTA&apos;s feed publishes predicted arrival times but
            not delays. So Crosstown computes the delay itself, by joining each prediction
            against the published schedule. The last prediction before the bus reaches a stop
            is taken as the observed arrival. It is not a perfect ground truth, but it is the
            same number COTA&apos;s own arrival screens run on.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            What counts as on time
          </h2>
          <p>
            The industry convention: no more than 1 minute early, no more than 5 minutes late.
            Early matters because an early bus is a missed bus. Every arrival lands in a
            per-route daily rollup, broken out by time of day, and the raw arrival records are
            kept for 90 days while the rollups are kept forever.
          </p>

          <h2 className="pt-4 text-lg font-semibold tracking-tight text-fog">
            How it is built
          </h2>
          <p>
            Two deployable pieces in one repo. A TypeScript Fastify service owns ingestion,
            Postgres, and the API, and pushes live positions to the browser over server-sent
            events. The frontend is Next.js with MapLibre doing the map work and the bus
            motion interpolated client-side between feed updates. The aggregations are plain
            SQL. Source is on{" "}
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
            <p>COTA GTFS-RT ──&gt; poller (15s / 60s) ──&gt; Postgres</p>
            <p>static GTFS ───&gt; loader ────────────────┘</p>
            <p>Postgres ──&gt; nightly rollups ──&gt; stats API ──&gt; charts</p>
            <p>poller ──&gt; SSE ──&gt; live map</p>
          </div>

          <p className="pt-2">
            Built by{" "}
            <a href="https://jongschaf.com" className="link-quiet text-fog">
              Jonathan Schafer
            </a>
            , a full-stack developer in Columbus. Data courtesy of COTA&apos;s open data
            program; this site is not affiliated with COTA.
          </p>
        </div>
      </main>
    </>
  );
}
