# Browser matrix

Spec section 12 targets **desktop Chrome, Safari and Edge on Mac and Windows**,
with no native app. This is what each one actually does, what it costs, and
where the product stops pretending otherwise.

A matrix in a document goes stale the week after it is written, so the parts
that have to be true at runtime are not here - they are in
`client/src/support.ts`, which probes the platform in the lobby and says one
sentence if anything is missing. **Nothing in this file is a version check.**
Asking "is this Safari 16" is a guess about a build number that is wrong in
both directions the moment a browser ships or removes something; asking "does
`RTCPeerConnection` exist" is not a guess.

## The matrix

| | Chrome / Edge | Safari | Firefox |
| --- | --- | --- | --- |
| WebGL 2, the room | yes | yes | yes |
| WebRTC, faces and voice | yes | yes | yes |
| `getUserMedia` | yes | yes | yes |
| Simulcast layers (`attention.ts`) | 3 rungs | 3 rungs | 3 rungs |
| Permissions API `camera` / `microphone` | yes | **no** | **no** |
| `requestVideoFrameCallback` | yes | yes | **no** |
| `BroadcastChannel` (duplicate-tab warning) | yes | yes | yes |
| `navigator.deviceMemory` (quality probe) | yes | **no** | **no** |
| `WEBGL_debug_renderer_info` (quality probe) | being removed | **no** | behind a pref |
| Autoplay of remote audio | needs a gesture | needs a gesture | needs a gesture |

Edge is Chromium and behaves as Chrome throughout; it is listed separately only
because the spec names it. Firefox is not a target and is listed because people
use it anyway, and because it is the browser that exposes the least about
itself - which makes it the useful worst case for every probe in the product.

## Safari is the one that hurts, and here is exactly where

The phase-6 plan said to test Safari deliberately and early. Three of its four
differences turned out to be already handled, for reasons that had nothing to do
with Safari, and the fourth is a real and permanent gap.

**Permission revocation is invisible.** Safari implements no `camera` or
`microphone` descriptor for the Permissions API, so `watchMediaPermission` has
nothing to subscribe to. On Chrome, revoking camera access from site settings
while somebody is sitting at a table raises a fault within a frame; on Safari
nothing happens until the next thing fails. **This is a genuine gap and there is
no workaround** - there is no other way to ask the platform. What softens it is
that the *other* four denial paths (refused up front, no device, unplugged
mid-session, taken by another app) all still work on Safari, because they are
driven by exceptions and by the platform `ended` event rather than by a
permission query.

**No `deviceMemory`, no renderer string.** The quality probe (`scene/quality.ts`)
was written to answer with whatever survives, and an absent signal is explicitly
not treated as evidence of a weak machine - `probeTier({})` is `high`. Safari
therefore starts at the top and is moved by the frame clock within about two
seconds, which is the authority anyway. The probe was never more than a way to
avoid two seconds of dropped frames on machines that could be identified in
advance.

**Autoplay.** Remote audio is blocked until a user gesture, which is true of
every browser now and has had a banner since phase 0 (`media.audioBlocked` →
"Click to enable sound").

**The frame-callback trap that was not a Safari problem.** `VideoTexture`
uploads are driven from a decoded-frame counter rather than from
`requestVideoFrameCallback` - see the long note at the top of
`avatars/useFaceTexture.ts`. That was not written for Firefox's missing rVFC; it
was written because rVFC fires on *composition*, and every video element here
lives in a hidden sink and is never composited. Firefox gets the fallback path
for free, and `support.ts` deliberately does not warn about the missing API.

## What each missing capability costs

`support.ts` splits these into two lists, and the split is the whole point.

**Blockers** - the room cannot work, so say so before anyone tries:

- **not a secure context**: `getUserMedia` is absent, WebRTC is absent, and the
  failures that produces look nothing like their cause. This is the common one,
  and it is not a browser problem: it is what visiting a dev server on a bare
  LAN address does. Listed first because it *causes* several of the entries
  below it.
- **no WebGL 2**: hardware acceleration switched off, usually. The room is a
  black canvas.
- **no WebSocket / no WebRTC**: no table, or a table with nobody at it.

**Warnings** - playable, with something named missing:

- **no `getUserMedia`**: you cannot be seen or heard, and you can still sit
  down, watch the hand and hear everybody. This is a warning rather than a
  blocker on purpose. The product's argument is that being in the room matters
  more than the features, so the failure mode is a sentence and not a door.
- **no Web Audio**: chips and cards are silent. Voices are unaffected - they are
  `<audio>` elements, not Web Audio.
- **no `BroadcastChannel`**: the duplicate-tab warning cannot run, so two tabs
  at one table will echo the person's own voice back at everybody with nothing
  saying why.

## Testing it by hand

The five permission paths, which are the phase-6 exit criterion. All five must
recover without a page reload.

1. **Refused up front** - deny at the lobby prompt. Expect: seated anyway,
   banner, no Retry button, a sentence pointing at site settings.
2. **No device** - Chrome DevTools ⋮ → More tools → Sensors, or unplug
   everything. Expect: "no camera was found", offered a seat.
3. **Unplugged mid-session** - pull the webcam while seated. Expect: banner with
   a working Retry; plugging it back in retries by itself.
4. **Taken by another app** - join a call in another app, then load this one.
   Expect: "in use by another app", Retry works once the other app lets go.
5. **Revoked mid-session** - Chrome only (see above): site settings → camera →
   Block, while seated. Expect: banner within a frame, no Retry, and setting it
   back to Allow clears it without a reload.

Throttled GPU, for the automatic fallback: DevTools → Rendering → **Disable
hardware acceleration** relaunches Chrome on SwiftShader, which `probeTier`
recognises by name and starts on the floor. To exercise the *ladder* rather than
the probe, use CPU throttling (Performance panel → 6× slowdown) while watching
the tier in the settings panel; it should step down within a couple of seconds
and then stay put rather than alternating.

Duplicate tab: open the same invite link twice in one browser. Expect the
*second* tab to warn, the first to stay quiet, and the warning to clear when
either is closed.

`npm run verify:phase6` checks the parts of all of this that can be checked
without a person.
