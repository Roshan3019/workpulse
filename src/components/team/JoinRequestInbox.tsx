"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import {
  approveJoinRequestAction,
  declineJoinRequestAction,
} from "@/lib/actions/joining";
import type { JoinRequest } from "@/lib/types";

function since(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * People who used the common join link and are waiting to be let in.
 * Approving is the only way they become a member — the link itself grants
 * nothing, which is exactly what the client asked for.
 */
export function JoinRequestInbox({ requests }: { requests: JoinRequest[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  if (!requests.length) return null;

  function decide(id: string, approve: boolean) {
    setBusyId(id);
    setMessage(null);
    startTransition(async () => {
      const result = approve
        ? await approveJoinRequestAction(id)
        : await declineJoinRequestAction(id);
      setBusyId(null);
      if (result.error) setMessage({ tone: "error", text: result.error });
      else if (result.message) setMessage({ tone: "success", text: result.message });
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center gap-2.5 border-b border-line bg-[#fcfcfe] px-4 py-3">
        <h2 className="text-[13.5px] font-semibold text-ink">Waiting to join</h2>
        <span className="rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {requests.length}
        </span>
        <span className="ml-auto text-[12px] text-muted">
          These people used your join link
        </span>
      </div>

      <ul className="divide-y divide-line">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar
              id={request.userId}
              name={request.profile.fullName}
              email={request.profile.email}
              src={request.profile.avatarUrl}
              size={30}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {request.profile.fullName ?? request.profile.email}
              </p>
              <p className="truncate text-[12px] text-muted">
                {request.profile.fullName ? request.profile.email : "No name given"} · asked {since(request.createdAt)}
              </p>
              {request.note ? (
                <p className="mt-1 border-l-2 border-line-2 pl-2 text-[12px] leading-relaxed text-ink-2 italic">
                  “{request.note}”
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => decide(request.id, false)}
                disabled={pending && busyId === request.id}
                className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-[#f4f5fa] hover:text-ink disabled:opacity-50"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={() => decide(request.id, true)}
                disabled={pending && busyId === request.id}
                className="btn-primary btn-sm"
              >
                {pending && busyId === request.id ? "Working…" : "Approve"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {message ? (
        <div className="border-t border-line px-4 py-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
    </section>
  );
}
