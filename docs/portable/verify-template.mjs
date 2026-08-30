/**
 * Simulative verification: the checks no unit test can reach.
 *
 * Copy to `scripts/verify.mjs`, add `"verify": "tsx scripts/verify.mjs"` to
 * package.json, delete the three example checks, and write one real one.
 *
 * ---
 *
 * **What belongs here and what does not.**
 *
 * If a unit test can check it, a unit test should. This script is for the
 * three kinds of claim that a unit test structurally cannot make:
 *
 *  1. **Whole-system properties.** "No card ever reaches the wrong client",
 *     "the decoration never overlaps the game", "the adaptive loop settles
 *     rather than oscillating". These cross module boundaries, so no single
 *     module's test owns them.
 *  2. **Structural facts about the source.** "This guard is in the one place
 *     it has to be", "only these files may name this identifier". These have
 *     no runtime representation at all, so nothing executable can assert them.
 *  3. **Facts on disk.** "Every shipped asset is credited", "every font the
 *     stylesheet asks for exists". Both directions, always: a file with no
 *     reference and a reference with no file are different bugs.
 *
 * **Two kinds of script, and it is worth deciding which you are writing.**
 *
 *  - *Against a running stack.* Real clients against the real server. Catches
 *    wire-level and protocol bugs that nothing else can. Slower, needs setup,
 *    gets run before merging.
 *  - *Pure replay, nothing running.* Imports the real modules and drives them
 *    with synthetic input. Instant, no setup, so it is the one people actually
 *    run. Anything that can go here should.
 *
 * This template is the second kind.
 *
 * **Why a script rather than more tests.** It is allowed to do things a unit
 * test should not: read the tree, `git grep`, count occurrences in a source
 * file, assert that a number appears in a document. That freedom is the point.
 *
 *   npm run verify
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Import your REAL modules here, not copies. A check that runs against a
// reimplementation is a check that passes while the product is broken.
//
// import { classify } from "../src/thing.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

// ------------------------------------------------------------- harness

const results = [];

/**
 * One assertion.
 *
 * `detail` is printed on both pass and fail, and it is worth supplying
 * whenever the *value* is interesting and not only the verdict: "22mm of
 * margin at the worst case" tells you how close you are to the cliff, which a
 * bare "ok" does not. A check that has been silently passing with 0.1mm of
 * margin for six months is a check that is about to start failing.
 */
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${name}${detail ? ` - ${detail}` : ""}`,
  );
};

const section = (title) =>
  console.log(`\n${title}\n${"-".repeat(title.length)}`);

// =========================================================== EXAMPLES
// Delete everything between here and the result block.

section("Example 1: replay a pure module with synthetic input");

/**
 * The shape: take a module that reacts to the world, and hand it a world.
 *
 * This is how a throttled GPU, a hostile client, a vanished device or a full
 * disk get tested without any of them existing. It works exactly to the extent
 * that the module takes numbers rather than objects - which is the argument
 * for writing it that way in the first place.
 *
 * Assert the *property*, not the trace. "It settles rather than oscillating"
 * survives retuning the thresholds; "after 47 frames it is on tier 2" does
 * not, and a test that has to be updated whenever the code changes is a test
 * that will be updated without being read.
 */
// const monitor = feed(newMonitor("high"), { frameMs: 30, forMs: 4000 });
// check(
//   "a machine that cannot keep up ends up on the floor",
//   monitor.tier === "low",
//   `after ${monitor.steps} steps`,
// );
check("(replace with a real replay check)", true);

section("Example 2: assert a structural fact about the source");

/**
 * The shape: a guard that must be in exactly one place, or a pattern that must
 * not appear.
 *
 * Use this where being *correct* is not enough and being *positioned* matters.
 * A rate-limit check inside a handler still returns the right answer; it has
 * simply already paid for the frame it is refusing. Nothing executable can
 * tell those apart, and the compiler will not either.
 *
 * Count rather than match. `!source.includes("bad")` also passes when the
 * whole file has been deleted, which is the edit most likely to reintroduce
 * the bug.
 */
// const source = read("src", "server", "Room.ts");
// const raw = [...source.matchAll(/this\.onMessage[<(]/g)].length;
// check(
//   "every message goes through the budget, not around it",
//   raw === 1,
//   `${raw} raw handler(s); exactly one is expected, inside onIntent`,
// );
check("(replace with a real structural check)", true);

section("Example 3: enumerate a closed set");

/**
 * The shape: "only these files may do X."
 *
 * A grep somebody ran once is not a guarantee. Enumerate and diff against an
 * allowlist, so a *new* offender fails rather than going unnoticed. The bug
 * this catches is a fifth file appearing - a debug payload, a log line, a
 * convenience getter - none of which would fail any other test in the repo.
 *
 * Scope it honestly and say why in a comment. A check that fails for
 * legitimate reasons gets deleted, and then it protects nothing.
 */
// const ALLOWED = new Set(["src/state/mirror.ts", "src/state/view.ts"]);
// const offenders = execSync('git grep -l "secretField" -- src', {
//   cwd: root,
//   encoding: "utf8",
// })
//   .split(/\r?\n/)
//   .map((l) => l.trim())
//   .filter((l) => l.length > 0 && !l.endsWith(".test.ts"))
//   .filter((f) => !ALLOWED.has(f));
// check(
//   "only the files that own the secret may name it",
//   offenders.length === 0,
//   offenders.join(", "),
// );
check("(replace with a real closed-set check)", true);

// ======================================================== END EXAMPLES

// -------------------------------------------------------------- result

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
process.exit(failed.length === 0 ? 0 : 1);
