import type maplibregl from "maplibre-gl";

export const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Retints Carto's dark-matter into Crosstown's exact ink-blue palette so the
// basemap reads as part of the design, not a stock map. Best-effort: any
// layer the style renames in the future just keeps Carto's color.
export function applyInkTint(map: maplibregl.Map) {
  const set = (id: string, prop: string, value: unknown) => {
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      // layer or property missing in this style version; leave it be
    }
  };

  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    if (layer.type === "background") {
      set(id, "background-color", "#0b0e14");
    } else if (layer.type === "fill" && /water/i.test(id)) {
      set(id, "fill-color", "#070a10");
    } else if (layer.type === "fill" && /(landcover|park|green|wood)/i.test(id)) {
      set(id, "fill-color", "#0d1119");
    } else if (layer.type === "fill" && /(building|landuse)/i.test(id)) {
      set(id, "fill-color", "#0e1219");
    } else if (layer.type === "line" && /(motorway|trunk|highway)/i.test(id)) {
      set(id, "line-color", "#222c3d");
    } else if (layer.type === "line" && /(primary|secondary|major)/i.test(id)) {
      set(id, "line-color", "#1c2433");
    } else if (layer.type === "line") {
      set(id, "line-color", "#151b27");
    } else if (layer.type === "symbol") {
      set(id, "text-color", "#4d5870");
      set(id, "text-halo-color", "#0b0e14");
    }
  }
}
