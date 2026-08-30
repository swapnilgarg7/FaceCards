# Porting this way of working to another repo

Short answer to "which file do I add?":

> **`CLAUDE.md`, at the root of the new repo.** That is the only file Claude
> Code loads automatically into every session, so it is the only place that
> changes behaviour without anyone remembering to ask.

Everything else here is optional and additive.

---

## The 5-minute version

```
cp docs/portable/CLAUDE.template.md   <new-repo>/CLAUDE.md
cp docs/ENGINEERING-STYLE.md          <new-repo>/docs/ENGINEERING-STYLE.md
cp docs/portable/verify-template.mjs  <new-repo>/scripts/verify.mjs
```

Then:

1. Fill in the `<>` placeholders at the top of the new `CLAUDE.md`. The
   hard-rules section is the part that matters; delete the poker-specific
   examples and write your own project's two or three non-negotiables.
2. Add `"verify": "tsx scripts/verify.mjs"` to `package.json` scripts.
3. Delete the example checks in `verify.mjs` and write one real one.

That is enough. The rest of this file is what each piece is for and when it
earns its keep.

---

## What each file does

### `CLAUDE.template.md` → `<new-repo>/CLAUDE.md`

The always-loaded context. Claude Code reads the root `CLAUDE.md` at the start
of every session, so anything in it applies without being asked for.

Keep it **short**. It competes for attention with the actual task, and a
CLAUDE.md that lists forty preferences gets skimmed like a licence agreement.
The template is about 60 lines and that is close to the ceiling. Rules that need
a paragraph of justification go in `docs/ENGINEERING-STYLE.md` and get one line
here pointing at them.

The three things worth having in it, in order of value:

1. **The hard rules.** The two or three things that are never traded away. In
   FaceCards: the server is authoritative, hole cards are private, assets must
   be free for commercial use. These are the ones that would otherwise be
   violated by a reasonable-looking change.
2. **The verify command.** "Before saying done, run X." Without this the model
   will report success on a typecheck.
3. **Conventions with a reason attached.** Not style preferences (a formatter
   handles those) but the load-bearing ones: where rules live, what may not
   import what.

### `ENGINEERING-STYLE.md` → `<new-repo>/docs/`

The reasoning. Copy it as-is; it is written to be project-agnostic, and its
examples are named so you can tell which are FaceCards-specific.

Worth reading before deleting anything from it. The sections that transfer best
to any project are §1 (pure core plus simulations), §2 (recoverable failure),
§4 (closed sets) and §5 (comments explain why). §3 matters only if you have a
control loop; §6 only if you have a server; §7 only if you have a deploy.

### `verify-template.mjs` → `<new-repo>/scripts/`

A skeleton for the simulative check. This is the piece hardest to recreate from
memory and the one that pays off most, because it is where the whole-system
properties live: the ones no unit test can reach.

The template has the harness (sections, pass/fail, exit code) and three worked
example checks showing the three shapes that actually recur:

- **replay a pure module with synthetic inputs** (simulate a slow machine, a
  hostile client, a device that vanished)
- **assert a structural fact about a source file** (this guard is in the one
  place it has to be)
- **enumerate a closed set with `git grep`** (only these files may do X)

Delete the examples once you have one real check.

---

## What to do first in a new project

Do not try to adopt all of it at once. In order of payoff:

**1. Write the hard rules.** Ten minutes, and it is most of the value. If you
cannot name two things that must never be traded away, that is worth knowing
before writing code.

**2. Split one decision out of one shell.** Find the file you are most nervous
about, pull the arithmetic or the classification into a module with no imports
from your framework, and give it a test. That single act tends to reveal what
else wants moving.

**3. Add the verify script when you first say "I hope that still works".** That
sentence is the signal. It means there is a property you believe in and cannot
check, which is exactly what the script is for.

**4. Start `defects.md` at the first bug you decide not to fix yet.** Write what
it is, the file and line, why it is not fixed, and what the fix would be. Keep
entries after they are fixed, with the shape of the fix.

**5. Start "What the build corrected" at the first time a plan was wrong.**
One bullet: what was planned, what was true instead, what that implies. This is
the highest-value writing in this repo and it costs a paragraph.

---

## The optional extras

FaceCards also has `.claude/` with sub-agents and slash commands. Both are
genuinely useful, and both are worth adding *late*, once you know what you keep
repeating.

**`.claude/agents/*.md`** are specialised reviewers, spawned on demand:
`poker-auditor` for the rules engine, `netcode-security` for protocol changes,
`scene-perf` for the renderer. The pattern that makes them work is that each one
owns a **narrow, high-stakes area with a checklist**, so it can be strict. A
general "code reviewer" agent is worth much less.

**`.claude/commands/*.md`** are slash commands: repeatable prompts. `/phase`
reports on the current plan phase and is strict about what "done" means;
`/asset-check` audits licences. Good candidates are anything you have typed
twice.

**`.claude/settings.json`** carries a permission allowlist so routine read-only
commands stop prompting. Copy the shape rather than the contents: the FaceCards
list allows `npm run`, `npx tsc`, `git status|diff|log`, and the read-only shell
tools, and denies `git push`, `npm publish`, `rm -rf` and reading `.env`.

---

## Anti-patterns worth naming

Things that look like this method and are not:

- **A coverage threshold.** It pushes tests towards the wiring, which is exactly
  backwards. The goal is every decision tested and none of the plumbing, and a
  percentage cannot tell those apart.
- **A CLAUDE.md that is a style guide.** Formatting belongs to a formatter.
  Spending the always-loaded context on brace placement wastes it.
- **Tests that assert what the code says.** If the test is a transcription of
  the implementation it will never fail for a useful reason. Assert the
  *property*: "the pots sum to the contributions", "no tier turns a face off",
  "a Retry appears only where retrying works".
- **A verify script that duplicates the unit tests.** If a unit test can check
  it, it should. The script is for what crosses module boundaries or lives on
  disk.
