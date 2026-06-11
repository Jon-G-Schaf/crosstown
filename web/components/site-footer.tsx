import { RouteGlyph } from "./wordmark";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 font-mono text-[11px] text-faint">
        <span className="flex items-center gap-2">
          <RouteGlyph />
          Crosstown
        </span>
        <span>COTA GTFS-realtime, recorded since June 2026</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-[3px] bg-ink ring-1 ring-line" />
          ink
          <span className="ml-2 inline-block h-2 w-2 rounded-[3px] bg-ontime" />
          on time
          <span className="ml-2 inline-block h-2 w-2 rounded-[3px] bg-verylate" />
          late
        </span>
        <span className="ml-auto">
          set in Archivo &amp; Plex Mono · built by{" "}
          <a href="https://jongschaf.com" className="text-muted hover:text-fog">
            Jon G Schaf
          </a>
        </span>
      </div>
    </footer>
  );
}
