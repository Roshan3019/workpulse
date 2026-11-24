/**
 * Date-window regression test.
 *
 * The reported bug: the availability week was anchored to the *server's* clock
 * (UTC on Vercel), so for a user in India the window could stay on yesterday
 * for the first 5.5 hours of their day — and never rolled over in a tab left
 * open overnight.
 *
 *   npm run test:dates
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
  ok ? pass++ : fail++;
}

/* --------------------------------------------------------------------------
   Pull the pure helpers out of src/lib/dates.ts and run them for real.
   (No TS runtime in CI, so strip the types with the TS compiler API.)
   -------------------------------------------------------------------------- */
function loadDatesModule() {
  const ts = require("typescript");
  const fs = require("fs");
  const src = fs.readFileSync(path.join(ROOT, "src/lib/dates.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const module_ = { exports: {} };
  new Function("exports", "module", "require", out)(module_.exports, module_, require);
  return module_.exports;
}

(async () => {
  const d = loadDatesModule();
  const { todayISOIn, nextDatesIn, nextDates, todayISO, addDays, TZ_COOKIE, hourLabel } = d;

  console.log("date helpers loaded:", typeof todayISOIn === "function");
  check("module exports the helpers we need", typeof nextDatesIn === "function" && Boolean(TZ_COOKIE));

  /* ---------- 1. timezone: "today" is the user's, not UTC's ---------- */
  // 2026-11-22T20:30Z is already Nov 23 in India (UTC+5:30) but still Nov 22 in UTC.
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 10, 22, 20, 30, 0);
  // Pin the clock the helpers read.
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(Date.now());
      else super(...args);
    }
    static now() {
      return Date.UTC(2026, 10, 22, 20, 30, 0);
    }
  };

  const utcToday = todayISO();
  const indiaToday = todayISOIn("Asia/Kolkata");
  const laToday = todayISOIn("America/Los_Angeles");

  check("server (UTC) still says Nov 22", utcToday === "2026-11-22", utcToday);
  check(
    "user in India already sees Nov 23 (the reported bug)",
    indiaToday === "2026-11-23",
    `${indiaToday} (would have been ${utcToday})`,
  );
  check("user in Los Angeles still sees Nov 22", laToday === "2026-11-22", laToday);

  /* ---------- 2. the 7-day window follows the user's today ---------- */
  const indiaWeek = nextDatesIn(7, "Asia/Kolkata");
  check("Indian user's week starts on Nov 23", indiaWeek[0] === "2026-11-23", indiaWeek[0]);
  check("window is exactly 7 consecutive days", indiaWeek.length === 7 && indiaWeek[6] === "2026-11-29", indiaWeek.join(","));
  check("no gaps or duplicates", new Set(indiaWeek).size === 7 && indiaWeek.every((x, i) => i === 0 || x === addDays(indiaWeek[i - 1], 1)));

  const utcWeek = nextDatesIn(7, null);
  check("unknown timezone falls back to the server clock", utcWeek[0] === "2026-11-23" || utcWeek[0] === "2026-11-22", utcWeek[0]);

  /* ---------- 3. an invalid timezone never crashes a page ---------- */
  const bad = todayISOIn("Not/AZone");
  check("invalid timezone falls back instead of throwing", /^\d{4}-\d{2}-\d{2}$/.test(bad), bad);

  /* ---------- 4. the window really moves when the date moves ---------- */
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(Date.UTC(2026, 10, 29, 9, 0, 0));
      else super(...args);
    }
    static now() {
      return Date.UTC(2026, 10, 29, 9, 0, 0);
    }
  };
  const nextWeekWindow = nextDatesIn(7, "Asia/Kolkata");
  check(
    "a week later the window has moved on (Nov 29 → Dec 5)",
    nextWeekWindow[0] === "2026-11-29" && nextWeekWindow[6] === "2026-12-05",
    `${nextWeekWindow[0]} → ${nextWeekWindow[6]}`,
  );
  check("month boundary handled", nextWeekWindow.includes("2026-12-01"), nextWeekWindow.join(","));

  /* ---------- 5. year boundary ---------- */
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(Date.UTC(2026, 11, 30, 12, 0, 0));
      else super(...args);
    }
    static now() {
      return Date.UTC(2026, 11, 30, 12, 0, 0);
    }
  };
  const newYear = nextDates(7, todayISOIn("UTC"));
  check("spans New Year correctly", newYear[0] === "2026-12-30" && newYear.includes("2027-01-01"), newYear.join(","));

  global.Date = RealDate;
  Date.now = realNow;

  /* ---------- 6. pages actually use the tz-aware window ---------- */
  const pages = [
    "src/app/app/availability/page.tsx",
    "src/app/app/page.tsx",
    "src/app/app/my-tasks/page.tsx",
    "src/app/app/team/page.tsx",
  ];
  const fs = require("fs");
  const offenders = pages.filter((p) => {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    return /nextDates\(/.test(src) || !/nextDatesIn\(/.test(src);
  });
  check("every date-window page uses nextDatesIn()", offenders.length === 0, offenders.join(", ") || "all good");

  const availSrc = fs.readFileSync(path.join(ROOT, "src/app/app/availability/page.tsx"), "utf8");
  check("availability page is force-dynamic (never cached across days)", /dynamic\s*=\s*"force-dynamic"/.test(availSrc));

  const layoutSrc = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  check("TimeZoneSync is mounted globally", layoutSrc.includes("<TimeZoneSync />"));

  const tzSrc = fs.readFileSync(path.join(ROOT, "src/components/system/TimeZoneSync.tsx"), "utf8");
  check("TimeZoneSync writes the wp_tz cookie", tzSrc.includes("document.cookie") && tzSrc.includes("TZ_COOKIE"));
  check("TimeZoneSync refreshes on day rollover", /router\.refresh\(\)/.test(tzSrc) && /setInterval/.test(tzSrc));

  /* ------------------------------------------------------------------ */
  /* Hour labels                                                         */
  /* ------------------------------------------------------------------ */
  /*
   * End hours are printed as `hour + 1`, so 23 becomes 24. That used to come out
   * as "12p" (24 - 12), which made an 8a–7p block read "8a–12p" and a 10–11pm
   * slot read "10p–12p". Midnight has to wrap to 12a.
   */
  const labels = typeof hourLabel === "function"
    ? [0, 8, 11, 12, 13, 23, 24].map((h) => hourLabel(h))
    : null;
  check(
    "hour labels wrap at midnight instead of reading 12p for 24",
    labels === null || labels.join(",") === "12a,8a,11a,12p,1p,11p,12a",
    labels ? labels.join(",") : "hourLabel not exported",
  );

  /*
   * The whole app must agree on one working window — and it must be ONE
   * definition, not four copies that drift. They drifted once: the team grid
   * ended at 8p while the calendar ended at 7p, so a block ending at 7pm had no
   * cell to end in.
   */
  const fsx = require("fs");
  const gridSrc = fsx.readFileSync(path.join(ROOT, "src/components/availability/AvailabilityGrid.tsx"), "utf8");
  const slotSrc = fsx.readFileSync(path.join(ROOT, "src/components/dashboard/TeamSlotGrid.tsx"), "utf8");
  const weekSrc = fsx.readFileSync(path.join(ROOT, "src/components/availability/WeeklyDefaultEditor.tsx"), "utf8");
  const windowSrc = fsx.readFileSync(path.join(ROOT, "src/lib/availability.ts"), "utf8");
  const planSrc = fsx.readFileSync(path.join(ROOT, "src/lib/plans.ts"), "utf8");

  check(
    "the working window is defined exactly once",
    /export const WORK_FIRST_HOUR = 8;/.test(windowSrc) && /export const WORK_LAST_HOUR = 19;/.test(windowSrc),
  );
  check(
    "all three grids import that window instead of retyping it",
    [gridSrc, slotSrc, weekSrc].every((src) => src.includes("WORK_HOURS") || src.includes("WORK_FIRST_HOUR")) &&
      [gridSrc, slotSrc, weekSrc].every(
        (src) => !/const (?:DAY_START|FIRST_HOUR|LAST_HOUR|DAY_END)\s*=\s*\d/.test(src) || /FIRST_HOUR = WORK_FIRST_HOUR/.test(src),
      ),
    [gridSrc, slotSrc, weekSrc]
      .map((src) => (/const (?:DAY_START|FIRST_HOUR|LAST_HOUR|DAY_END)\s*=\s*[^;]+;/.exec(src) ?? ["none"])[0])
      .join(" / "),
  );
  check(
    "the plan window is the same window",
    /export \{[^}]*WORK_HOURS as PLAN_HOURS/.test(planSrc),
    "plans.ts re-exports WORK_HOURS",
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
