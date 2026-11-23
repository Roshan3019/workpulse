"use client";

import { useTransition } from "react";
import { switchOrgAction } from "@/lib/actions/org";

/**
 * "You belong to more than one studio."
 *
 * One account can own a studio and be a member of somebody else's — that is
 * the normal outcome of trying the product yourself and then joining a real
 * team. The session used to resolve to `memberships[0]`, so the same login
 * could land in the empty studio it created earlier and look like it had
 * hijacked the admin dashboard. This makes the choice explicit and never
 * automatic.
 */
export function OrgSwitcher({
  current,
  orgs,
  email,
}: {
  current: string;
  orgs: { id: string; name: string; role: string }[];
  /** Shown next to the chips — two studios can look alike on screen. */
  email?: string;
}) {
  const [pending, startTransition] = useTransition();
  if (orgs.length < 2) return null;

  return (
    <div className="mb-4 rounded-[10px] border border-line bg-[#fbfaf8] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] font-medium text-muted">Your studios</span>
        <div className="flex flex-wrap gap-1.5">
          {orgs.map((org) => {
            const active = org.id === current;
            return (
              <button
                key={org.id}
                type="button"
                disabled={active || pending}
                onClick={() => startTransition(() => void switchOrgAction(org.id))}
                aria-current={active ? "true" : undefined}
                title={active ? "You're viewing this studio" : `Switch to ${org.name}`}
                className={`rounded-[7px] border px-2 py-1 text-[12px] transition-colors ${
                  active
                    ? "border-brand-line bg-brand-soft font-medium text-brand-dark"
                    : "border-line-2 bg-white text-ink-2 hover:border-[#c9c2b6] hover:bg-white"
                } ${pending ? "opacity-60" : ""}`}
              >
                {org.name}
                <span className="ml-1.5 text-[10.5px] text-faint capitalize">{org.role}</span>
              </button>
            );
          })}
        </div>
        {email ? <span className="text-[11px] text-faint sm:ml-auto">signed in as {email}</span> : null}
      </div>
    </div>
  );
}
