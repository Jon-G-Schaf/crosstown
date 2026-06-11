"use client";

import { useEffect, useState } from "react";
import { API_URL, type ArrivalsResponse, type RecentArrival } from "@/lib/api";
import { fmtDelay } from "@/lib/format";

const POLL_MS = 30_000;

// Same window as the on-time rule; anything outside it is off-schedule,
// with very late getting the strongest color. Early rides with "late"
// because an early bus is a missed bus, just less dramatically.
function delayColor(delaySec: number): string {
  if (delaySec >= -60 && delaySec <= 300) return "var(--color-ontime)";
  if (delaySec > 600) return "var(--color-verylate)";
  return "var(--color-late)";
}

function TickerItems({ arrivals }: { arrivals: RecentArrival[] }) {
  return (
    <div className="flex shrink-0 items-baseline gap-8 pr-8">
      {arrivals.map((a, i) => (
        <span
          key={`${a.routeId}-${a.eventEpoch}-${i}`}
          className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] text-muted"
        >
          <span className="font-semibold text-fog">{a.shortName}</span>
          <span>{a.stopName}</span>
          <span style={{ color: delayColor(a.delaySec) }}>{fmtDelay(a.delaySec)}</span>
        </span>
      ))}
    </div>
  );
}

// Observed arrivals scrolling by as they happen: the measurement product,
// visible on the map page. Desktop only; phones need their map.
export function ArrivalTicker() {
  const [arrivals, setArrivals] = useState<RecentArrival[]>([]);

  useEffect(() => {
    const load = () =>
      fetch(`${API_URL}/api/arrivals/recent`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: ArrivalsResponse | null) => data && setArrivals(data.arrivals))
        .catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // A conveyor of two items looks broken; wait until there is real traffic.
  if (arrivals.length < 4) return null;

  return (
    <div className="panel absolute bottom-4 right-4 hidden w-[min(44vw,560px)] items-center gap-3 overflow-hidden py-2 pl-3.5 lg:flex">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-label text-faint">
        Arrivals
      </span>
      <div
        className="flex-1 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)",
        }}
      >
        <div
          className="ticker-track"
          style={
            {
              "--ticker-duration": `${Math.max(30, arrivals.length * 3.5)}s`,
            } as React.CSSProperties
          }
        >
          <TickerItems arrivals={arrivals} />
          <div aria-hidden="true" className="contents">
            <TickerItems arrivals={arrivals} />
          </div>
        </div>
      </div>
    </div>
  );
}
