import Link from "next/link";
import { RouteGlyph } from "./wordmark";

export function SiteNav({ active }: { active: "routes" | "about" | "replay" }) {
  const item = (href: string, key: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`text-sm ${
        active === key ? "text-fog" : "text-muted hover:text-fog"
      } transition-colors`}
    >
      {label}
    </Link>
  );

  return (
    <header className="border-b border-line">
      <nav className="mx-auto flex max-w-3xl items-baseline gap-6 px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-fog">
          <RouteGlyph />
          Crosstown
        </Link>
        <span className="flex-1" />
        {item("/", "map", "Live map")}
        {item("/replay", "replay", "Replay")}
        {item("/routes", "routes", "Routes")}
        {item("/about", "about", "About")}
      </nav>
    </header>
  );
}
