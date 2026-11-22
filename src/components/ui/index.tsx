import Link from "next/link";
import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Logo                                                                       */
/* -------------------------------------------------------------------------- */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-[13px] bg-gradient-to-br from-[#6366f1] to-[#4f46e5] shadow-[0_4px_12px_rgba(79,70,229,.35)]"
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12h4l3-8 4 16 3-8h6" />
      </svg>
    </span>
  );
}

export function Logo({ subtitle, href = "/" }: { subtitle?: string; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-[19px] font-extrabold tracking-[-0.02em]">WorkPulse</span>
        {subtitle ? (
          <span className="block text-[10px] font-bold tracking-[.14em] text-faint uppercase">{subtitle}</span>
        ) : null}
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */
const COLORS = ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316"];

export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function initials(name: string | null | undefined, email = ""): string {
  const source = (name ?? "").trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "");
}

export function Avatar({
  name,
  email,
  id,
  src,
  size = 40,
}: {
  name: string | null;
  email?: string;
  id: string;
  src?: string | null;
  size?: number;
}) {
  const text = initials(name, email).toUpperCase();
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "Avatar"}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                     */
/* -------------------------------------------------------------------------- */
type Tone = "green" | "indigo" | "amber" | "red" | "grey";
const TONE_CLASS: Record<Tone, string> = {
  green: "pill-green",
  indigo: "pill-indigo",
  amber: "pill-amber",
  red: "pill-red",
  grey: "pill-grey",
};

export function Badge({ tone = "grey", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${TONE_CLASS[tone]}`}>{children}</span>;
}

/* -------------------------------------------------------------------------- */
/* Section wrapper                                                            */
/* -------------------------------------------------------------------------- */
export function Section({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="h2">{title}</h2>
          {subtitle ? <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint, icon = "✨" }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="py-12 text-center">
      <div className="mb-2 text-2xl">{icon}</div>
      <p className="font-bold text-ink-2">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className = "",
}: {
  value: number;
  tone?: "brand" | "green" | "amber" | "red";
  className?: string;
}) {
  const map = {
    brand: "bg-brand",
    green: "bg-ok",
    amber: "bg-warn",
    red: "bg-bad",
  } as const;
  return (
    <div className={`track ${className}`}>
      <div className={`h-full rounded-full ${map[tone]}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
