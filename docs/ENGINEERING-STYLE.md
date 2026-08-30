# Engineering style

How this codebase is written, and why. Written down because the patterns here
are not obvious, several of them were arrived at by getting the obvious thing
wrong first, and none of them are specific to poker.

**To reuse this in another project, see [`portable/`](portable/).** That folder
has the drop-in files and a checklist. This document is the reasoning behind
them.

---

## 1. Testing: a pure core, and simulations for everything else

The rule is **not** "a test for every file". It is:

> **Everything that decides something is a pure module with a unit test.
> Everything that touches the world is a thin shell with no test, and is
> covered instead by a simulation that replays the real modules.**

The numbers as of phase 6: 51 test files, 715 tests, six `verify:*` scripts. No
React component has a unit test. No SDK wrapper has one. No hook has one.

### Why not test the components too

Because a test that renders a component and clicks a button is mostly a test of
the testing library, and it is the test that breaks when you rename a CSS
class. It costs real maintenance and it catches almost nothing, because the
things that actually go wrong in this product are not "the button did not
render". They are:

- a chip pile that draws 4 chips for a 5-chip bet at one seat count out of eight
- a rail profile whose crown faces the floor because of a winding rule
- a Retry button offered on a failure that retrying cannot fix
- a quality ladder that oscillates between two tiers forever

None of those are reachable by clicking. All of them are pure functions of
numbers, and all of them are one assertion away from being impossible.

### So the work goes into making things pure

This is the actual discipline, and it is upstream of the testing. When
something is hard to test, that is a design signal, not a testing problem. The
usual fix is to pull the decision out of the thing that acts on it:

| Impure shell (no test) | Pure core (tested) |
| --- | --- |
| `useMedia.ts` (hook, SDK, browser) | `faults.ts`, `devices.ts` |
| `useQuality.ts` (hook, WebGL probe) | `quality.ts` |
| `useTabLock.ts` (React binding) | `tabLock.ts` |
| `PokerRoom.ts` (sockets, timers) | `poker/`, `messageLimits.ts` |
| `config.ts` (reads `process.env`) | `tls.ts` |
| `Room3D.tsx` (three.js) | `layout.ts`, `chips.ts`, `cards.ts`, `tableProfile.ts` |

Read one pair to see the shape. `useMedia.ts` is 500 lines of subscriptions and
`useState`, and it contains **no decisions**: every question it faces ("is this
error a denial?", "did a camera just disappear?", "which of these two faults
should I show?") is answered by a call into `faults.ts` or `devices.ts`, both of
which are pure and both of which have exhaustive tests.

The payoff is that the untestable file has nothing in it worth testing.

### The seam is what makes purity possible

Three techniques do almost all the work. Each one turns "I cannot test this
without a browser" into "I pass in a fake":

**Inject the clock.** Never call `Date.now()` inside logic.

```ts
// server/src/rateLimit.ts
constructor(options: { limit: number; windowMs: number; now?: () => number })
```

Every rate-limit test drives time by hand and none of them sleep. The whole
suite runs in under three seconds.

**Inject the transport.** `tabLock.ts` takes a `TabChannel` interface with
three methods, not a `BroadcastChannel`. The test defines a synchronous
in-memory bus and opens as many "tabs" as it likes. The real one is four lines
in `openTabChannel()`.

**Take numbers, not objects.** `quality.ts` does not take a `WebGLRenderer`, it
takes `{ cores?, memoryGb?, handheld?, renderer?, webgl2? }`. Simulating a
2015 laptop is an object literal.

### Simulative tests: the `verify:*` scripts

Unit tests answer "is this function correct". They cannot answer:

- *Did the decoration creep over the game?* (phase 5: replay every card and chip
  anchor, at every seat count, against the rail's inner radius)
- *Can any client ever see another player's card?* (phases 0/2/3: snapshot every
  state frame both clients received and search all of them)
- *Does the quality ladder settle or oscillate on a throttled GPU?* (phase 6:
  feed the real ladder two seconds of 28ms frames)
- *Is a Retry ever offered where retrying cannot work?* (phase 6: replay all
  eleven errors `getUserMedia` can throw)

These are **whole-system properties**, and they are checked by scripts in
`scripts/`, one per phase, each a `npm run verify:phaseN`. They come in two
kinds and the difference matters:

**Kind A: against a running stack** (`verify:phase0`, `2`, `3`, `4`). Real
headless clients against the real server. These catch wire-level and protocol
bugs. `verify:phase0` is what caught the Colyseus client and server being
wire-incompatible after a version bump, before anything was built on top.

**Kind B: pure replay, nothing running** (`verify:phase5`, `6`). These import
the real modules and drive them with synthetic input. They are the ones people
actually run, because they are instant and have no setup, so they are the right
home for anything checked in a hurry.

A verify script is allowed to do things a unit test should not: read files off
disk, `git grep` the tree, count occurrences of a pattern in a source file.
That is deliberate. Some invariants are structural and have no runtime
representation at all (see §4).

### What to write a test for, in order

1. Anything with arithmetic in it. Pots, layout, budgets, thresholds.
2. Anything with a rule you would have to re-derive to check by eye.
3. Anything where a wrong answer is invisible in a screenshot. This is the big
   one for anything visual or real-time.
4. Anything you got wrong once. The test is the note.

---

## 2. Recoverable failure: classify, name the verb, then render

This is the pattern behind `media/faults.ts`, and it generalises to any failure
a user sees. It exists because of one observation:

> **Offering the wrong recovery is worse than offering none.**

A "Try again" button on a denied camera permission does nothing, every time it
is pressed, forever. Nothing a web page can do turns a denied permission into a
granted one, and Chrome will not even re-prompt after a hard denial. So the
button is not merely useless: it actively teaches the user that the app is
broken, when in fact their camera is off and the fix is two clicks away in a
menu the app could have named.

The pattern is three steps.

### Step 1: classify into a closed union, by name and never by message

```ts
export type FaultKind =
  | "denied" | "no-devices" | "device-lost"
  | "in-use" | "insecure" | "hardware" | "unknown";
```

Match on `err.name`, never on `err.message`. The message is localised and is
the one part of an exception allowed to change without notice. Read the name as
a *property* rather than instance-checking `DOMException`, because SDKs wrap
errors and pass the name through on a plain object.

Always have an `unknown` arm, and make it the safe default. `classifyMediaError`
survives being handed `null`, `7`, `"boom"` and `{}` because in production it
one day will be.

### Step 2: the fault carries a recovery *verb*, and `retryable` is derived

```ts
export type Recovery = "retry" | "browser-settings" | "connect-a-device" | "none";

function fault(kind, tracks, message, recovery): MediaFault {
  return { kind, tracks, message, recovery, retryable: recovery === "retry" };
}
```

`retryable` is computed, never stored. That single line is what makes "a Retry
button appears on a hard denial" **unrepresentable** rather than merely
untested. The verify script then asserts the biconditional across every error
the platform can produce:

```js
allFaults.every((f) => f.retryable === (f.recovery === "retry"))
```

This is the general principle and it is worth more than the specific case:

> **Derive invariants instead of storing them.** Two fields that must agree
> will one day disagree. One field and a function cannot.

### Step 3: the UI renders the verb, and decides nothing

`MediaFaultBanner.tsx` is 30 lines and has no opinions. It prints the sentence
and shows a button if `fault.retryable`. All the judgement lives in the tested
pure module.

### The parts that turned out to matter

**Severity ordering.** When two faults are live there is only room for one
message, so `worseFault()` picks by *how little the user can do about it*. A
busy camera is one click from working; a denied permission is not. The fixable
one must never hide the unfixable one.

**Do not attempt a recovery that can only produce a worse message.** Retrying a
camera on a machine that has none returns `NotFoundError`, which would replace
the accurate "your camera was unplugged" with the misleading "no camera was
found". Hence `canAttempt()`, checked before every automatic retry.

**Automatic retry where the user has already expressed intent.** Somebody
plugging a webcam back in has said what they want; making them also find a
button is rude. But only for `retryable` faults: plugging in a second camera
does not grant a permission.

**The invisible failure is the one to build for.** Of five permission paths,
four throw an exception and announce themselves. The fifth (permission revoked
mid-session from browser settings) throws nothing, ends nothing, and leaves a
frozen photograph of somebody who is still talking. It needed an explicit
watcher. Ask of every feature: *what is the failure mode that produces no
error at all?*

**Say so when a platform cannot support it.** Safari implements no `camera`
Permissions descriptor, so that fifth path cannot be detected there. That is in
`docs/BROWSERS.md` and in `defects.md` as a known limitation with "no fix
available" and the reason. A documented gap is engineering; an undocumented one
is a bug with a longer fuse.

---

## 3. Adaptive behaviour: asymmetric hysteresis

`scene/quality.ts` is the reference. Any control loop that reacts to a
measurement needs this, and the naive version is always wrong in the same way.

> **A system that oscillates between two states is worse than being pinned to
> the worse of them.**

Each quality-tier change reallocates a shadow map and renegotiates video
layers, so a machine flapping between medium and high stutters *more* than one
locked to low. A symmetric threshold guarantees flapping for any machine that
sits near it, which is exactly the population the feature exists for.

The five ingredients:

1. **Two thresholds with a dead band.** Bad above 22ms, good below 13ms, and
   between them *neither counter advances*. The band is a resting place.
2. **Asymmetric windows.** 2s of bad frames to step down, 12s of good frames to
   step up. A borderline machine trips the fast rule and never the slow one, so
   it settles.
3. **A settle period after every change.** The frames during a transition are
   the slowest of the session; judging the new state by them demotes straight
   through the floor.
4. **Clamp the input.** A backgrounded tab returns a delta of several seconds.
   Unclamped, one frame fills the whole demotion window.
5. **Give up eventually.** After two demotions, stop trying to climb. A machine
   demoted twice is a machine, not a bad second, and re-testing it every twelve
   seconds is a stutter on a schedule.

Two more rules that are about product rather than control theory:

- **An explicit user setting overrides the heuristic, in both directions.** A
  setting a heuristic can override is not a setting.
- **Name the thing the adaptation may never sacrifice.** Here: no tier may turn
  a face off, because a room with no faces is not a cheaper version of this
  product, it is a different and much worse one. Write that as a test.

And the pure/impure split again: `sampleFrame()` returns the *same object* when
nothing changed and a new one when the tier moved, so the caller uses identity
to decide whether React needs to hear about it. That is what lets a 60Hz sampler
live inside `useFrame` without ever setting state.

---

## 4. Closed sets, not spot checks

A grep somebody ran once is not a guarantee. Where an invariant is "only these
files may do X", enumerate and compare:

```js
const holeCardFiles = execSync('git grep -l -i "holecard" -- server shared', ...)
const unexpected = holeCardFiles.filter((f) => !HOLE_CARD_ALLOWED.has(f));
check("only the four files that own hole cards may name them", unexpected.length === 0);
```

The bug this catches is a fifth file appearing: a debug payload, a log line, a
convenience getter. None of those would fail any other test in the repo.

Two smaller versions of the same idea:

**Exhaustive `Record` over a union.** `MESSAGE_LIMITS` is
`Record<ClientMessageType, MessageLimit>`, so adding a message to the protocol
without deciding its budget is a *compile error*. Never `Partial` here: that is
a hole with a default in front of it.

**Count the structural fact.** `verify:phase6` counts raw `this.onMessage(`
calls in the room and fails if there is more than the one inside `onIntent`.
A rate-limit guard placed inside a handler has already paid for the frame it is
refusing, and no runtime test would notice.

When you write such a check, be honest about scope. The hole-card audit covers
`server` and `shared` and deliberately excludes `client`, because the client has
legitimate readers of its own cards, and the real question is never "who reads
a card" but "who could put one where a second client can see it". Getting that
wrong makes a check that fails for good reasons, which is how checks get
deleted.

---

## 5. Comments explain why, never what

The house style is heavy comments, and they are load-bearing. The test is
whether the comment would survive being read by somebody about to change the
line. Every non-obvious constant, every guard, and every ordering gets the
argument that put it there.

```ts
// Before the parse, because `new URL("*")` throws and the wildcard would
// otherwise be reported as a typo. It is not a typo: it lets any site on
// the internet open a socket to this server.
```

Specifically worth writing down:

- **Why a number is that number.** `CLAIM_TIMEOUT_MS` is 250 because it is set
  by how long a *busy* tab takes to service its event loop, not a quiet one.
- **Why the obvious approach was rejected.** The comment about bloom being the
  wrong tool has saved that decision from being relitigated twice.
- **Which direction an error is safe in.** "Overshooting is safe in one
  direction only."
- **What must never be added here.** The `DatagramTopic` union carries a note
  saying the thing to guard on review is any PR that widens it.

Do not write comments that restate the code, and do not leave a comment
describing behaviour that has changed. A stale comment is worse than none.

### Two documents that pay for themselves

**`plan.md` gets a "What the build corrected" section per phase.** Each entry is
a place the plan was wrong and what was learned. This is the highest-value
writing in the repo: it is where "bloom is a screen-space effect so it cannot
tell neon from a webcam highlight" lives, and it is the difference between a
decision and a rediscovery.

**`defects.md` keeps fixed items rather than deleting them**, with the shape of
the fix, because the reasoning outlives the bug. It also has a "Not defects,
recorded so they are not re-litigated" section, which is worth as much.

---

## 6. Server-authoritative, if there is a server

Not universal, but if a client can affect an outcome:

- Clients send **intents**, never outcomes. "I want to raise to 200", never
  "the pot is now 400".
- Private state is **absent from the payload**, not merely unrendered. A client
  that never receives a card cannot leak one.
- There is **exactly one function** that decides who may see privileged state.
  One function can be audited; a convention cannot.
- Every inbound message has a budget, checked **before** the handler runs.
- The threat model for an authenticated socket is usually not an outsider, it
  is a participant with an open console. Design for that.
- Refuse over-budget messages **silently**. Replying hands the flooder an
  amplifier.

---

## 7. Fail at startup, loudly, when the failure would be silent

`tls.ts` throws at module load if a production config would carry private state
in the clear. The reasoning generalises:

> A deploy that will not start is a five-minute problem. A deploy that starts
> and does the wrong thing quietly is a problem nobody notices.

Use it where the failure has **no symptom**: wrong scheme, missing secret,
misconfigured origin. Do not use it where the product merely degrades. Media
being unconfigured is a warning, because a table with no video is still a table.

Two details that make it survivable: exempt loopback so a production build can
still be run locally, and report *every* problem at once rather than one per
restart.

---

## 8. Checklist for a new module

- [ ] Is the decision separable from the I/O? Separate it.
- [ ] Does it take a clock, a channel, or a renderer? Inject the interface.
- [ ] Are two fields required to agree? Derive one.
- [ ] Is there a union? Make the handler an exhaustive `Record` or `switch`.
- [ ] What is the failure mode that produces no error at all?
- [ ] If it offers the user an action, can that action actually succeed?
- [ ] Does it react to a measurement? Give it a dead band and asymmetric windows.
- [ ] Is there an invariant with no runtime representation? Check it in `verify:*`.
- [ ] Does every constant say why it is that value?

---

## What is deliberately not here

No linter config enforcing any of this, no coverage threshold, no commit hooks.
Coverage thresholds push tests towards the shells, which is exactly backwards:
the goal is 100% of the *decisions* tested and 0% of the wiring, and a coverage
number cannot tell those apart. The `verify:*` scripts are the enforcement, and
they check properties rather than lines.
