/**
 * Names in a list.
 *
 * The bug: the team grid showed two rows reading "Roshan Patel" and the client
 * read it as a duplicate row, not as two people who happen to share a name. The
 * live studio now has three of them, so this is not a demo-only case.
 *
 *   npm run test:format
 */
const path = require("path");

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
  const fs = require("fs");
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const module_ = { exports: {} };
  new Function("exports", "module", "require", out)(module_.exports, module_, require);
  return module_.exports;
}


const { distinctNames, firstName } = loadTs("src/lib/format.ts");

const person = (userId, fullName, email) => ({ userId, profile: { fullName, email } });

const team = [
  person("u1", "Roshan Patel", "patelroshu1218@gmail.com"),
  person("u2", "Roshan Patel", "roshanpatel193052005@gmail.com"),
  person("u3", "Aarav Shah", "aarav@studio.test"),
];

const names = distinctNames(team);

check(
  "a unique name stays exactly as it is",
  names.get("u3").name === "Aarav Shah" && names.get("u3").hint === undefined,
  JSON.stringify(names.get("u3")),
);
check(
  "namesakes are all flagged, not just the second one",
  names.get("u1").hint === "patelroshu1218" && names.get("u2").hint === "roshanpatel193052005",
  `${names.get("u1").hint} / ${names.get("u2").hint}`,
);
check(
  "the name itself is never rewritten",
  names.get("u1").name === "Roshan Patel" && names.get("u2").name === "Roshan Patel",
);
check(
  "a nameless profile falls back to the email, so it is never blank",
  distinctNames([person("u4", null, "new@studio.test")]).get("u4").name === "new@studio.test",
);
check(
  "whitespace-only names count as nameless too",
  distinctNames([person("u5", "   ", "blank@studio.test")]).get("u5").name === "blank@studio.test",
);
check(
  "an email without a local part does not produce an empty hint",
  distinctNames([person("u6", "Same", "@odd.test"), person("u7", "Same", "ok@odd.test")]).get("u6").hint.length > 0,
);
check("single-word names keep their initial", firstName("Roshan", "r@x.test") === "Roshan");
check("two-word names take the surname initial", firstName("Roshan Patel", "r@x.test") === "Roshan P.");
check("a missing name uses the email's local part", firstName(null, "aarav@studio.test") === "aarav");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
