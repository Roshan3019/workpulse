"use client";

import { useRouter } from "next/navigation";
import { displayName } from "@/lib/format";
import type { Member } from "@/lib/types";

/**
 * Person picker for the admin availability view.
 *
 * It is a native <select> on purpose: keyboard, screen readers and phones all
 * handle it correctly without a custom listbox. It sits beside buttons, so it
 * is held to the same 40px control height they use.
 */
export function MemberPicker({ members, selected }: { members: Member[]; selected: string }) {
  const router = useRouter();

  return (
    <label className="relative block w-full sm:w-auto">
      <span className="sr-only">Choose a teammate</span>
      <select
        value={selected}
        onChange={(event) => router.push(`/app/availability?member=${event.target.value}`)}
        className="h-10 w-full appearance-none rounded-[8px] border border-line-2 bg-white pl-3.5 pr-9 text-[13.5px] font-medium text-ink-2 outline-none transition-colors duration-150 hover:border-[#c9c2b6] focus:border-brand sm:w-auto sm:min-w-[210px]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.75rem center",
        }}
      >
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {displayName(m.profile.fullName)}
          </option>
        ))}
      </select>
    </label>
  );
}
