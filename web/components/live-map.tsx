"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type Vehicle, type VehiclesResponse } from "@/lib/api";
import { brightenForDark, statusColor } from "@/lib/colors";
import { MAP_STYLE, applyInkTint } from "@/lib/map-style";
import { CountUp } from "./count-up";
import { RouteGlyph } from "./wordmark";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
// Feed updates every ~15s; animate each hop over slightly less so buses
// settle before the next snapshot lands.
const HOP_MS = 12_000;
const FRAME_MS = 33;
const TRAIL_SAMPLE_MS = 900;
const TRAIL_POINTS = 14;

type RouteInfo = { routeId: string; shortName: string; longName: string; color: string | null };

type SystemStats = {
  todayOnTimePct: number | null;
  arrivalsToday: number;
  arrivalsOnRecord: number;
};

type Anim = {
  from: [number, number];
  to: [number, number];
  start: number;
  routeId: string | null;
  color: string;
  speed: number | null;
  ts: string;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function animPos(anim: Anim, now: number): [number, number] {
  const t = Math.min(1, (now - anim.start) / HOP_MS);
  return [lerp(anim.from[0], anim.to[0], t), lerp(anim.from[1], anim.to[1], t)];
}

export function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animsRef = useRef(new Map<string, Anim>());
  const trailsRef = useRef(new Map<string, [number, number][]>());
  const routesRef = useRef(new Map<string, RouteInfo>());
  const routeColorsRef = useRef(new Map<string, string>());
  const filterRef = useRef<string>("all");
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [count, setCount] = useState<number | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    filterRef.current = filter;
    const map = mapRef.current;
    if (!map || !map.getLayer("network-base")) return;
    // Selected route: its strand lights up, the rest of the network recedes.
    map.setFilter("network-active", ["==", ["get", "routeId"], filter]);
    map.setFilter("network-active-glow", ["==", ["get", "routeId"], filter]);
    map.setPaintProperty("network-base", "line-opacity", filter === "all" ? 0.14 : 0.05);
  }, [filter]);

  useEffect(() => {
    fetch(`${API_URL}/api/routes`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { routes: RouteInfo[] } | null) => {
        if (!data) return;
        setRoutes(data.routes);
        for (const r of data.routes) {
          routesRef.current.set(r.routeId, r);
          routeColorsRef.current.set(r.routeId, brightenForDark(r.color));
        }
      })
      .catch(() => {});

    const loadStats = () =>
      fetch(`${API_URL}/api/stats/system`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: SystemStats | null) => data && setStats(data))
        .catch(() => {});
    loadStats();
    const statsTimer = setInterval(loadStats, 60_000);
    return () => clearInterval(statsTimer);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: COLUMBUS,
      zoom: 11.3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // debug/test handle (used by headless verification)
    (window as unknown as { __map?: maplibregl.Map }).__map = map;

    let es: EventSource | undefined;
    let raf = 0;
    let lastFrame = 0;
    let lastTrailSample = 0;

    const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

    const buildVehicleFrame = (now: number): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = [];
      const active = filterRef.current;
      for (const [vehicleId, anim] of animsRef.current) {
        if (active !== "all" && anim.routeId !== active) continue;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: animPos(anim, now) },
          properties: {
            vehicleId,
            routeId: anim.routeId,
            color: anim.color,
            speed: anim.speed,
            ts: anim.ts,
          },
        });
      }
      return { type: "FeatureCollection", features };
    };

    const buildTrailFrame = (): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = [];
      const active = filterRef.current;
      for (const [vehicleId, trail] of trailsRef.current) {
        if (trail.length < 2) continue;
        const anim = animsRef.current.get(vehicleId);
        if (!anim) continue;
        if (active !== "all" && anim.routeId !== active) continue;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: trail },
          properties: { color: anim.color },
        });
      }
      return { type: "FeatureCollection", features };
    };

    const sampleTrails = (now: number) => {
      for (const [vehicleId, anim] of animsRef.current) {
        const pos = animPos(anim, now);
        let trail = trailsRef.current.get(vehicleId);
        if (!trail) {
          trail = [];
          trailsRef.current.set(vehicleId, trail);
        }
        trail.push(pos);
        if (trail.length > TRAIL_POINTS) trail.shift();
      }
      for (const id of trailsRef.current.keys()) {
        if (!animsRef.current.has(id)) trailsRef.current.delete(id);
      }
    };

    const applySnapshot = (vehicles: Vehicle[]) => {
      const now = performance.now();
      const seen = new Set<string>();
      for (const v of vehicles) {
        seen.add(v.vehicleId);
        const prev = animsRef.current.get(v.vehicleId);
        animsRef.current.set(v.vehicleId, {
          from: prev ? animPos(prev, now) : [v.lon, v.lat],
          to: [v.lon, v.lat],
          start: now,
          routeId: v.routeId,
          color: (v.routeId && routeColorsRef.current.get(v.routeId)) || "#7da2ff",
          speed: v.speed,
          ts: v.ts,
        });
      }
      for (const id of animsRef.current.keys()) {
        if (!seen.has(id)) animsRef.current.delete(id);
      }
      setCount(vehicles.length);
      setStalled(false);
    };

    map.on("load", () => {
      applyInkTint(map);

      // The whole network as faint strands; the selected route lights up.
      map.addSource("network", { type: "geojson", data: empty });
      map.addLayer({
        id: "network-base",
        type: "line",
        source: "network",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.14,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2],
        },
      });
      map.addLayer({
        id: "network-active-glow",
        type: "line",
        source: "network",
        filter: ["==", ["get", "routeId"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.3,
          "line-width": 9,
          "line-blur": 6,
        },
      });
      map.addLayer({
        id: "network-active",
        type: "line",
        source: "network",
        filter: ["==", ["get", "routeId"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.85,
          "line-width": 2.4,
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

      // Comet trails under the buses.
      map.addSource("trails", { type: "geojson", data: empty });
      map.addLayer({
        id: "trails",
        type: "line",
        source: "trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.28,
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
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6.5],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0c0f14",
        },
      });

      // Tap a bus for its vitals.
      map.on("click", "vehicles", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as {
          vehicleId: string;
          routeId: string | null;
          speed: number | null;
          ts: string;
        };
        const route = p.routeId ? routesRef.current.get(p.routeId) : null;
        const mph = p.speed != null ? Math.round(Number(p.speed) * 2.237) : null;
        const ago = Math.max(0, Math.round((Date.now() - new Date(p.ts).getTime()) / 1000));
        new maplibregl.Popup({ closeButton: false, offset: 12, maxWidth: "260px" })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div class="ct-popup">
               <div class="ct-popup-route">${route ? `${route.shortName} · ${route.longName}` : "Out of service"}</div>
               <div class="ct-popup-meta">bus ${p.vehicleId}${mph != null ? ` · ${mph} mph` : ""} · ping ${ago}s ago</div>
             </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "vehicles", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "vehicles", () => {
        map.getCanvas().style.cursor = "";
      });

      es = new EventSource(`${API_URL}/api/stream/vehicles`);
      es.onmessage = (e) => {
        const data: VehiclesResponse = JSON.parse(e.data);
        applySnapshot(data.vehicles);
      };
      es.onerror = () => setStalled(true);

      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (now - lastFrame < FRAME_MS) return;
        lastFrame = now;
        map.getSource<maplibregl.GeoJSONSource>("vehicles")?.setData(buildVehicleFrame(now));
        if (now - lastTrailSample >= TRAIL_SAMPLE_MS) {
          lastTrailSample = now;
          sampleTrails(now);
          map.getSource<maplibregl.GeoJSONSource>("trails")?.setData(buildTrailFrame());
        }
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      es?.close();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const live = count != null && !stalled;
  const selectedRoute = filter !== "all" ? routes.find((r) => r.routeId === filter) : null;

  return (
    <div className="relative h-dvh w-full bg-ink">
      {/* maplibre forces position:relative on this node, so size it directly */}
      <div ref={containerRef} className="h-full w-full" />

      {/* the map melts into the chrome at the edges */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 95% 95% at 50% 45%, transparent 62%, rgba(12,15,20,0.6) 100%)",
        }}
      />

      <div className="panel absolute left-4 top-4 w-76 px-5 py-4 max-sm:left-3 max-sm:right-3 max-sm:top-3 max-sm:w-auto">
        <p className="text-[10px] font-medium uppercase tracking-label text-faint">
          Columbus transit, measured
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-fog">
            <RouteGlyph />
            Crosstown
          </h1>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                live ? "live-dot bg-ontime" : stalled ? "bg-late" : "bg-faint"
              }`}
            />
            {live ? "live" : stalled ? "reconnecting" : "connecting"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">
              On the road
            </p>
            <p className="mt-0.5 text-2xl text-fog">
              {count == null ? (
                <span className="font-mono">—</span>
              ) : (
                <CountUp value={count} decimals={0} />
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-label text-faint">
              On time today
            </p>
            <p
              className="mt-0.5 text-2xl"
              style={{
                color: stats?.todayOnTimePct != null ? statusColor(stats.todayOnTimePct) : undefined,
              }}
            >
              {stats?.todayOnTimePct == null ? (
                <span className="font-mono text-fog">—</span>
              ) : (
                <CountUp value={stats.todayOnTimePct} suffix="%" />
              )}
            </p>
          </div>
        </div>

        <label className="mt-4 block text-[10px] font-medium uppercase tracking-label text-faint">
          Route
          <select
            className="mt-1.5 w-full rounded-md border border-line bg-raised px-2 py-1.5 font-sans text-sm text-fog"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All routes</option>
            {routes.map((r) => (
              <option key={r.routeId} value={r.routeId}>
                {r.shortName} - {r.longName}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
          <Link
            href={selectedRoute ? `/routes/${selectedRoute.routeId}` : "/routes"}
            className="link-quiet text-fog"
          >
            {selectedRoute ? `Route ${selectedRoute.shortName} stats` : "Reliability rankings"}
          </Link>
          <Link href="/about" className="text-muted transition-colors hover:text-fog">
            About
          </Link>
        </div>
      </div>
    </div>
  );
}
