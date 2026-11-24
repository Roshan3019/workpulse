# Planned hours — how the team grid is supposed to behave

One page for the feature the client asked for: a member says *when* they will do
a task, the admin sees those hours as busy on the team grid.

Written down because most of it is a rule, not an implementation detail: a fair
number of the fixes in this area were one screen disagreeing with another.

## The contract

| Thing | Rule |
| --- | --- |
| Working window | **8a–7p, twelve columns**, defined once in `src/lib/availability.ts` (`WORK_HOURS`) and imported by the calendar, the team grid, the planner and every total. |
| Who plans | The member, from the task card on **My tasks** (*Plan my hours*). Not from the availability page. |
| Starting state | **Empty.** Nothing is pre-painted, ever. Hours are the member's call. |
| One drag | One block. Dragging 2p→6p is a single four-hour bar, not four decisions. |
| Planned hours | Automatically **busy** in availability. No prompt, no second confirmation. |
| Clearing | Removing a plan gives those hours back ("not filled in") unless another task still needs them. |
| Two tasks, one hour | Both are kept: the bar reads "Landing page +1" and the tooltip lists both. One is never silently dropped. |

## What the grid draws

- A block of **3 hours or more** prints the task's name once, **centred** across
  the whole bar (from `lg`, where all twelve columns are visible) with its effort
  after it. Pinning it to the left edge made a long block look like it still had
  text left over from its first cell.
- A **shorter block** prints nothing on the bar. It answers on hover, on
  keyboard focus and on tap. A name squeezed into a 44px cell was unreadable and
  "Landi…" was worse.
- Blocks whose task is finished are drawn differently, and a planned hour that
  the member had marked busy is distinguishable from one they had left free.
- The row total is **free hours only**; planned and busy hours are the bars
  themselves, and the sentence under the grid counts them in words.

## Names, not email addresses

The dashboard shows a person's **name and nothing else** — no address under it, no
handle beside it, and no email used as a fallback when a name is missing (that
reads "Unnamed"). `displayName()` in `src/lib/format.ts` is the only way a member
is printed, and `tests/format.test.cjs` fails if a dashboard component reaches for
`profile.email`.

One screen keeps the address: **People**, the roster where an admin promotes or
removes someone. That is an identity decision, so the identity stays unambiguous
there.

## Where the rules live

| Rule | Code |
| --- | --- |
| Merge, split, label, overlap | `src/lib/plans.ts` (pure, unit-tested) |
| Bars, gaps, edges, labels | `src/components/dashboard/TeamSlotGrid.tsx` |
| Painting | `src/components/tasks/TaskPlanDialog.tsx` |
| Mirroring into availability | `0011_task_plans.sql` (triggers) + `src/lib/data/{memory,supabase}.ts` |

`tests/sql/task-plans.test.cjs` runs the pure rules **and** the real SQL in
Postgres (PGlite), including the triggers, so the database and the UI cannot
drift apart without a test failing.

## Known-good behaviours worth not breaking

- The planner's day list comes from the **server**, in the viewer's timezone.
  Never build it from `new Date().toISOString()` — that is UTC, which is
  yesterday for anyone in India before 05:30.
- A member's plan never appears on another member's row.
- Clearing a day releases exactly the hours nothing else claims.
- Keyboard: Enter paints or unpaints an hour, Shift+Arrow stretches a block.
  Enter must **not** arm the pointer drag, or the next mouse move paints hours.
