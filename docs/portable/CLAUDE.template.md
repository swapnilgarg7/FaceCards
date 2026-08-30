# <Project name>

<One or two sentences: what this is, and what the product actually is. Name the
thing that would still matter if every feature were removed. For FaceCards that
is "the feeling of sitting at a table with friends, not the poker".>

Source of truth for requirements: `<spec file>`. Build order: `plan.md`.

## Product principle

<The single sentence that settles a tie. Every ambiguous tradeoff gets decided
by it, so it has to be specific enough to actually rule things out. Vague
values like "quality" or "user focus" decide nothing.>

## Hard rules

<Two or three things that are never traded away. These are the rules a
reasonable-looking change would otherwise break. Write each as a claim that can
be checked, and say what the consequence of breaking it is.>

**<Rule 1.>** <Why. What counts as a violation. Where it is enforced.>

**<Rule 2.>** <Same.>

<FaceCards examples, delete these:
 - The server is authoritative. Clients send intents, never outcomes.
 - Hole cards are private server state. Not "the client doesn't render them",
   genuinely absent from that client's payload.
 - All assets must be free for commercial use, with a credits row added at the
   time the asset is added.>

## Stack

- <Language, framework, key libraries, with versions if they are load-bearing>
- <Where things run: browser, node, target platforms>

## Conventions

<Only conventions with a reason. A formatter handles style; this is for the
load-bearing ones. Each line should answer "what would go wrong otherwise".>

- **Decisions are pure, wiring is thin.** Anything with arithmetic, a
  classification, or a rule lives in a module with no I/O imports and has a unit
  test. Hooks, components and SDK wrappers hold no decisions and have no tests.
  See `docs/ENGINEERING-STYLE.md`.
- **Two fields that must agree are one field and a function.** Derive
  invariants rather than storing them.
- **Never offer an action that cannot succeed.** Failures classify to a
  recovery verb; the UI renders the verb and decides nothing.
- **Comments explain why, never what.** Every non-obvious constant carries the
  argument that chose it.
- <Where the domain rules live, and what may not import what.>
- <Any performance constraint that shapes the design rather than being cleanup.>

## Verify before saying done

- `npm run typecheck` and `npm test` pass.
- `npm run verify` passes.
- <Any area-specific check: run agent X after touching Y.>

A criterion is met only if it demonstrably works, not if the code merely
exists. Report what actually happened, including what was skipped.

## Documents that are kept up to date

- `plan.md` - build order, and a **"What the build corrected"** section per
  phase recording where the plan was wrong and what that taught. Written at the
  end of each phase, not later.
- `defects.md` - known issues with file and line, why each is not fixed yet,
  and what the fix would be. Fixed entries are kept, with the shape of the fix.
  There is also a "not defects, recorded so they are not re-litigated" section.
- `docs/ENGINEERING-STYLE.md` - how this codebase is written and why.
