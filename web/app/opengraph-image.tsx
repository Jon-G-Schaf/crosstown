import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Crosstown - live COTA bus map and reliability stats for Columbus";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A field of glowing "buses" over deep ink, like the live map at night.
const DOTS: { x: number; y: number; c: string; r: number }[] = [
  { x: 140, y: 120, c: "#f87171", r: 7 },
  { x: 320, y: 90, c: "#7da2ff", r: 6 },
  { x: 520, y: 150, c: "#34d399", r: 7 },
  { x: 760, y: 80, c: "#f87171", r: 5 },
  { x: 980, y: 140, c: "#7da2ff", r: 7 },
  { x: 1080, y: 320, c: "#fbbf24", r: 6 },
  { x: 220, y: 480, c: "#7da2ff", r: 6 },
  { x: 420, y: 540, c: "#f87171", r: 7 },
  { x: 880, y: 520, c: "#34d399", r: 6 },
  { x: 1040, y: 470, c: "#f87171", r: 5 },
  { x: 90, y: 320, c: "#fbbf24", r: 5 },
];

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "radial-gradient(circle at 50% 35%, #161d29 0%, #0c0f14 70%)",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {DOTS.map((d, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: d.x,
              top: d.y,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: 999,
              background: d.c,
              boxShadow: `0 0 ${d.r * 5}px ${d.r * 1.5}px ${d.c}55`,
            }}
          />
        ))}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "#34d399",
              boxShadow: "0 0 40px 12px rgba(52, 211, 153, 0.4)",
            }}
          />
          <div style={{ fontSize: 92, fontWeight: 700, color: "#e8ecf4", letterSpacing: -3 }}>
            Crosstown
          </div>
        </div>
        <div style={{ marginTop: 18, fontSize: 32, color: "#8b94a7" }}>
          Is your bus on time? Columbus, live.
        </div>
      </div>
    ),
    size,
  );
}
