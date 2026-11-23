"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Badge } from "@/components/ui";
import { Alert } from "@/components/ui/Modal";
import { changeCapacityAction, changeRoleAction, removeMemberAction } from "@/lib/actions/team";
import { ROLE_LABEL, ROLE_TONE, type Member, type OrgRole } from "@/lib/types";

export function TeamGrid({
  members,
  currentUserId,
  currentRole,
  freeHours,
}: {
  members: Member[];
  currentUserId: string;
  currentRole: OrgRole;
  freeHours: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function run(id: string, fn: () => Promise<{ error?: string }>) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isOwner = member.role === "owner";
          const canChangeRole = !isSelf && !isOwner && currentRole !== "member";
          const canRemove = !isSelf && !isOwner && currentRole !== "member";

          return (
            <div key={member.id} className="card p-5">
              <div className="flex items-start gap-3">
                <Avatar
                  id={member.userId}
                  name={member.profile.fullName}
                  email={member.profile.email}
                  src={member.profile.avatarUrl}
                  size={48}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[16px] font-extrabold">{member.profile.fullName ?? "Unnamed"}</h3>
                    {isSelf ? <Badge tone="indigo">You</Badge> : null}
                  </div>
                  <p className="truncate text-[12.5px] text-muted">{member.profile.email}</p>
                </div>
                <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
              </div>

              <dl className="mt-4 space-y-2 text-[13.5px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Free next 7 days</dt>
                  <dd className="font-bold">
                    {member.role === "member" ? (
                      `${freeHours[member.userId] ?? 0}h`
                    ) : (
                      <span className="text-faint" title="Availability is only tracked for members">
                        not tracked
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Weekly capacity</dt>
                  <dd>
                    <span className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={80}
                        defaultValue={member.capacity}
                        disabled={pending || currentRole === "member"}
                        aria-label={`Weekly capacity for ${member.profile.fullName ?? member.profile.email}`}
                        onBlur={(event) => {
                          const value = event.target.value;
                          if (Number(value) === member.capacity) return;
                          run(member.id, () => changeCapacityAction(member.id, value));
                        }}
                        className="w-16 rounded-lg border border-line-2 px-2 py-1 text-center font-bold outline-none focus:border-brand"
                      />
                      <span className="text-muted">h</span>
                    </span>
                  </dd>
                </div>
              </dl>

              <div className="mt-3">
                <label htmlFor={`role-${member.id}`} className="label">
                  Role
                </label>
                <select
                  id={`role-${member.id}`}
                  defaultValue={member.role}
                  disabled={!canChangeRole || pending || busyId === member.id}
                  onChange={(event) => run(member.id, () => changeRoleAction(member.id, event.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-line-2 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-[#f6f7fb] disabled:text-faint"
                >
                  <option value="member">Member: own tasks and availability</option>
                  <option value="admin">Admin: manages people and tasks</option>
                  {isOwner ? <option value="owner">Owner: full control</option> : null}
                </select>

                {isSelf ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                    🔒 You can&apos;t change your own role.
                  </p>
                ) : isOwner ? (
                  <p className="mt-1.5 text-[11.5px] text-faint">
                    Ownership moves through Settings → Transfer ownership.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11.5px] text-faint">
                    {member.role === "member"
                      ? "Admins have no availability calendar."
                      : "Demoting to member gives them an availability calendar."}
                  </p>
                )}
              </div>

              {canRemove ? (
                <div className="mt-3 border-t border-line pt-3">
                  {confirmRemove === member.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(member.id, () => removeMemberAction(member.id))}
                        className="rounded-lg bg-bad px-3 py-1.5 text-[12.5px] font-bold text-white"
                      >
                        {pending ? "Removing…" : "Confirm remove"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(null)}
                        className="rounded-lg px-2 py-1.5 text-[12.5px] font-bold text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(member.id)}
                      className="text-[12.5px] font-bold text-muted hover:text-[#b91c1c]"
                    >
                      Remove from team
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
