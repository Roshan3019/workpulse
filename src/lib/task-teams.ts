/**
 * Which team a task belongs to — the one rule the assign dialog and the server
 * action must agree on.
 *
 * The client's brief, in their words:
 *   • pick one person from Team 1 and the Team field should select Team 1 by
 *     itself;
 *   • if an admin then forces Team 2 while somebody from Team 1 is on the task,
 *     warn them about it rather than silently saving a contradiction.
 *
 * So a task's team is never free text: it is *derived* from who is assigned. The
 * only choice left is "No team (studio-wide)", which is real — a studio-wide
 * task is visible to everyone, not to one team.
 *
 * Nothing here touches the DOM or the network, so the rules can be tested
 * directly (tests/teams.test.cjs).
 */

import type { Team } from "./types";

export type TeamChoice = { teamId: string | null; warning: string | null };

/**
 * "Studio-wide" as a *deliberate* choice. It is distinct from `null` (which
 * means "nobody has decided — derive it from the people"), because a studio-wide
 * task is visible to everyone and will never appear under a team tab.
 */
export const STUDIO_WIDE = "studio-wide";

/** What the Team field is currently saying. */
export type TeamIntent = string | null;

/** Teams a person is on, in the order the studio lists them. */
export function teamsForUser(teams: Team[], userId: string): Team[] {
  return teams.filter((team) => team.memberIds.includes(userId));
}

/** The one team a person belongs to, or null when they're on none/several. */
export function soleTeamOf(teams: Team[], userId: string): Team | null {
  const mine = teamsForUser(teams, userId);
  return mine.length === 1 ? mine[0] : null;
}

function names(teams: Team[]): string {
  const list = teams.map((t) => t.name);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * The team a task should carry once these people are on it.
 *
 * `current` is what the admin has chosen in the field (null = studio-wide).
 * Returns a warning instead of throwing, because the dialog has to be able to
 * *render* the objection while still letting them save — the server re-runs the
 * same function, so a warning can never be bypassed by ignoring the UI.
 */
export function resolveTaskTeam(
  teams: Team[],
  assigneeIds: string[],
  current: TeamIntent,
): TeamChoice {
  const people = [...new Set(assigneeIds.filter(Boolean))];
  if (!people.length) return { teamId: null, warning: null };

  const perPerson = people.map((id) => teamsForUser(teams, id));
  const all = new Set(perPerson.flat().map((t) => t.id));

  /*
   * Studio-wide on purpose: honour it, and say what it costs — a task with no
   * team lives in the Overall view only, which is easy to miss when everyone on
   * it belongs to one team.
   */
  if (current === STUDIO_WIDE) {
    if (all.size !== 1) return { teamId: null, warning: null };
    const only = teams.find((t) => t.id === [...all][0]);
    return {
      teamId: null,
      warning: only
        ? `Everyone on this task is in ${only.name} — as a studio-wide task it won't appear under ${only.name}.`
        : null,
    };
  }

  /*
   * Nothing chosen: derive it. One team across everyone → that team; more than
   * one → don't guess, ask. This is the "select a person from Team 1 and the
   * Team field fills itself in" half of the brief.
   */
  if (!current) {
    if (all.size === 1) return { teamId: [...all][0], warning: null };
    if (all.size === 0) return { teamId: null, warning: null };
    return {
      teamId: null,
      warning: `These people are in different teams (${names(
        teams.filter((t) => all.has(t.id)),
      )}). Pick a team, or leave it studio-wide so everyone can see it.`,
    };
  }

  /*
   * Something chosen: honour it — the admin may be deliberately filing a
   * cross-team job here — but never silently. The warning is the "if I pick a
   * person from Team 1 and then force Team 2, tell me" half.
   */
  const team = teams.find((t) => t.id === current) ?? null;
  const label = team?.name ?? "that team";
  const outside = people.filter((id) => !teamsForUser(teams, id).some((t) => t.id === current));
  if (!outside.length) return { teamId: current, warning: null };

  const who =
    outside.length === 1
      ? "One person you picked is"
      : outside.length === people.length
        ? people.length === 1
          ? "The person you picked is"
          : "None of the people you picked are"
        : `${outside.length} of the people you picked are`;
  return {
    teamId: current,
    warning: `${who} not in ${label}, so this task will only appear under ${label}.`,
  };
}
