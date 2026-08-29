# Asset Credits & License Audit

Every third-party asset shipped in this project is listed here. **An asset that is not in this table is not allowed in the build.**

License policy: free for commercial use, no purchase. CC0 preferred. CC-BY allowed with the attribution line reproduced below. Rejected outright: paid assets, CC-BY-NC, CC-BY-ND, and any license forbidding redistribution of the mesh inside a web client bundle.

## 3D models

| Asset | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | |

## Textures, materials & HDRIs

| Asset | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | |

## Audio

All from one pack: **Kenney Casino Audio 1.1**, CC0 1.0, verified on the asset page and in the `License.txt` inside the download, which ships alongside the files at `client/public/audio/LICENSE.txt`. Credit is welcomed by the author but explicitly not required, so there is no attribution line to reproduce in-app.

Twenty-four of the pack's fifty clips are shipped: the ones the table can actually ask for. `scripts/verify-phase4.mjs` checks this table against both the manifest in `client/src/audio/sounds.ts` and the files on disk, in all three directions, so a sound cannot be added without a row here and a file cannot ship that nothing plays.

| Asset | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| Card shuffle (riffle) | `client/public/audio/card-shuffle.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Card dealt / slid across felt | `client/public/audio/card-slide-1.ogg, client/public/audio/card-slide-2.ogg, client/public/audio/card-slide-3.ogg, client/public/audio/card-slide-4.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Card placed face up (board) | `client/public/audio/card-place-1.ogg, client/public/audio/card-place-2.ogg, client/public/audio/card-place-3.ogg, client/public/audio/card-place-4.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Hand pushed away (fold) | `client/public/audio/card-shove-1.ogg, client/public/audio/card-shove-2.ogg, client/public/audio/card-shove-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Chips laid down (bet) | `client/public/audio/chip-lay-1.ogg, client/public/audio/chip-lay-2.ogg, client/public/audio/chip-lay-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Chips gathered (bets swept into the pot) | `client/public/audio/chips-handle-1.ogg, client/public/audio/chips-handle-2.ogg, client/public/audio/chips-handle-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Chips stacked (pot pushed to the winner) | `client/public/audio/chips-stack-1.ogg, client/public/audio/chips-stack-2.ogg, client/public/audio/chips-stack-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |
| Single chip clink | `client/public/audio/chips-collide-1.ogg, client/public/audio/chips-collide-2.ogg, client/public/audio/chips-collide-3.ogg` | https://kenney.nl/assets/casino-audio | Kenney Vleugels (kenney.nl) | CC0 1.0 | No |

**Not a file:** the low room murmur under the table is synthesised at runtime by `client/src/audio/murmur.ts` rather than sampled. No CC0 crowd bed was found (see `ASSET-SOURCES.md`), and a short loop of chatter is recognisable as a loop within a minute of a session people sit inside for a whole evening. Filtered noise costs no licence row and never repeats.

## Fonts

Two faces, latin subsets only, **self-hosted** rather than linked from Google's CDN. Three reasons, in order of how much they matter: the fonts are needed by canvas textures inside the 3D scene, and a stylesheet that has to be fetched, parsed and then resolved is a race the first rail plaque loses; a hosted font is a third-party request from every player's browser; and it is one more thing that can be slow or blocked on somebody's network while six friends wait for a table.

Both are SIL Open Font License 1.1, which permits redistribution of the font files (that is the whole point of the licence) provided the notice and licence text travel with them. They do, at `client/public/fonts/LICENSE.txt`, which ships to the client alongside the `.woff2` files. **OFL requires no attribution in the rendered product**, so there is no in-app credit line and no row in the CC-BY notice below.

`scripts/verify-phase5.mjs` checks this table against the files on disk and against `client/src/styles.css` in all three directions, so a font cannot ship without a row here, a row cannot outlive its file, and a `@font-face` cannot point at a file that is not there.

| Font | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| Cinzel Decorative 700 (latin) | `client/public/fonts/cinzel-decorative-latin-700.woff2` | https://fonts.google.com/specimen/Cinzel+Decorative | Natanael Gama | OFL 1.1 | No |
| Bebas Neue 400 (latin) | `client/public/fonts/bebas-neue-latin-400.woff2` | https://fonts.google.com/specimen/Bebas+Neue | Dharma Type | OFL 1.1 | No |

**Not a file:** every other surface in the room. Felt, oxblood leather, walnut, brass, carpet, velvet, the chip face and edge, the card atlas, the neon glow and the baked contact shadows are all drawn onto a canvas at startup by `client/src/scene/surfaces.ts`, `cardAtlas.ts`, `plaques.ts` and `avatars/textures.ts`. The phase-5 plan budgeted for ambientCG PBR sets and Poly Haven props; see `ASSET-SOURCES.md` and the phase-5 notes in `plan.md` for why drawing them won. No downloads means no licence rows, which is why this table is two lines long for a whole art phase.

## ML models & runtimes

Not art, but shipped to the client and therefore held to the same rule.

| Asset | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| BlazeFace (short range) face detector | `client/public/mediapipe/blaze_face_short_range.tflite` | https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite | Google / MediaPipe | Apache-2.0 | No |
| MediaPipe Tasks Vision wasm runtime | _not committed_ — staged from `@mediapipe/tasks-vision` into `client/public/mediapipe/wasm/` by `scripts/copy-mediapipe-wasm.mjs` | https://www.npmjs.com/package/@mediapipe/tasks-vision | Google / MediaPipe | Apache-2.0 | No |

The model is committed because it is not distributed in any npm package and a build that fetches it from Google's CDN at runtime breaks when that URL moves. The 18 MB wasm runtime is not committed: it is versioned with the npm package and re-staged on every dev start and build, so it cannot drift behind an `npm update`.

Apache-2.0 requires the license text and notice to be preserved with redistribution, which the shipped `.tflite` and wasm carry from upstream. No in-app attribution line is required, and no rows in the CC-BY notice below.

## Attribution notice (shipped in-app)

Any CC-BY asset above must have its attribution string reproduced verbatim in the in-app credits panel. Keep this section and that panel in sync.

## Rejected candidates

Assets evaluated and rejected, so nobody re-evaluates them later. Full vetted source catalog in `ASSET-SOURCES.md`.

| Asset | Source | Reason rejected |
| --- | --- | --- |
| Ready Player Me avatars (web creator) | https://readyplayer.me | CC-BY-NC-SA 4.0 by default. Commercial use needs a paid/approved partner registration, so it is not "free, no purchase". |
| "100 Avatars R1/R2 - CC0 Character Pack" (Polygonal Mind) | Sketchfab | **Title says CC0, license field says CC-BY.** Verified by direct fetch. Usable only with attribution. Listed here because the title actively misleads. |
| "Poker Table" by samt2510 | Sketchfab | CC-BY-NC, non-commercial only. |
| TurboSquid / CGTrader / Free3D "free" listings | various | Mix paid-tier and platform-license content. Rejected by default unless a specific page states CC0. |
| Zapsplat | https://zapsplat.com | Account required and free-tier license carries usage caveats. |
| Sonniss GDC bundles | annual bundles | Each year ships its own license file. Not CC0 by default. |

**Standing lesson:** never trust an asset's title, tags, or the platform's reputation. Read the license field on the page itself.
