"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type Vehicle, type VehiclesResponse } from "@/lib/api";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
const REFRESH_MS = 15_000;

function toGeoJSON(vehicles: Vehicle[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      properties: {
        vehicleId: v.vehicleId,
        routeId: v.routeId,
        bearing: v.bearing ?? 0,
      },
    })),
  };
}

export function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: COLUMBUS,
      zoom: 11.3,
      attributionControl: { compact: true },
    });

    let timer: ReturnType<typeof setInterval> | undefined;

    map.on("load", () => {
      map.addSource("vehicles", {
        type: "geojson",
        data: toGeoJSON([]),
      });
      map.addLayer({
        id: "vehicles",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 7],
          "circle-color": "#1d4ed8",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      const refresh = async () => {
        try {
          const res = await fetch(`${API_URL}/api/vehicles`);
          if (!res.ok) return;
          const data: VehiclesResponse = await res.json();
          const source = map.getSource<maplibregl.GeoJSONSource>("vehicles");
          source?.setData(toGeoJSON(data.vehicles));
          setCount(data.vehicles.length);
        } catch {
          // transient network error; next tick retries
        }
      };

      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    });

    return () => {
      if (timer) clearInterval(timer);
      map.remove();
    };
  }, []);

  return (
    <div className="relative h-dvh w-full">
      {/* maplibre forces position:relative on this node, so size it directly */}
      <div ref={containerRef} className="h-full w-full" />
      <header className="absolute left-4 top-4 rounded-lg bg-white/90 px-4 py-3 shadow-md backdrop-blur">
        <h1 className="text-lg font-semibold tracking-tight">Crosstown</h1>
        <p className="text-sm text-neutral-600">
          {count == null ? "Connecting..." : `${count} COTA buses live`}
        </p>
      </header>
    </div>
  );
}
