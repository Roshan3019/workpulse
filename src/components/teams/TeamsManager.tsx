"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/ui";
import { Modal, Alert } from "@/components/ui/Modal";
import { deleteTeamAction, saveTeamAction } from "@/lib/actions/tasks";
import type { Member, Team } from "@/lib/types";

/**
 * Team management. A studio can run several teams; people can be on more than
 * one. Everything here is admin-only, enforced again on the server and in RLS.
 */
export function TeamsManager({ teams, members }: { teams: Team[]; members: Member[] }) {
  const router = useRouter();
  const freelancers = useMemo(() => members.filter((m) => m.role === "member"), [members]);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);

  const open = editing !== null;
  const current = editing === "new" ? null : editing;

  function close() {
    setEditing(null);
    setError(null);
  }

  async function submit(formData: FormData) {
    setError(null);
    const result = await saveTeamAction(formData);
    if (result.error) {
      setError(result.error);
      return;
    }
    close();
    router.refresh();
  }

  function remove(team: Team) {
    const ok = window.confirm(
      `Delete “${team.name}”? Its tasks stay in the studio but stop being attached to a team.`,
    );
    if (!ok) return;
    setBusyId(team.id);
    startTransition(async () => {
      const result = await deleteTeamAction(team.id);
      setBusyId(null);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Teams</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Group people by what they do. Each task belongs to one team.
          </p>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setEditing("new")}>
          New team
        </button>
      </div>

      {error && !open ? (
        <div className="pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {!teams.length ? (
        <div className="py-10 text-center">
          <p className="text-[13.5px] font-medium text-ink-2">No teams yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted">
            Create a team like “Web” or “Branding”, add the people in it, and the dashboard can be
            filtered to just that group.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {teams.map((team) => {
            const people = team.memberIds.map((id) => byId.get(id)).filter(Boolean) as Member[];
            return (
              <li key={team.id} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app?team=${team.slug}`}
                    className="text-[13.5px] font-semibold text-ink hover:underline"
                  >
                    {team.name}
                  </Link>
                  <div className="mt-1 flex items-center gap-2">
                    {people.length ? (
                      <>
                        <span className="flex -space-x-1.5">
                          {people.slice(0, 5).map((m) => (
                            <span key={m.userId} className="rounded-full ring-2 ring-white">
                              <Avatar
                                id={m.userId}
                                name={m.profile.fullName}
                                email={m.profile.email}
                                src={m.profile.avatarUrl}
                                size={20}
                              />
                            </span>
                          ))}
                        </span>
                        <span className="text-[12px] text-muted">
                          {people.length} {people.length === 1 ? "person" : "people"}
                          {people.length > 5 ? ` · +${people.length - 5}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-[12px] text-faint">Nobody in this team yet</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(team)}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-[#f4f5fa] hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(team)}
                    disabled={pending && busyId === team.id}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-bad-soft hover:text-[#b91c1c] disabled:opacity-50"
                  >
                    {pending && busyId === team.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={open}
        onClose={close}
        title={current ? `Edit ${current.name}` : "New team"}
        subtitle={current ? "Rename it, or change who's in it." : "Name it after the work, not the people."}
      >
        <form action={submit} className="space-y-4">
          {current ? <input type="hidden" name="id" value={current.id} /> : null}

          <div className="field">
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              name="name"
              defaultValue={current?.name ?? ""}
              placeholder="Web, Branding, Video…"
              maxLength={60}
              required
              autoFocus
            />
          </div>

          <div>
            <span className="label mb-2 block">People</span>
            {freelancers.length ? (
              <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
                {freelancers.map((m) => (
                  <label
                    key={m.userId}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-[#f1f3fa]"
                  >
                    <input
                      type="checkbox"
                      name="memberIds"
                      value={m.userId}
                      defaultChecked={current?.memberIds.includes(m.userId) ?? false}
                      className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                    />
                    <Avatar
                      id={m.userId}
                      name={m.profile.fullName}
                      email={m.profile.email}
                      src={m.profile.avatarUrl}
                      size={22}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {m.profile.fullName ?? m.profile.email}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">{m.capacity}h/wk</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line-2 px-3 py-4 text-center text-[12.5px] text-muted">
                No freelancers yet. Invite someone first.
              </p>
            )}
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}

          <div className="grid grid-cols-2 gap-2 pt-1 sm:flex sm:items-center sm:justify-end">
            <button type="button" onClick={close} className="btn-ghost btn-sm">
              Cancel
            </button>
            <button type="submit" className="btn-primary btn-sm">
              {current ? "Save team" : "Create team"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
