---
description: Show status of the current plan.md phase and what to do next
argument-hint: "[phase number]"
---

Read `plan.md` and report on phase $1 (or, if no number was given, whichever phase is currently in progress).

1. List that phase's exit criteria from `plan.md`.
2. Inspect the codebase and determine, criterion by criterion, which are actually met - verify by reading code and running the relevant checks, not by assuming.
3. Report a short table: criterion / met or not / evidence.
4. Name the single next task to work on, and why it is next.

Be strict about "done". A criterion is met only if it demonstrably works, not if the code merely exists.
