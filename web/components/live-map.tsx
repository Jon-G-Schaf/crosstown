"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type Vehicle, type VehiclesResponse } from "@/lib/api";
import { brightenForDark } from "@/lib/colors";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// Feed updates every ~15s; animate each hop over slightly less so buses
// settle before the next snapshot lands.
const HOP_MS = 12_000;
const FRAME_MS = 33;

type RouteInfo = { routeId: string; shortName: string; longName: string; color: string | null };

type Anim = {
  from: [number, number];
  to: [number, number];
  start: number;
  routeId: string | null;
  color: string;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animsRef = useRef(new Map<string, Anim>());
  const routeColorsRef = useRef(new Map<string, string>());
  const filterRef = useRef<string>("all");
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [count, setCount] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    fetch(`${API_URL}/api/routes`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { routes: RouteInfo[] } | null) => {
        if (!data) return;
        setRoutes(data.routes);
        for (const r of data.routes) {
          routeColorsRef.current.set(r.routeId, brightenForDark(r.color));
        }
      })
      .catch(() => {});
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

    // debug/test handle (used by headless verification)
    (window as unknown as { __map?: maplibregl.Map }).__map = map;

    let es: EventSource | undefined;
    let raf = 0;
    let lastFrame = 0;

    const buildFrame = (now: number): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = [];
      const active = filterRef.current;
      for (const [vehicleId, anim] of animsRef.current) {
        if (active !== "all" && anim.routeId !== active) continue;
        const t = Math.min(1, (now - anim.start) / HOP_MS);
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lerp(anim.from[0], anim.to[0], t), lerp(anim.from[1], anim.to[1], t)],
          },
          properties: { vehicleId, color: anim.color },
        });
      }
      return { type: "FeatureCollection", features };
    };

    const applySnapshot = (vehicles: Vehicle[]) => {
      const now = performance.now();
      const seen = new Set<string>();
      for (const v of vehicles) {
        seen.add(v.vehicleId);
        const prev = animsRef.current.get(v.vehicleId);
        const from: [number, number] = prev
          ? (() => {
              const t = Math.min(1, (now - prev.start) / HOP_MS);
              return [lerp(prev.from[0], prev.to[0], t), lerp(prev.from[1], prev.to[1], t)] as [
                number,
                number,
              ];
            })()
          : [v.lon, v.lat];
        animsRef.current.set(v.vehicleId, {
          from,
          to: [v.lon, v.lat],
          start: now,
          routeId: v.routeId,
          color: (v.routeId && routeColorsRef.current.get(v.routeId)) || "#7da2ff",
        });
      }
      for (const id of animsRef.current.keys()) {
        if (!seen.has(id)) animsRef.current.delete(id);
      }
      setCount(vehicles.length);
      setStalled(false);
    };

    map.on("load", () => {
      map.addSource("vehicles", { type: "geojson", data: buildFrame(0) });
      // Glow: a soft halo under each bus, then a bright core with dark stroke.
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
        const source = map.getSource<maplibregl.GeoJSONSource>("vehicles");
        source?.setData(buildFrame(now));
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      es?.close();
      map.remove();
    };
  }, []);

  const live = count != null && !stalled;

  return (
    <div className="relative h-dvh w-full bg-ink">
      {/* maplibre forces position:relative on this node, so size it directly */}
      <div ref={containerRef} className="h-full w-full" />

      <div className="panel absolute left-4 top-4 w-72 px-5 py-4 max-sm:left-3 max-sm:right-3 max-sm:top-3 max-sm:w-auto">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-fog">Crosstown</h1>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                live ? "live-dot bg-ontime" : stalled ? "bg-late" : "bg-faint"
              }`}
            />
            {live ? "live" : stalled ? "reconnecting" : "connecting"}
          </span>
        </div>

        <p className="mt-1 font-mono text-sm text-muted">
          {count == null ? "—" : `${count} buses on the road`}
        </p>

        <label className="mt-4 block text-[11px] font-medium uppercase tracking-label text-faint">
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
          <Link href="/routes" className="link-quiet text-fog">
            Reliability rankings
          </Link>
          <Link href="/about" className="text-muted transition-colors hover:text-fog">
            About
          </Link>
        </div>
      </div>
    </div>
  );
}
