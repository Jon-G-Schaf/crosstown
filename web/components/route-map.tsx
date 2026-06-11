"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE, applyInkTint } from "@/lib/map-style";

// Non-interactive header map: the route's strand glowing over the dark city.
export function RouteMap({
  lines,
  color,
}: {
  lines: [number, number][][];
  color: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || lines.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const line of lines) for (const c of line) bounds.extend(c);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds,
      fitBoundsOptions: { padding: 28 },
      interactive: false,
      attributionControl: false,
    });

    map.on("load", () => {
      applyInkTint(map);
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: lines.map((coordinates) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        })),
      };
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-opacity": 0.3, "line-width": 8, "line-blur": 5 },
      });
      map.addLayer({
        id: "route-core",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": color, "line-opacity": 0.9, "line-width": 2 },
      });
    });

    return () => map.remove();
  }, [lines, color]);

  return <div ref={containerRef} className="h-full w-full" />;
}
