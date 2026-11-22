"use client";

import { useRouter } from "next/navigation";
import type { Member } from "@/lib/types";

export function MemberPicker({ members, selected }: { members: Member[]; selected: string }) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Choose a teammate</span>
      <select
        value={selected}
        onChange={(event) => router.push(`/app/availability?member=${event.target.value}`)}
        className="rounded-full border border-line-2 bg-white px-4 py-2.5 text-sm font-semibold text-ink-2 outline-none focus:border-brand"
      >
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.profile.fullName ?? m.profile.email}
          </option>
        ))}
      </select>
    </label>
  );
}
