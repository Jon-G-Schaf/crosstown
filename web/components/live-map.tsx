"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type Vehicle, type VehiclesResponse } from "@/lib/api";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
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
          if (r.color) routeColorsRef.current.set(r.routeId, `#${r.color}`);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
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
          color: (v.routeId && routeColorsRef.current.get(v.routeId)) || "#1d4ed8",
        });
      }
      for (const id of animsRef.current.keys()) {
        if (!seen.has(id)) animsRef.current.delete(id);
      }
      setCount(vehicles.length);
    };

    map.on("load", () => {
      map.addSource("vehicles", { type: "geojson", data: buildFrame(0) });
      map.addLayer({
        id: "vehicles",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      es = new EventSource(`${API_URL}/api/stream/vehicles`);
      es.onmessage = (e) => {
        const data: VehiclesResponse = JSON.parse(e.data);
        applySnapshot(data.vehicles);
      };

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

  return (
    <div className="relative h-dvh w-full">
      {/* maplibre forces position:relative on this node, so size it directly */}
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute left-4 top-4 w-64 rounded-lg bg-white/95 px-4 py-3 shadow-md backdrop-blur">
        <h1 className="text-lg font-semibold tracking-tight">Crosstown</h1>
        <p className="text-sm text-neutral-600">
          {count == null ? "Connecting..." : `${count} COTA buses live`}
        </p>
        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Route
          <select
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
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
      </div>
    </div>
  );
}
