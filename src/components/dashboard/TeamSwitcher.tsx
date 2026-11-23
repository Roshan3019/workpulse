"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Team } from "@/lib/types";

/**
 * Overall + one tab per team. Plain links with `?team=<slug>` so the view is
 * shareable and survives a refresh — no client state to desync.
 */
export function TeamSwitcher({ teams, active }: { teams: Team[]; active: string | null }) {
  const pathname = usePathname();
  if (!teams.length) return null;

  const tab = (href: string, label: string, isActive: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      aria-current={isActive ? "page" : undefined}
      className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150 ${
        isActive
          ? "bg-white text-ink  ring-1 ring-line"
          : "text-muted hover:text-ink"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className={`tabular-nums text-[11px] ${isActive ? "text-faint" : "text-faint/80"}`}>
          {count}
        </span>
      ) : null}
    </Link>
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-line bg-[#f1f3fa] p-1">
      {tab(pathname, "Overall", active === null)}
      {teams.map((team) =>
        tab(`${pathname}?team=${team.slug}`, team.name, active === team.slug, team.memberIds.length),
      )}
    </div>
  );
}
