"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Avatar, Badge, Logo } from "@/components/ui";
import { ROLE_LABEL, isAdminRole, type Session } from "@/lib/types";
import { signOut } from "@/lib/actions/auth";

const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  tasks: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  team: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  teams: (
    <>
      <path d="M4 7h16M4 12h16M4 17h10" />
      <circle cx="19" cy="17" r="2" />
    </>
  ),
  availability: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.33.4.62.73.8" />
    </>
  ),
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

const MEMBER_NAV: NavItem[] = [
  { href: "/app/my-tasks", label: "My Tasks", icon: "tasks" },
  { href: "/app/availability", label: "Availability", icon: "availability" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

const ADMIN_NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: "dashboard" },
  { href: "/app/tasks", label: "All Tasks", icon: "tasks" },
  { href: "/app/team", label: "People", icon: "team" },
  { href: "/app/teams", label: "Teams", icon: "teams" },
  { href: "/app/availability", label: "Availability", icon: "availability" },
  { href: "/app/settings", label: "Settings", icon: "settings" },
];

export function AppShell({
  session,
  seatsUsed,
  children,
}: {
  session: Session;
  seatsUsed: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const admin = isAdminRole(session.membership.role);
  const nav = admin ? ADMIN_NAV : MEMBER_NAV;

  const isActive = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href);

  const navLinks = (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={isActive(item.href) ? "page" : undefined}
          className={`flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
            isActive(item.href)
              ? "bg-brand text-white shadow-[0_4px_12px_rgba(79,70,229,.3)]"
              : "text-ink-2 hover:bg-[#f1f3fa]"
          }`}
        >
          <NavIcon name={item.icon} />
          {item.label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* ---------------- sidebar (desktop) ---------------- */}
      <aside className="sticky top-0 hidden h-screen w-[250px] shrink-0 flex-col border-r border-line bg-white/85 px-4 py-5 backdrop-blur lg:flex">
        <Logo subtitle={admin ? "Admin console" : "Freelancer view"} href="/app" />
        <div className="mt-7 flex-1">{navLinks}</div>

        <div className="rounded-2xl border border-line bg-[#fafaff] p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label">Plan</span>
            <span className="text-[12px] font-semibold tabular-nums text-muted">
              {seatsUsed}/{session.organization.seatLimit} seats
            </span>
          </div>
          <div className="mt-1 text-sm font-extrabold capitalize">{session.organization.plan}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e7f5]">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${Math.min(100, (seatsUsed / session.organization.seatLimit) * 100)}%` }}
            />
          </div>
          {admin ? (
            <Link href="/app/settings" className="mt-2.5 block text-[12px] font-bold text-brand">
              Manage plan
            </Link>
          ) : null}
        </div>

        <UserRow session={session} />
      </aside>

      {/* ---------------- main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="sticky top-0 z-50 flex items-center gap-3 border-b border-line bg-white/92 px-4 py-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className="grid h-10 w-10 place-items-center rounded-xl border border-line-2 bg-white text-ink-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <Logo subtitle={admin ? "Admin console" : "Freelancer view"} href="/app" />
          <div className="ml-auto flex items-center gap-2">
            <Avatar
              id={session.user.id}
              name={session.user.fullName}
              email={session.user.email}
              src={session.user.avatarUrl}
              size={34}
            />
          </div>
        </header>

        {open ? (
          <div className="border-b border-line bg-white px-4 py-4 lg:hidden">
            {navLinks}
            <div className="mt-4 border-t border-line pt-4">
              <UserRow session={session} />
            </div>
          </div>
        ) : null}

        {session.demo ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-line bg-brand-soft px-4 py-2 text-[12.5px] font-semibold text-brand-dark sm:px-6">
            <Badge tone="indigo">Demo mode</Badge>
            <span>
              Sample data, stored in memory. Add your keys to{" "}
              <code className="rounded bg-white/70 px-1">.env.local</code> to go live.
            </span>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>

        <footer className="mx-auto w-full max-w-[1180px] px-4 pb-8 text-center text-[12px] leading-relaxed text-faint sm:px-6">
          WorkPulse · Team availability tracker
        </footer>
      </div>
    </div>
  );
}

function UserRow({ session }: { session: Session }) {
  return (
    <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-4">
      <Avatar
        id={session.user.id}
        name={session.user.fullName}
        email={session.user.email}
        src={session.user.avatarUrl}
        size={38}
      />
      <div className="min-w-0 flex-1 text-right lg:text-left">
        <div className="truncate text-[13.5px] font-bold">{session.user.fullName ?? session.user.email}</div>
        <div className="text-[10.5px] font-medium tracking-[.1em] text-brand uppercase">
          {ROLE_LABEL[session.membership.role]}
        </div>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-[#f1f3fa] hover:text-ink"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </form>
    </div>
  );
}
