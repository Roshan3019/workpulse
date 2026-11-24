import { displayName } from "@/lib/format";
import { Avatar, Badge, EmptyState, ProgressBar, Section } from "@/components/ui";
import { UTILISATION_LABEL, UTILISATION_TONE, computeWorkload } from "@/lib/workload";
import type { Member, Task } from "@/lib/types";

const FILL_TONE = {
  green: "green",
  indigo: "brand",
  amber: "amber",
  red: "red",
} as const;

export function WorkloadList({ members, tasks }: { members: Member[]; tasks: Task[] }) {
  const rows = computeWorkload(members, tasks);

  return (
    <Section
      title="Workload per freelancer"
      subtitle="Open estimated hours vs weekly capacity"
      action={<Badge tone="grey">{members.length} freelancers</Badge>}
    >
      {rows.length === 0 ? (
        <EmptyState title="No freelancers yet" hint="Invite your team from Settings and they'll appear here instantly." />
      ) : (
        <div className="divide-y divide-[#efece6]">
          {rows.map((row) => {
            const label = UTILISATION_LABEL[row.state];
            const tone = UTILISATION_TONE[row.state];
            return (
              <div
                key={row.member.id}
                className="grid gap-2.5 py-4 first:pt-1 last:pb-1 md:grid-cols-[250px_1fr_150px] md:items-center md:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    id={row.member.userId}
                    name={row.member.profile.fullName}
                    email={row.member.profile.email}
                    src={row.member.profile.avatarUrl}
                  />
                  {/*
                    A name, and nothing else. The email that used to sit under it
                    is internal detail on a dashboard the admin reads all day —
                    and it made every row two lines of text to scan.
                  */}
                  <div className="min-w-0">
                    <div className="truncate text-[14.5px] font-bold">
                      {displayName(row.member.profile.fullName)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-[12px] text-muted">
                    <span>
                      <b className="font-semibold text-ink-2">{row.assignedHours}h</b> assigned
                      {row.openTasks ? ` · ${row.openTasks} task${row.openTasks === 1 ? "" : "s"}` : ""}
                    </span>
                    <span>{row.capacity}h/wk capacity</span>
                  </div>
                  <ProgressBar value={row.utilisation} tone={FILL_TONE[tone]} />
                </div>

                <div className="flex items-center gap-2.5 md:justify-end">
                  <Badge tone={tone}>{label}</Badge>
                  <span className="text-[14px] font-semibold tabular-nums">{row.utilisation}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
