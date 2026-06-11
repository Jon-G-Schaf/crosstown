// A route segment: line, a filled stop, an open stop. The whole brand in 22px.
export function RouteGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      width="22"
      height="10"
      viewBox="0 0 22 10"
      aria-hidden="true"
      className={className}
    >
      <line x1="1" y1="5" x2="21" y2="5" stroke="#34d399" strokeWidth="1.5" />
      <circle cx="5" cy="5" r="2.5" fill="#34d399" />
      <circle cx="17" cy="5" r="2.2" fill="#0c0f14" stroke="#34d399" strokeWidth="1.5" />
    </svg>
  );
}
