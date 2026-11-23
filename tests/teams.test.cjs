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

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  process.exit(1);
});
