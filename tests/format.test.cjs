/**
 * Names in the app.
 *
 * Two rules the client asked for, in order:
 *   1. no member email on the dashboard — names only;
 *   2. and still no blank name: a profile with no name reads "Unnamed".
 *
 * The earlier "add the email handle when two people share a name" experiment is
 * gone on purpose: three people in the live studio are called "Roshan Patel", and
 * the handle made every row noisy to fix one ambiguity. Names are plain.
 *
 *   npm run test:format
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

/* Strip the types with the TS compiler API — no TS runtime in CI. */
function loadTs(file) {
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  new Function("exports", "module", "require", out)(module_.exports, module_, require);
  return module_.exports;
}

const { displayName, firstName } = loadTs("src/lib/format.ts");

check("a name is printed as written", displayName("Roshan Patel") === "Roshan Patel");
check("surrounding spaces are trimmed", displayName("  Neha Verma  ") === "Neha Verma");
check("no name reads Unnamed, never an email", displayName(null) === "Unnamed" && displayName("") === "Unnamed");
check("a whitespace-only name is no name", displayName("   ") === "Unnamed");
check("single-word names keep their initial form", firstName("Roshan") === "Roshan");
check("two-word names take the surname initial", firstName("Roshan Patel") === "Roshan P.");
check("a missing name is Unnamed here too", firstName(null) === "Unnamed");

/* --------------------------------------------------------------------------
   The dashboard must not print a member's email anywhere.
   -------------------------------------------------------------------------- */
const dashboardFiles = [
  "src/components/dashboard/WorkloadList.tsx",
  "src/components/dashboard/OverallSlots.tsx",
  "src/components/dashboard/TeamSlotGrid.tsx",
  "src/components/availability/MemberPicker.tsx",
  "src/components/tasks/MemberTaskCard.tsx",
  "src/components/tasks/TaskPlanDialog.tsx",
];
const offenders = dashboardFiles.filter((file) => {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  /* An email rendered as text, or used as a name fallback. */
  return /profile\.email\}\s*<|\?\?\s*[a-z.]*profile\.email|profile\.email\s*\?\?/.test(src);
});
check("no dashboard screen prints or falls back to an email", offenders.length === 0, offenders.join(", ") || "all clean");

/* The roster is the exception, and it must say so out loud. */
const roster = fs.readFileSync(path.join(ROOT, "src/components/team/TeamGrid.tsx"), "utf8");
check(
  "the People roster still shows the email, with a comment saying why",
  roster.includes("profile.email") && /one screen that keeps the email/i.test(roster),
);

/* A name is never built from an email address in the shared helper. */
const helper = fs.readFileSync(path.join(ROOT, "src/lib/format.ts"), "utf8");
check(
  "displayName() has no email fallback",
  !/split\("@"\)/.test(helper.slice(helper.indexOf("export function displayName"), helper.indexOf("export function firstName"))),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
