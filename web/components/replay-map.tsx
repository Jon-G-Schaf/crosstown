"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type ReplayResponse, type ReplaySample } from "@/lib/api";
import { brightenForDark } from "@/lib/colors";
import { MAP_STYLE, applyInkTint } from "@/lib/map-style";
import { CountUp } from "./count-up";
import { RouteGlyph } from "./wordmark";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
// The whole window plays back in ~30s at 1x; speed multiplies that.
const BASE_SECONDS = 30;
const FRAME_MS = 33;
const TRAIL_MS = 120;
const SYNC_MS = 100;
// Comet tail length and gap handling, in data-seconds.
const TRAIL_SEC = 600;
// Buses leave and rejoin the data within the window; don't draw a straight
// line teleporting one across a long gap - just hide it until it returns.
const MAX_GAP_SEC = 360;
const SPEEDS = [1, 2, 4];

type RouteInfo = { routeId: string; color: string | null };

type Track = {
  vehicleId: string;
  routeId: string | null;
  color: string;
  samples: ReplaySample[];
  minT: number;
  maxT: number;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Shortest-arc interpolation so a 350->10 degree turn rotates 20 degrees.
function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

// A GPS-puck arrow drawn once per route color and registered as a map image;
// the same shape the live map uses. Tip points north, icon-rotate turns it.
const ARROW_PX = 64;
function arrowImage(color: string): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = ARROW_PX;
  canvas.height = ARROW_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.moveTo(32, 5);
  ctx.lineTo(55, 55);
  ctx.quadraticCurveTo(32, 41, 9, 55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0c0f14";
  ctx.stroke();
  return ctx.getImageData(0, 0, ARROW_PX, ARROW_PX);
}

// Rightmost sample index with sampleT <= t, or -1.
function idxAtOrBefore(samples: ReplaySample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid][0] <= t) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

type PointState = { lon: number; lat: number; bearing: number | null } | null;

// Interpolated position/bearing of a track at data-time t, or null when the
// bus isn't in the data at t (outside its span, or inside a long gap).
function stateAt(track: Track, t: number): PointState {
  if (t < track.minT || t > track.maxT) return null;
  const s = track.samples;
  const i = idxAtOrBefore(s, t);
  if (i < 0) return null;
  if (i >= s.length - 1) {
    const a = s[i];
    return { lon: a[1], lat: a[2], bearing: a[3] };
  }
  const a = s[i];
  const b = s[i + 1];
  const gap = b[0] - a[0];
  if (gap > MAX_GAP_SEC) return null;
  const f = gap > 0 ? (t - a[0]) / gap : 0;
  const bearing =
    a[3] == null ? b[3] : b[3] == null ? a[3] : lerpAngle(a[3], b[3], f);
  return { lon: lerp(a[1], b[1], f), lat: lerp(a[2], b[2], f), bearing };
}

// A short trailing polyline behind a bus: its samples within the last
// TRAIL_SEC, broken at long gaps, ending at its current interpolated point.
function trailFor(track: Track, t: number, head: { lon: number; lat: number }): [number, number][] | null {
  const s = track.samples;
  const i = idxAtOrBefore(s, t);
  if (i < 0) return null;
  const pts: [number, number][] = [];
  for (let j = i; j >= 0; j--) {
    if (t - s[j][0] > TRAIL_SEC) break;
    pts.unshift([s[j][1], s[j][2]]);
    if (j > 0 && s[j][0] - s[j - 1][0] > MAX_GAP_SEC) break;
  }
  pts.push([head.lon, head.lat]);
  return pts.length >= 2 ? pts : null;
}

const fmtClock = (ms: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));

type Status = "loading" | "ready" | "empty" | "error";

export function ReplayMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const windowSecRef = useRef(0);
  const countRef = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [displayT, setDisplayT] = useState(0);
  const [windowSec, setWindowSec] = useState(0);
  const [startMs, setStartMs] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!containerRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: COLUMBUS,
      zoom: 11.3,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;
    (window as unknown as { __replayMap?: maplibregl.Map }).__replayMap = map;

    let raf = 0;
    let lastFrame = 0;
    let lastTrail = 0;
    let lastSync = 0;
    let lastPerf = 0;
    const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

    const ensureArrowImage = (color: string) => {
      const id = `arrow-${color}`;
      if (!map.hasImage(id)) map.addImage(id, arrowImage(color));
    };

    const buildVehicleFrame = (): GeoJSON.FeatureCollection => {
      const t = tRef.current;
      const features: GeoJSON.Feature[] = [];
      let visible = 0;
      for (const tr of tracksRef.current) {
        const st = stateAt(tr, t);
        if (!st) continue;
        visible++;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [st.lon, st.lat] },
          properties: {
            color: tr.color,
            ...(st.bearing != null ? { bearing: st.bearing, icon: `arrow-${tr.color}` } : {}),
          },
        });
      }
      countRef.current = visible;
      return { type: "FeatureCollection", features };
    };

    const buildTrailFrame = (): GeoJSON.FeatureCollection => {
      const t = tRef.current;
      const features: GeoJSON.Feature[] = [];
      for (const tr of tracksRef.current) {
        const st = stateAt(tr, t);
        if (!st) continue;
        const pts = trailFor(tr, t, st);
        if (!pts) continue;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: pts },
          properties: { color: tr.color },
        });
      }
      return { type: "FeatureCollection", features };
    };

    map.on("load", async () => {
      applyInkTint(map);

      map.addSource("network", { type: "geojson", data: empty });
      map.addLayer({
        id: "network-base",
        type: "line",
        source: "network",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.1,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2],
        },
      });

      map.addSource("trails", { type: "geojson", data: empty });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.3,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 14, 3],
          "line-blur": 1.5,
        },
      });

      map.addSource("vehicles", { type: "geojson", data: empty });
      map.addLayer({
        id: "vehicles-glow",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 18],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.25,
          "circle-blur": 1,
        },
      });
      map.addLayer({
        id: "vehicles",
        type: "circle",
        source: "vehicles",
        filter: ["!", ["has", "bearing"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6.5],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0c0f14",
        },
      });
      map.addLayer({
        id: "vehicles-arrow",
        type: "symbol",
        source: "vehicles",
        filter: ["has", "bearing"],
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.14, 14, 0.3],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      fetch(`${API_URL}/api/shapes`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: GeoJSON.FeatureCollection | null) => {
          if (!data) return;
          for (const f of data.features) {
            const props = f.properties as { color: string | null };
            props.color = brightenForDark(props.color);
          }
          map.getSource<maplibregl.GeoJSONSource>("network")?.setData(data);
        })
        .catch(() => {});

      try {
        const [routesData, replayData] = await Promise.all([
          fetch(`${API_URL}/api/routes`).then((r) => (r.ok ? r.json() : null)) as Promise<{
            routes: RouteInfo[];
          } | null>,
          fetch(`${API_URL}/api/replay?hours=24`).then((r) =>
            r.ok ? r.json() : null,
          ) as Promise<ReplayResponse | null>,
        ]);

        const colors = new Map<string, string>();
        for (const r of routesData?.routes ?? []) colors.set(r.routeId, brightenForDark(r.color));

        if (!replayData || replayData.tracks.length === 0) {
          setStatus("empty");
          return;
        }

        const start = Date.parse(replayData.start);
        const span = Math.max(1, Math.round((Date.parse(replayData.end) - start) / 1000));
        const tracks: Track[] = replayData.tracks.map((tr) => {
          const color = (tr.routeId && colors.get(tr.routeId)) || "#7da2ff";
          return {
            vehicleId: tr.vehicleId,
            routeId: tr.routeId,
            color,
            samples: tr.samples,
            minT: tr.samples[0][0],
            maxT: tr.samples[tr.samples.length - 1][0],
          };
        });
        for (const c of new Set(tracks.map((t) => t.color))) ensureArrowImage(c);

        tracksRef.current = tracks;
        windowSecRef.current = span;
        setStartMs(start);
        setWindowSec(span);
        setStatus("ready");
        if (!reduced) {
          playingRef.current = true;
          setPlaying(true);
        }

        const tick = (now: number) => {
          raf = requestAnimationFrame(tick);
          const dt = lastPerf ? (now - lastPerf) / 1000 : 0;
          lastPerf = now;

          if (playingRef.current && windowSecRef.current > 0) {
            const dataPerReal = windowSecRef.current / BASE_SECONDS;
            let nt = tRef.current + dataPerReal * dt * speedRef.current;
            if (nt >= windowSecRef.current) nt = 0; // loop
            tRef.current = nt;
          }

          if (now - lastFrame >= FRAME_MS) {
            lastFrame = now;
            map.getSource<maplibregl.GeoJSONSource>("vehicles")?.setData(buildVehicleFrame());
          }
          if (now - lastTrail >= TRAIL_MS) {
            lastTrail = now;
            map.getSource<maplibregl.GeoJSONSource>("trails")?.setData(buildTrailFrame());
          }
          if (now - lastSync >= SYNC_MS) {
            lastSync = now;
            setDisplayT(tRef.current);
            setCount(countRef.current);
          }
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setStatus("error");
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const ready = status === "ready";
  const seek = (value: number) => {
    tRef.current = value;
    setDisplayT(value);
  };

  const clock = ready && startMs ? fmtClock(startMs + displayT * 1000) : "--";
  const progress = windowSec > 0 ? (displayT / windowSec) * 100 : 0;

  return (
    <div className="relative h-dvh w-full bg-ink">
      {/* maplibre forces position:relative on this node, so size it directly */}
      <div ref={containerRef} className="h-full w-full" />

      {/* the map melts into the chrome at the edges */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 95% 95% at 50% 40%, transparent 60%, rgba(12,15,20,0.65) 100%)",
        }}
      />

      {/* identity + current moment */}
      <div className="panel absolute left-4 top-4 w-72 px-5 py-4 max-sm:left-3 max-sm:right-3 max-sm:top-3 max-sm:w-auto">
        <p className="text-[10px] font-medium uppercase tracking-label text-faint">
          Columbus transit, replayed
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-fog">
            <RouteGlyph />
            Replay
          </h1>
          <Link href="/" className="text-sm text-muted transition-colors hover:text-fog">
            Live
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">Moment</p>
            <p className="mt-0.5 font-mono text-lg text-fog">{clock}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">
              On the road
            </p>
            <p className="mt-0.5 text-lg text-fog">
              {count == null ? (
                <span className="font-mono">—</span>
              ) : (
                <CountUp value={count} decimals={0} />
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 border-t border-line pt-3 text-sm">
          <Link href="/routes" className="link-quiet text-fog">
            Reliability rankings
          </Link>
          <Link href="/about" className="text-muted transition-colors hover:text-fog">
            About
          </Link>
        </div>
      </div>

      {/* transport bar */}
      <div className="panel absolute bottom-5 left-1/2 flex w-[min(920px,calc(100%-2rem))] -translate-x-1/2 items-center gap-4 px-4 py-3 max-sm:bottom-3 max-sm:gap-2.5 max-sm:px-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-fog transition-colors hover:border-fog/30 disabled:opacity-40"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
              <rect x="8.5" y="1.5" width="3.5" height="11" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 1.8 12 7 3 12.2Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <span className="shrink-0 font-mono text-xs text-muted max-sm:hidden">{clock}</span>

        <input
          type="range"
          className="scrubber flex-1"
          min={0}
          max={windowSec || 1}
          step={1}
          value={displayT}
          disabled={!ready}
          aria-label="Scrub replay timeline"
          style={{ ["--progress" as string]: `${progress}%` }}
          onPointerDown={() => setPlaying(false)}
          onChange={(e) => seek(Number(e.target.value))}
        />

        <div className="flex shrink-0 items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              disabled={!ready}
              aria-pressed={speed === s}
              className={`rounded-md px-2 py-1 font-mono text-xs transition-colors disabled:opacity-40 ${
                speed === s
                  ? "bg-raised text-fog"
                  : "text-muted hover:text-fog"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <span className="panel px-4 py-2 font-mono text-sm text-muted">
            {status === "loading"
              ? "Loading replay…"
              : status === "empty"
                ? "No recent positions to replay yet."
                : "Could not load replay."}
          </span>
        </div>
      )}
    </div>
  );
}
