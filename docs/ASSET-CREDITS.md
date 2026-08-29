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

| Asset | File in repo | Source URL | Author | License | Attribution required |
| --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | |

## Fonts

| Font | Source URL | License |
| --- | --- | --- |
| _(none yet)_ | | |

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
