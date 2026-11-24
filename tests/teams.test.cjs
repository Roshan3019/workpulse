/**
 * Round-5 behaviour test: teams + tri-state availability.
 *
 * Covers the pure logic the new screens depend on — the state conversions,
 * the counting that drives the admin overview and the dashboard totals, and
 * the memory store's team CRUD + tri-state round trip. The memory store is the
 * reference implementation for the Supabase one, so contract bugs show up here
 * first (team slug uniqueness, ON DELETE SET NULL on tasks, role rules).
 *
 *   npm run test:teams
 */
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
}

/* --------------------------------------------------------------------------
   Load real TypeScript modules with the compiler API (no TS runtime in CI).
   Relative imports are resolved and transpiled on demand.
   -------------------------------------------------------------------------- */
const ts = require("typescript");
const cache = new Map();

function loadTs(relPath) {
  const abs = path.join(ROOT, relPath);
  if (cache.has(abs)) return cache.get(abs);

  const src = fs.readFileSync(abs, "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const module_ = { exports: {} };
  cache.set(abs, module_.exports);

  const localRequire = (spec) => {
    if (spec.startsWith(".")) {
      const target = path.resolve(path.dirname(abs), spec.replace(/\.ts$/, ""));
      const candidates = [`${target}.ts`, path.join(target, "index.ts")];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return loadTs(path.relative(ROOT, candidate));
      }
    }
    return require(spec);
  };

  new Function("exports", "module", "require", out)(module_.exports, module_, localRequire);
  return module_.exports;
}

/* Fake the server-only guard the data layer imports. */
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.apply(this, arguments);
};

const A = loadTs("src/lib/availability.ts");
const { MemoryStore } = loadTs("src/lib/data/memory.ts");
const { DEMO_ORG_ID, DEMO_USERS } = loadTs("src/lib/data/types.ts");

const TEAM_WEB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TEAM_BRANDING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const AARAV = "44444444-4444-4444-8444-444444444444";
const PRIYA = "55555555-5555-4555-8555-555555555555";
const NEHA = "77777777-7777-4777-8777-777777777777";
const KABIR = "88888888-8888-4888-8888-888888888888";
const OWNER = "11111111-1111-4111-8111-111111111111";

(async () => {
  /* ------------------------- state conversions ------------------------- */
  const fromHours = A.statesFromHours([9, 10, 11]);
  check(
    "legacy hours become free hours",
    fromHours[9] === "free" && fromHours[11] === "free" && Object.keys(fromHours).length === 3,
  );
  check("hoursFromStates keeps only free hours, sorted", String(A.hoursFromStates({ 12: "free", 9: "free", 10: "busy" })) === "9,12");
  check("hoursFromStates of empty day is empty", A.hoursFromStates({}).length === 0);
  check("missing hour reads as unassigned", A.cellState({ 9: "free" }, 10) === "unassigned");
  check("a busy hour is not free", A.cellState({ 9: "busy" }, 9) === "busy");

  const flipped = A.setCell({ 9: "free" }, 9, "free");
  check("setting the state a cell already has clears it", A.cellState(flipped, 9) === "unassigned");
  const painted = A.setCell({}, 14, "busy");
  check("a fresh cell can be painted busy", A.cellState(painted, 14) === "busy");

  const range = A.setRange({}, [9, 10, 11], "free");
  check("setRange paints a contiguous block", Object.values(range).filter((v) => v === "free").length === 3);

  const counts = A.countStates({ 9: "free", 10: "free", 11: "busy" });
  check("countStates splits free / busy / unassigned", counts.free === 2 && counts.busy === 1 && counts.unassigned === 21, JSON.stringify(counts));

  const across = A.countStatesAcross([{ 9: "free" }, { 9: "busy", 10: "busy" }]);
  check("countStatesAcross sums days", across.free === 1 && across.busy === 2, JSON.stringify(across));

  const legacy = A.statesFromLegacyMap({ "2026-01-05": [9, 10], "2026-01-06": [] });
  check("legacy map migrates hour-by-hour and drops empty days", legacy["2026-01-05"][9] === "free" && !legacy["2026-01-06"]);

  /* ------------------------------- store ------------------------------- */
  const store = new MemoryStore();

  const seeded = await store.listTeams(DEMO_ORG_ID);
  check("demo studio ships with two teams", seeded.length === 2, seeded.map((t) => t.name).join(", "));
  check("seeded slugs are URL-safe", seeded.every((t) => /^[a-z0-9-]+$/.test(t.slug)));

  const web = seeded.find((t) => t.id === TEAM_WEB);
  check("the Web team holds its seeded people", web.memberIds.includes(AARAV) && web.memberIds.includes(NEHA));

  const allTasks = await store.listTasks(DEMO_ORG_ID);
  const webTasks = await store.listTasks(DEMO_ORG_ID, { teamId: TEAM_WEB });
  check(
    "team filter returns only that team's tasks",
    webTasks.length > 0 && webTasks.every((t) => t.teamId === TEAM_WEB),
    `${webTasks.length}/${allTasks.length}`,
  );
  check("studio-wide tasks are excluded from a team view", allTasks.some((t) => t.teamId === null));

  const made = await store.createTeam(DEMO_ORG_ID, "Video & Motion", [KABIR, PRIYA]);
  check("creating a team slugifies the name", made.slug === "video-motion", made.slug);
  check("members are stored on the new team", made.memberIds.length === 2);

  const dupe = await store.createTeam(DEMO_ORG_ID, "Video & Motion", []);
  check("a duplicate name gets a distinct slug", dupe.slug !== made.slug, dupe.slug);

  const twice = await store.createTeam(DEMO_ORG_ID, "Video & Motion 2", [KABIR, KABIR]);
  check("the same person cannot be added twice", twice.memberIds.length === 1);

  await store.setTeamMembers(DEMO_ORG_ID, made.id, [PRIYA, NEHA]);
  const reassigned = (await store.listTeams(DEMO_ORG_ID)).find((t) => t.id === made.id);
  check("setTeamMembers replaces the roster", reassigned.memberIds.length === 2 && reassigned.memberIds.includes(NEHA));

  let rejected = false;
  try {
    await store.setTeamMembers(DEMO_ORG_ID, made.id, ["00000000-0000-4000-8000-000000000000"]);
  } catch {
    rejected = true;
  }
  check("someone outside the studio cannot join a team", rejected);

  await store.updateTeam(DEMO_ORG_ID, made.id, { name: "Motion" });
  const renamed = (await store.listTeams(DEMO_ORG_ID)).find((t) => t.id === made.id);
  check("a team can be renamed", renamed.name === "Motion");

  /* Deleting a team must not delete its work — tasks fall back to studio-wide. */
  await store.deleteTeam(DEMO_ORG_ID, TEAM_BRANDING);
  const afterDelete = await store.listTasks(DEMO_ORG_ID);
  const orphaned = afterDelete.filter((t) => t.teamId === TEAM_BRANDING);
  check("deleting a team detaches its tasks instead of deleting them", orphaned.length === 0 && afterDelete.length === allTasks.length);
  check("the detached tasks became studio-wide", afterDelete.some((t) => t.title === "Brand Identity Refresh" && t.teamId === null));

  /* ---------------------------- availability --------------------------- */
  const dates = ["2026-12-01", "2026-12-02"];
  await store.saveAvailabilityStates(DEMO_ORG_ID, AARAV, dates[0], { 9: "free", 10: "busy", 11: "free" });
  const read = await store.getAvailabilityStates(DEMO_ORG_ID, [AARAV], dates);
  check("tri-state availability survives a round trip", A.cellState(read[AARAV][dates[0]], 10) === "busy");

  const legacyMirror = await store.getAvailability(DEMO_ORG_ID, [AARAV], dates);
  check(
    "the legacy hours mirror stays free-only",
    String(legacyMirror[AARAV][dates[0]]) === "9,11",
    String(legacyMirror[AARAV][dates[0]]),
  );

  await store.saveAvailabilityStates(DEMO_ORG_ID, AARAV, dates[1], { 14: "busy" });
  const busyOnly = await store.getAvailabilityStates(DEMO_ORG_ID, [AARAV], dates);
  check("a busy-only day keeps its state", A.cellState(busyOnly[AARAV][dates[1]], 14) === "busy");
  const legacyBusyOnly = await store.getAvailability(DEMO_ORG_ID, [AARAV], dates);
  check("a busy-only day adds nothing to legacy hours", !legacyBusyOnly[AARAV][dates[1]]);

  await store.saveAvailabilityStates(DEMO_ORG_ID, AARAV, dates[0], {});
  const cleared = await store.getAvailabilityStates(DEMO_ORG_ID, [AARAV], dates);
  check("saving an empty day clears it", !cleared[AARAV][dates[0]]);

  let memberBlocked = false;
  try {
    await store.saveAvailabilityStates(DEMO_ORG_ID, OWNER, dates[0], { 9: "free" });
  } catch {
    memberBlocked = true;
  }
  check("admins still cannot set availability", memberBlocked);

  check("both seeded teams map to real demo people", DEMO_USERS.length >= 6 && seeded.every((t) => t.memberIds.length > 0));

  /*
   * The demo seed has to be able to reproduce the join flow: an account with
   * no studio at all, and one that belongs to two.
   */
  {
    const { DEMO_OUTSIDERS } = loadTs("src/lib/data/types.ts");
    const joiner = DEMO_OUTSIDERS[0];
    check("the seed ships an account with no studio", (await store.listOrgsForUser(joiner)).length === 0);

    const twoStudios = DEMO_USERS.find((u) => (u.email ?? "").includes("two.studios"));
    const orgs = twoStudios ? await store.listOrgsForUser(twoStudios.id) : [];
    check("…and one that belongs to two studios", orgs.length === 2, orgs.map((o) => o.name).join(", "));

    // "Newest membership wins" is what stops a sign-in opening the empty
    // studio the account made a day earlier.
    const roster = twoStudios ? await store.listMembershipsForUser(twoStudios.id) : [];
    roster.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    check("…whose newest membership is the main studio", roster[0]?.orgId === DEMO_ORG_ID, String(roster[0]?.orgId));
  }

  /* ------------------------------------------------------------------ */
  /* A task's team follows the people on it (round 10)                    */
  /* ------------------------------------------------------------------ */
  {
    const T = loadTs("src/lib/task-teams.ts");
    // A fresh *database*: MemoryStore shares one globalThis singleton, and
    // earlier blocks here deliberately break the seeded teams.
    loadTs("src/lib/data/memory.ts").resetMemoryDatabase();
    const fresh = new MemoryStore();
    const [web, brand] = await fresh.listTeams(DEMO_ORG_ID);
    const inWeb = web.memberIds[0];      // one person, only in Web
    const inBrand = brand.memberIds[0];  // one person, only in Branding

    const one = T.resolveTaskTeam([web, brand], [inWeb], null);
    check("one person from Team 1 selects Team 1 by itself", one.teamId === web.id && !one.warning, JSON.stringify(one));

    const forced = T.resolveTaskTeam([web, brand], [inWeb], brand.id);
    check("forcing Team 2 with a Team 1 person warns", forced.teamId === brand.id && Boolean(forced.warning));
    check("…and the warning names the team", (forced.warning ?? "").includes(brand.name), String(forced.warning));

    const sameTeam = T.resolveTaskTeam([web, brand], [inWeb, web.memberIds[1]], null);
    check("two people who share a team resolve to it silently", sameTeam.teamId === web.id && !sameTeam.warning);

    const spread = T.resolveTaskTeam([web, brand], [inWeb, inBrand], brand.id);
    check("a cross-team task keeps the chosen team but says who is outside it", spread.teamId === brand.id && /not in/.test(spread.warning ?? ""));

    const undecided = T.resolveTaskTeam([web, brand], [inWeb, inBrand], null);
    check("cross-team with no team chosen asks instead of guessing", undecided.teamId === null && /different teams/.test(undecided.warning ?? ""));

    check("a person on no team leaves the task studio-wide", T.resolveTaskTeam([web, brand], ["aaaaaaaa-1111-4111-8111-111111111111"], null).teamId === null);

    /* The store round trip the dialog relies on. */
    const saved = await fresh.createTask(
      DEMO_ORG_ID,
      {
        title: "Shared task",
        client: "Qween",
        description: null,
        assigneeId: inWeb,
        assigneeIds: [inWeb, web.memberIds[1]],
        estHours: 6,
        progress: 0,
        status: "pending",
        priority: "medium",
        deadline: null,
        startDate: null,
        dueTime: null,
        teamId: T.resolveTaskTeam([web, brand], [inWeb, web.memberIds[1]], null).teamId,
      },
      DEMO_USERS[0].id,
    );
    check("a shared task keeps its team", saved.teamId === web.id, String(saved.teamId));
    check("…and both people are on it", (saved.assigneeIds ?? []).length === 2);

    const mine = await fresh.listTasks(DEMO_ORG_ID, { onlyForUser: web.memberIds[1] });
    check("…so it shows in the second person's own list", mine.some((t) => t.id === saved.id));
    const onTeam = await fresh.listTasks(DEMO_ORG_ID, { teamId: web.id });
    check("…and in the team view", onTeam.some((t) => t.id === saved.id));

    const assignees = loadTs("src/lib/types.ts").assigneesOf;
    check("assigneesOf falls back to the lead for old rows", assignees({ assigneeId: inWeb }).length === 1);
    check("assigneesOf prefers the full list", assignees({ assigneeId: inBrand, assigneeIds: [inWeb, inBrand] }).length === 2);
  }

  /* ------------------------------------------------------------------ */
  /* Free plan seats (round 10)                                          */
  /* ------------------------------------------------------------------ */
  {
    const { PLANS } = loadTs("src/lib/types.ts");
    check("free plan covers 10 seats for now", PLANS.free.seats === 10, String(PLANS.free.seats));
    check("…and its blurb says so", PLANS.free.features[0].includes("10"));
  }


  /* --------------------- weekly default (read-time) -------------------- */
  {
    // Monday 2026-12-07 .. Sunday 2026-12-13
    const week = ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"];
    const tpl = { 1: { 9: "free", 10: "free" }, 4: { 14: "busy" } };

    check("dayOfWeek: 0=Sunday", A.dayOfWeek("2026-12-13") === 0, String(A.dayOfWeek("2026-12-13")));
    check("dayOfWeek: Monday is 1", A.dayOfWeek("2026-12-07") === 1);
    check("dayOfWeek: Thursday is 4", A.dayOfWeek("2026-12-10") === 4);

    const applied = A.applyWeeklyDefault(tpl, week, {});
    check("a template fills every matching weekday", applied.states["2026-12-07"][9] === "free" && applied.states["2026-12-10"][14] === "busy");
    check("days with no template entry stay empty", applied.states["2026-12-08"] === undefined);
    check("applied days are reported", applied.fromDefault.length === 2, applied.fromDefault.join(","));
    check("no template means nothing is filled in", A.applyWeeklyDefault(null, week, {}).fromDefault.length === 0);

    const override = A.applyWeeklyDefault(tpl, week, { "2026-12-07": { 20: "free" } });
    check("an explicit day wins over the template", override.states["2026-12-07"][20] === "free" && override.states["2026-12-07"][9] === undefined);
    check("other days still inherit", override.states["2026-12-10"][14] === "busy");

    const normalised = A.normaliseWeeklyDefault({ "1": { "9": "free", "99": "free", "10": "nope" }, "9": {}, "2": {} });
    check("normalise drops bad hours, bad states and empty days", JSON.stringify(normalised) === '{"1":{"9":"free"}}', JSON.stringify(normalised));
    check("normalise survives garbage", Object.keys(A.normaliseWeeklyDefault("nonsense")).length === 0);
  }

  /* ----------------------- join link + requests ---------------------- */
  {
    const OUTSIDER = "99999999-9999-4999-8999-999999999999";
    const OUTSIDER2 = "99999999-9999-4999-8999-999999999998";
    (await store.getOrg(DEMO_ORG_ID));

    const link = await store.getJoinLink(DEMO_ORG_ID);
    check("a studio has one join link", Boolean(link.token), link.token.slice(0, 8));
    check("the link is stable across reads", (await store.getJoinLink(DEMO_ORG_ID)).token === link.token);
    check("the link resolves publicly", (await store.findJoinLink(link.token))?.orgId === DEMO_ORG_ID);
    check("an unknown token resolves to nothing", (await store.findJoinLink("nope")) === null);

    const before = (await store.listMembers(DEMO_ORG_ID)).length;
    const asked = await store.requestToJoin(link.token, OUTSIDER, "I do motion design");
    check("an outsider can ask to join", asked.alreadyPending === false);
    check("asking adds nobody to the studio", (await store.listMembers(DEMO_ORG_ID)).length === before);

    const inbox = await store.listJoinRequests(DEMO_ORG_ID);
    check("the request lands in the admin inbox", inbox.length === 1);
    check("the inbox shows who asked and why", inbox[0].userId === OUTSIDER && inbox[0].note === "I do motion design");
    check("the requester can see their own pending request", Boolean(await store.getMyJoinRequest(DEMO_ORG_ID, OUTSIDER)));

    /*
     * The requester is not a member, so they cannot see `organizations`. The
     * lookup by user id is what lets onboarding and the join page say "you are
     * waiting on Cinegem Studio" instead of asking them to create a studio.
     */
    const mine = await store.listMyJoinRequests(OUTSIDER);
    check("a requester can list the studios they are waiting on", mine.length === 1, `${mine.length} rows`);
    check("…and it names the studio", mine[0]?.orgName === "Cinegem Studio", String(mine[0]?.orgName));
    check("…without needing to know the org id", mine[0]?.orgId === DEMO_ORG_ID);
    check("someone with no requests gets an empty list", (await store.listMyJoinRequests(OUTSIDER2)).length === 0);

    const twice = await store.requestToJoin(link.token, OUTSIDER);
    check("asking twice keeps one request", twice.alreadyPending === true && (await store.listJoinRequests(DEMO_ORG_ID)).length === 1);

    await store.approveJoinRequest(DEMO_ORG_ID, inbox[0].id);
    const after = await store.listMembers(DEMO_ORG_ID);
    check("approval creates the membership", after.length === before + 1);
    check("they join as a member", after.find((m) => m.userId === OUTSIDER)?.role === "member");
    check("the inbox empties", (await store.listJoinRequests(DEMO_ORG_ID)).length === 0);
    check("their waiting state clears", (await store.getMyJoinRequest(DEMO_ORG_ID, OUTSIDER)) === null);
    check("…and their request list empties too", (await store.listMyJoinRequests(OUTSIDER)).length === 0);

    let blocked = false;
    try { await store.requestToJoin(link.token, OUTSIDER); } catch { blocked = true; }
    check("a member cannot ask again", blocked);

    await store.requestToJoin(link.token, OUTSIDER2);
    const declined = await store.listJoinRequests(DEMO_ORG_ID);
    await store.declineJoinRequest(DEMO_ORG_ID, declined[0].id);
    check("declining admits nobody", (await store.listMembers(DEMO_ORG_ID)).length === before + 1);
    let redecide = false;
    try { await store.approveJoinRequest(DEMO_ORG_ID, declined[0].id); } catch { redecide = true; }
    check("a declined request cannot then be approved", redecide);

    await store.setJoinLinkEnabled(DEMO_ORG_ID, false);
    let paused = false;
    try { await store.requestToJoin(link.token, "99999999-9999-4999-8999-999999999997"); }
    catch (error) { paused = String(error.message).includes("turned off"); }
    check("a paused link refuses requests", paused);
    await store.setJoinLinkEnabled(DEMO_ORG_ID, true);

    const rotated = await store.rotateJoinLink(DEMO_ORG_ID);
    check("rotating mints a new token", rotated.token !== link.token);
    check("the old link stops working", (await store.findJoinLink(link.token)) === null);
    check("the new link works", Boolean(await store.findJoinLink(rotated.token)));
  }

  /* ---------------------------------------------------------------------- */
  console.log("\nRound 6 — team slots, one day at a time");

  {
    /*
     * The dashboard folds each person's usual week into the days they have not
     * dated, then reads one day across all of them. These are the exact
     * primitives TeamSlotGrid is built from.
     */
    const dates = ["2026-11-23", "2026-11-24", "2026-11-25"]; // Mon, Tue, Wed
    const defaults = {
      // Mon–Wed 9–11 free, as a reusable template.
      u1: {
        1: { 9: "free", 10: "free", 11: "free" },
        2: { 9: "free", 10: "free", 11: "free" },
        3: { 9: "free", 10: "free", 11: "free" },
      },
    };
    const stored = {
      // u2 dated Monday only, and marked the afternoon busy.
      u2: { "2026-11-23": { 14: "busy", 15: "busy" } },
    };

    const folded = A.foldWeeklyDefaults(defaults, ["u1", "u2"], dates, stored);
    check("template fills undated weekdays", folded.u1["2026-11-23"]?.[9] === "free");
    check("dated rows survive the fold", folded.u2["2026-11-23"]?.[14] === "busy");
    check("a user with no template, no row stays empty", Object.keys(folded.u2["2026-11-25"] ?? {}).length === 0);

    // The grid's per-cell read: free / busy / unassigned.
    check("cellState reads free", A.cellState(folded.u1["2026-11-25"], 10) === "free");
    check("cellState reads busy", A.cellState(folded.u2["2026-11-23"], 14) === "busy");
    check("a missing hour is unassigned", A.cellState(folded.u2["2026-11-23"], 3) === "unassigned");
    check(
      "dayStates tolerates a missing map",
      Object.keys(A.dayStates(undefined, "2026-11-23")).length === 0,
    );

    const monday = ["u1", "u2"].filter((u) => A.cellState(folded[u]["2026-11-23"], 9) === "free").length;
    check("two people free at 9a on Monday", monday === 1, `got ${monday}`);

    // The store contract the dashboard now depends on.
    const store = new MemoryStore();
    const fresh = await store.listWeeklyDefaults(DEMO_ORG_ID, DEMO_USERS.map((u) => u.id));
    check("listWeeklyDefaults returns an object", typeof fresh === "object" && fresh !== null);
    check("no template yet means an empty map", Object.keys(fresh).length === 0);

    await store.setWeeklyDefault(DEMO_ORG_ID, "33333333-3333-4333-8333-333333333333", {
      1: { 9: "free", 10: "free" },
    });
    const after = await store.listWeeklyDefaults(DEMO_ORG_ID, [
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    check("one template comes back keyed by user", after["33333333-3333-4333-8333-333333333333"]?.[1]?.[9] === "free");
    check("people without a template are omitted", !after["44444444-4444-4444-8444-444444444444"]);
    const single = await store.getWeeklyDefault(DEMO_ORG_ID, "33333333-3333-4333-8333-333333333333");
    check("getWeeklyDefault still agrees", single?.[1]?.[10] === "free");
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  process.exit(1);
});
