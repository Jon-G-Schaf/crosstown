"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API_URL, type Vehicle, type VehiclesResponse } from "@/lib/api";
import { brightenForDark, statusColor } from "@/lib/colors";
import { MAP_STYLE, applyInkTint } from "@/lib/map-style";
import { ArrivalTicker } from "./arrival-ticker";
import { CountUp } from "./count-up";
import { RouteGlyph } from "./wordmark";

const COLUMBUS: [number, number] = [-82.9988, 39.9612];
// Feed updates every ~15s; animate each hop over slightly less so buses
// settle before the next snapshot lands.
const HOP_MS = 12_000;
const FRAME_MS = 33;
const TRAIL_SAMPLE_MS = 900;
const TRAIL_POINTS = 14;
const FLOW_STEP_MS = 90;
const FLOW_OPACITY = 0.22;

// Stepping line-dasharray through phase-shifted patterns reads as dashes
// drifting along the line. GTFS shapes are stored in direction of travel,
// so the drift shows which way each route flows. Short dashes and long
// gaps keep it a faint pulse of energy, not a dashed line.
function buildFlowDashSeq(dash: number, gap: number, steps: number): number[][] {
  const period = dash + gap;
  const seq: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const o = (i / steps) * period;
    if (o + dash <= period) {
      seq.push([0, o, dash, period - o - dash]);
    } else {
      // the dash wraps past the pattern start; split it across both ends
      const head = o + dash - period;
      seq.push([head, o - head, dash - head, 0]);
    }
  }
  return seq;
}
const FLOW_DASH_SEQ = buildFlowDashSeq(2, 10, 24);

type RouteInfo = { routeId: string; shortName: string; longName: string; color: string | null };

// COTA's GTFS route colors encode service tier (same color language as
// their printed system map), so the legend labels are keyed by color.
// Unknown colors simply don't get a legend row.
const TIER_LABELS: [hex: string, label: string][] = [
  ["AF272F", "Frequent"],
  ["00205B", "Local"],
  ["007B4B", "Crosstown"],
  ["402A16", "Seasonal"],
];

const PANEL_PREF_EVENT = "ct-panel-change";
function subscribePanelPref(cb: () => void) {
  window.addEventListener(PANEL_PREF_EVENT, cb);
  return () => window.removeEventListener(PANEL_PREF_EVENT, cb);
}

type SystemStats = {
  todayOnTimePct: number | null;
  arrivalsToday: number;
  arrivalsOnRecord: number;
};

type PulseHour = { hour: number; observations: number; onTimePct: number };

// Hours sort by service-day position (4am first, overnight last), matching
// the pulse chart on the rankings page.
const servicePos = (hour: number) => (hour - 4 + 24) % 24;

type Anim = {
  from: [number, number];
  to: [number, number];
  bearingFrom: number | null;
  bearingTo: number | null;
  start: number;
  routeId: string | null;
  color: string;
  speed: number | null;
  ts: string;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Shortest-arc interpolation so a 350->10 degree turn rotates 20 degrees,
// not 340 the wrong way round.
function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function animT(anim: Anim, now: number) {
  return Math.min(1, (now - anim.start) / HOP_MS);
}

function animPos(anim: Anim, now: number): [number, number] {
  const t = animT(anim, now);
  return [lerp(anim.from[0], anim.to[0], t), lerp(anim.from[1], anim.to[1], t)];
}

function animBearing(anim: Anim, now: number): number | null {
  if (anim.bearingTo == null) return anim.bearingFrom;
  if (anim.bearingFrom == null) return anim.bearingTo;
  return lerpAngle(anim.bearingFrom, anim.bearingTo, animT(anim, now));
}

// A GPS-puck style arrow, drawn once per route color and registered as a
// map image. Tip points north; icon-rotate turns it to the bus's bearing.
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

export function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverChipRef = useRef<HTMLDivElement>(null);
  const hoverNumRef = useRef<HTMLSpanElement>(null);
  const hoverNameRef = useRef<HTMLSpanElement>(null);
  const animsRef = useRef(new Map<string, Anim>());
  const trailsRef = useRef(new Map<string, [number, number][]>());
  const routesRef = useRef(new Map<string, RouteInfo>());
  const routeColorsRef = useRef(new Map<string, string>());
  const networkRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const filterRef = useRef<string>("all");
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [count, setCount] = useState<number | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [pulse, setPulse] = useState<PulseHour[]>([]);
  const [stalled, setStalled] = useState(false);
  // Panel starts expanded; the choice persists in localStorage so a
  // returning visitor who shrank it (most useful on phones) keeps their
  // map. useSyncExternalStore keeps SSR hydration clean.
  const panelOpen = useSyncExternalStore(
    subscribePanelPref,
    () => localStorage.getItem("ct-panel") !== "min",
    () => true,
  );
  const togglePanel = () => {
    localStorage.setItem("ct-panel", panelOpen ? "min" : "open");
    window.dispatchEvent(new Event(PANEL_PREF_EVENT));
  };

  useEffect(() => {
    filterRef.current = filter;
    const map = mapRef.current;
    if (!map || !map.getLayer("network-base")) return;
    // Selected route: its strand lights up, the rest of the network recedes.
    map.setFilter("network-active", ["==", ["get", "routeId"], filter]);
    map.setFilter("network-active-glow", ["==", ["get", "routeId"], filter]);
    map.setPaintProperty("network-base", "line-opacity", filter === "all" ? 0.14 : 0.05);
    // Flow pulses follow the selection: everywhere when browsing, only the
    // chosen strand when one is lit.
    if (map.getLayer("network-flow")) {
      map.setFilter(
        "network-flow",
        filter === "all" ? null : ["==", ["get", "routeId"], filter],
      );
    }

    // Camera follows the selection: frame the route, or return to the city.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (filter === "all") {
      map.flyTo({ center: COLUMBUS, zoom: 11.3, duration: reduced ? 0 : 1400 });
      return;
    }
    const network = networkRef.current;
    if (!network) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const f of network.features) {
      if ((f.properties as { routeId?: string }).routeId !== filter) continue;
      for (const c of (f.geometry as GeoJSON.LineString).coordinates) {
        bounds.extend(c as [number, number]);
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        // leave room for the panel on desktop; on mobile it overlays the top
        padding:
          window.innerWidth >= 640
            ? { top: 72, bottom: 72, left: 360, right: 72 }
            : { top: 180, bottom: 48, left: 32, right: 32 },
        maxZoom: 13.5,
        duration: reduced ? 0 : 1400,
      });
    }
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

    const loadStats = () => {
      fetch(`${API_URL}/api/stats/system`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: SystemStats | null) => data && setStats(data))
        .catch(() => {});
      fetch(`${API_URL}/api/stats/pulse`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { hours: PulseHour[] } | null) => data && setPulse(data.hours))
        .catch(() => {});
    };
    loadStats();
    const statsTimer = setInterval(loadStats, 60_000);
    return () => clearInterval(statsTimer);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The boot-up: camera starts pulled back and tilted, then settles onto
    // the city while the strands and buses fade up underneath it.
    const intro = !reduced;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: COLUMBUS,
      zoom: intro ? 9.4 : 11.3,
      pitch: intro ? 50 : 0,
      bearing: intro ? -18 : 0,
      attributionControl: false,
    });
    // Bottom-right, collapsed to the icon: the credits stay one tap away
    // (the basemap's own compact pattern), and the expanded text can't sit
    // on top of the panel (mobile) or the ticker (desktop). The ticker and
    // the mobile legend leave the corner clear for it.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    const collapseAttribution = () =>
      containerRef.current
        ?.querySelector("details.maplibregl-ctrl-attrib")
        ?.removeAttribute("open");
    collapseAttribution();
    mapRef.current = map;

    // debug/test handle (used by headless verification)
    (window as unknown as { __map?: maplibregl.Map }).__map = map;

    let es: EventSource | undefined;
    let raf = 0;
    let lastFrame = 0;
    let lastTrailSample = 0;
    let introTimer: number | undefined;
    let flowDashIdx = 0;

    const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;

    const buildVehicleFrame = (now: number): GeoJSON.FeatureCollection => {
      const features: GeoJSON.Feature[] = [];
      const active = filterRef.current;
      for (const [vehicleId, anim] of animsRef.current) {
        if (active !== "all" && anim.routeId !== active) continue;
        const bearing = animBearing(anim, now);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: animPos(anim, now) },
          properties: {
            vehicleId,
            routeId: anim.routeId,
            color: anim.color,
            speed: anim.speed,
            ts: anim.ts,
            // omitted entirely when unknown so layer filters can ["has"] it
            ...(bearing != null ? { bearing, icon: `arrow-${anim.color}` } : {}),
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

    // Arrow icons are tinted per route, registered once per color on demand.
    const ensureArrowImage = (color: string) => {
      const id = `arrow-${color}`;
      if (!map.hasImage(id)) map.addImage(id, arrowImage(color));
    };

    const applySnapshot = (vehicles: Vehicle[]) => {
      const now = performance.now();
      const seen = new Set<string>();
      for (const v of vehicles) {
        seen.add(v.vehicleId);
        const prev = animsRef.current.get(v.vehicleId);
        const color = (v.routeId && routeColorsRef.current.get(v.routeId)) || "#7da2ff";
        // keep the last known heading while the feed omits it, so a bus
        // waiting at a light does not snap back to a plain dot
        const bearingTo = v.bearing ?? prev?.bearingTo ?? null;
        if (bearingTo != null) ensureArrowImage(color);
        animsRef.current.set(v.vehicleId, {
          from: prev ? animPos(prev, now) : [v.lon, v.lat],
          to: [v.lon, v.lat],
          bearingFrom: prev ? animBearing(prev, now) : v.bearing,
          bearingTo,
          start: now,
          routeId: v.routeId,
          color,
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
      // maplibre may re-open the compact attribution while settling
      collapseAttribution();

      // The whole network as faint strands; the selected route lights up.
      map.addSource("network", { type: "geojson", data: empty });
      map.addLayer({
        id: "network-base",
        type: "line",
        source: "network",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": intro ? 0 : 0.14,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2],
        },
      });
      // Pulses of light drifting along every strand in the direction of
      // travel; the dasharray is stepped from the render loop. Skipped
      // entirely under reduced motion (static dashes would just look torn).
      if (!reduced) {
        map.addLayer({
          id: "network-flow",
          type: "line",
          source: "network",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["get", "color"],
            "line-opacity": intro ? 0 : FLOW_OPACITY,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2.2],
            "line-dasharray": FLOW_DASH_SEQ[0],
          },
        });
      }
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

      // The hovered strand brightens before you commit to a click.
      map.addLayer({
        id: "network-hover",
        type: "line",
        source: "network",
        filter: ["==", ["get", "routeId"], "__none__"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 14, 3],
        },
      });

      // Invisible fat line over the strands so they are clickable without
      // pixel-perfect aim. Pointer events bind to this layer.
      map.addLayer({
        id: "network-hit",
        type: "line",
        source: "network",
        paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 },
      });

      fetch(`${API_URL}/api/shapes`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: GeoJSON.FeatureCollection | null) => {
          if (!data) return;
          for (const f of data.features) {
            const props = f.properties as { color: string | null };
            props.color = brightenForDark(props.color);
          }
          networkRef.current = data;
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
          "circle-opacity": intro ? 0 : 0.25,
          "circle-blur": 1,
        },
      });
      // Buses with a known heading render as rotated arrows; the rest stay
      // plain dots. Same colors, same glow underneath.
      map.addLayer({
        id: "vehicles",
        type: "circle",
        source: "vehicles",
        filter: ["!", ["has", "bearing"]],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6.5],
          "circle-color": ["get", "color"],
          "circle-opacity": intro ? 0 : 1,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0c0f14",
          "circle-stroke-opacity": intro ? 0 : 1,
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
        paint: {
          "icon-opacity": intro ? 0 : 1,
        },
      });

      // Run the boot-up: fly the camera home while strands draw up, flow
      // pulses join, and the fleet fades in last. Transitions are restored
      // to snappy once the curtain is fully up, so a route selection right
      // after load does not dim the network in slow motion.
      if (intro) {
        map.flyTo({ center: COLUMBUS, zoom: 11.3, pitch: 0, bearing: 0, duration: 2800 });
        const fadeIn = (
          layer: string,
          prop: string,
          value: number,
          duration: number,
          delay: number,
        ) => {
          map.setPaintProperty(layer, `${prop}-transition`, { duration, delay });
          map.setPaintProperty(layer, prop, value);
        };
        fadeIn("network-base", "line-opacity", 0.14, 1800, 400);
        fadeIn("network-flow", "line-opacity", FLOW_OPACITY, 1600, 1300);
        fadeIn("vehicles-glow", "circle-opacity", 0.25, 900, 1700);
        fadeIn("vehicles", "circle-opacity", 1, 900, 1700);
        fadeIn("vehicles", "circle-stroke-opacity", 1, 900, 1700);
        fadeIn("vehicles-arrow", "icon-opacity", 1, 900, 1700);
        introTimer = window.setTimeout(() => {
          for (const [layer, prop] of [
            ["network-base", "line-opacity"],
            ["network-flow", "line-opacity"],
            ["vehicles-glow", "circle-opacity"],
            ["vehicles", "circle-opacity"],
            ["vehicles", "circle-stroke-opacity"],
            ["vehicles-arrow", "icon-opacity"],
          ]) {
            map.setPaintProperty(layer, `${prop}-transition`, { duration: 300, delay: 0 });
          }
        }, 3000);
      }

      // Tap a bus for its vitals.
      const onVehicleClick = (
        e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
      ) => {
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
      };
      for (const layer of ["vehicles", "vehicles-arrow"]) {
        map.on("click", layer, onVehicleClick);
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      // Click a strand to select its route (buses win when they overlap);
      // clicking the already-selected strand deselects.
      map.on("click", "network-hit", (e) => {
        const busHit = map.queryRenderedFeatures(e.point, {
          layers: ["vehicles", "vehicles-arrow"],
        });
        if (busHit.length > 0) return;
        const routeId = (e.features?.[0]?.properties as { routeId?: string })?.routeId;
        if (!routeId) return;
        setFilter((current) => (current === routeId ? "all" : routeId));
      });
      map.on("mouseenter", "network-hit", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "network-hit", () => {
        map.getCanvas().style.cursor = "";
      });

      // Hover spotlight: the strand under the cursor brightens and a chip
      // names it. The chip follows the pointer via direct style writes (no
      // React state at mousemove frequency). Fine pointers only.
      if (window.matchMedia("(pointer: fine)").matches) {
        let hoveredRoute: string | null = null;
        map.on("mousemove", "network-hit", (e) => {
          const routeId = (e.features?.[0]?.properties as { routeId?: string })?.routeId;
          if (!routeId) return;
          if (routeId !== hoveredRoute) {
            hoveredRoute = routeId;
            map.setFilter("network-hover", ["==", ["get", "routeId"], routeId]);
            const route = routesRef.current.get(routeId);
            if (hoverNumRef.current) hoverNumRef.current.textContent = route?.shortName ?? "";
            if (hoverNameRef.current) hoverNameRef.current.textContent = route?.longName ?? "";
          }
          const chip = hoverChipRef.current;
          if (chip) {
            chip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 16}px)`;
            chip.style.opacity = "1";
          }
        });
        map.on("mouseleave", "network-hit", () => {
          hoveredRoute = null;
          map.setFilter("network-hover", ["==", ["get", "routeId"], "__none__"]);
          if (hoverChipRef.current) hoverChipRef.current.style.opacity = "0";
        });
      }

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
        if (!reduced) {
          const idx = Math.floor(now / FLOW_STEP_MS) % FLOW_DASH_SEQ.length;
          if (idx !== flowDashIdx) {
            flowDashIdx = idx;
            map.setPaintProperty("network-flow", "line-dasharray", FLOW_DASH_SEQ[idx]);
          }
        }
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
      window.clearTimeout(introTimer);
      es?.close();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const live = count != null && !stalled;
  const selectedRoute = filter !== "all" ? routes.find((r) => r.routeId === filter) : null;

  // Only the tiers actually present in the loaded routes, in fixed order,
  // swatched with the same brightened color the strands are drawn in.
  const routeColorSet = new Set(
    routes.map((r) => (r.color ?? "").replace("#", "").toUpperCase()),
  );
  const legend = TIER_LABELS.filter(([hex]) => routeColorSet.has(hex)).map(([hex, label]) => ({
    label,
    color: brightenForDark(hex),
  }));

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

      {/* hover spotlight chip; position and visibility are driven
          imperatively from the map's mousemove handler */}
      <div
        ref={hoverChipRef}
        className="panel pointer-events-none absolute left-0 top-0 z-10 flex items-baseline gap-2 px-3 py-1.5 opacity-0 transition-opacity duration-150"
      >
        <span ref={hoverNumRef} className="font-mono text-xs font-semibold text-fog" />
        <span ref={hoverNameRef} className="text-xs text-muted" />
      </div>

      <ArrivalTicker />

      {legend.length > 0 && (
        <div className="panel pointer-events-none absolute bottom-4 left-4 flex items-center gap-4 px-3.5 py-2 max-sm:bottom-3 max-sm:left-3 max-sm:right-12 max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-1">
          {legend.map((t) => (
            <span key={t.label} className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span className="text-[10px] font-medium uppercase tracking-label text-muted">
                {t.label}
              </span>
            </span>
          ))}
        </div>
      )}

      <div
        className={
          panelOpen
            ? "panel absolute left-4 top-4 w-76 px-5 py-4 max-sm:left-3 max-sm:right-3 max-sm:top-3 max-sm:w-auto"
            : "panel absolute left-4 top-4 px-4 py-2.5 max-sm:left-3 max-sm:top-3"
        }
      >
        {panelOpen && (
          <p className="text-[10px] font-medium uppercase tracking-label text-faint">
            Columbus transit, measured
          </p>
        )}
        <div className={panelOpen ? "mt-1.5 flex items-center justify-between" : "flex items-center gap-3"}>
          <h1
            className={`flex items-center gap-2.5 font-semibold tracking-tight text-fog ${
              panelOpen ? "text-xl" : "text-base"
            }`}
          >
            <RouteGlyph />
            Crosstown
          </h1>
          <span className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <span
                className={`h-2 w-2 rounded-full ${
                  live ? "live-dot bg-ontime" : stalled ? "bg-late" : "bg-faint"
                }`}
              />
              {panelOpen && (live ? "live" : stalled ? "reconnecting" : "connecting")}
            </span>
            <button
              type="button"
              onClick={togglePanel}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? "Shrink panel" : "Expand panel"}
              className="-my-1 -mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-raised font-mono text-base leading-none text-fog transition-colors hover:border-fog/30"
            >
              {panelOpen ? "–" : "+"}
            </button>
          </span>
        </div>

        {panelOpen && (
        <>
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
              style={
                stats?.todayOnTimePct != null
                  ? {
                      color: statusColor(stats.todayOnTimePct),
                      textShadow: `0 0 18px ${statusColor(stats.todayOnTimePct)}59`,
                    }
                  : undefined
              }
            >
              {stats?.todayOnTimePct == null ? (
                <span className="font-mono text-fog">—</span>
              ) : (
                <CountUp value={stats.todayOnTimePct} suffix="%" />
              )}
            </p>
            {pulse.length > 1 && (
              <span
                aria-hidden="true"
                className="mt-1.5 flex h-3.5 items-end gap-[2px]"
                title="On-time % by hour today"
              >
                {[...pulse]
                  .sort((a, b) => servicePos(a.hour) - servicePos(b.hour))
                  .map((h) => (
                    <span
                      key={h.hour}
                      className="w-[3px] rounded-full"
                      style={{
                        height: `${Math.max(18, h.onTimePct)}%`,
                        backgroundColor: statusColor(h.onTimePct),
                        opacity: 0.85,
                      }}
                    />
                  ))}
              </span>
            )}
          </div>
        </div>

        <label className="mt-4 block text-[10px] font-medium uppercase tracking-label text-faint">
          Route
          <select
            className="select-quiet mt-1.5 w-full rounded-md border border-line bg-raised py-1.5 pl-2.5 pr-8 font-sans text-sm text-fog transition-colors hover:border-fog/20"
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
          <span className="flex items-center gap-4">
            <Link href="/replay" className="text-muted transition-colors hover:text-fog">
              Replay
            </Link>
            <Link href="/about" className="text-muted transition-colors hover:text-fog">
              About
            </Link>
          </span>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
