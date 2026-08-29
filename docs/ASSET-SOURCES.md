# Vetted Free Asset Sources

Researched and license-verified 2026-08-29. Licenses change: re-verify on the actual asset page before download. Use the `asset-scout` agent to check anything not listed here.

**The rule:** free for commercial use, no purchase. CC0 preferred. CC-BY acceptable only with the attribution recorded in `ASSET-CREDITS.md` and reproduced in the in-app credits panel. Everything else is rejected.

---

## Headline finding

**The three hero assets do not exist for free, and that is fine, because building them is the better option anyway.** No clean CC0 poker table, poker chip, or playing card mesh was found. All three are trivially procedural and procedural gives a better result:

| Asset | Build approach |
| --- | --- |
| Poker table | Lathe/extrude an oval or octagon profile in Blender: rail plus inset felt. Export glTF, dress with ambientCG felt + wood + leather PBR sets. One-time modeling cost, exact-fit result. |
| Poker chips | Cylinder, optional torus edge lip, `CanvasTexture` denomination label, one material per denomination color. Stacking is Y-offset instancing. Ten denominations from one material beats ten downloads. |
| Playing cards | `RoundedBoxGeometry`, roughly 50 to 100 tris, UV-mapped from a texture atlas baked from the CC0 SVG card faces below. |
| Neon signage | Emissive material geometry plus `UnrealBloomPass`. Better looking than every free neon mesh found, and those are mostly non-CC0 anyway. |
| Chip stacks / card fans | Pure instancing logic. Not an asset question at all. |
| Casino murmur bed | No dedicated CC0 pack found. Layer and loop several short CC0 chatter and glass-clink clips at low volume. |

---

## Confirmed CC0 sources (no attribution, no signup)

### Poly Haven, https://polyhaven.com
CC0, verified. Models, materials and HDRIs in one place, glTF included.
- Furniture, lamps, plants: https://polyhaven.com/models/furniture
- Indoor HDRIs: https://polyhaven.com/hdris/indoor
- **Warm Bar HDRI**: https://polyhaven.com/a/warm_bar. Cozy pub interior, warm amber light, wood and glass speculars. The right lighting rig for this scene.

### ambientCG, https://ambientcg.com
CC0 1.0 Universal, verified at https://docs.ambientcg.com/license. 2800+ PBR material sets with full channel packs (color, normal, roughness, metalness, AO, displacement).
- Search: `?q=velvet`, `?q=wood`, `?q=gold`, `?q=leather`, `?category=Fabric`, `?category=Metal`
- This is the source for felt, rail wood, gold trim and velvet.

### RevK SVG Playing Cards, https://github.com/revk/SVG-playing-cards
CC0 public domain, explicitly stated as "not even requiring attribution". Write-up at https://www.revk.uk/2018/06/svg-vector-playing-cards.html.
Full 52-card deck plus jokers as vector SVG. Bake to a PNG/KTX2 atlas at whatever resolution the camera distance needs. **This is the card face art pick.**

### Kenney, https://kenney.nl
CC0 across the board, verified.
- **Casino Audio**: https://kenney.nl/assets/casino-audio. 50 card, dice, chip and foley sounds. The SFX pick.
- **Playing Cards Pack**: https://kenney.nl/assets/playing-cards-pack. 270 assets. Backup card art if the direction goes flat-vector rather than traditional.
- **Board Game Pack**: https://kenney.nl/assets/boardgame-pack. 490 assets. Verify in the zip whether poker-style chips are included.

### Quaternius Ultimate Modular Men Pack, https://quaternius.com/packs/ultimatemodularcharacters.html
CC0, verified on page. FBX, OBJ, Blend and glTF. 11 modular characters with swappable parts.
**The avatar body pick.** Businessman and gentleman are near-direct fits; the other archetypes come from outfit and accessory swaps on the same base.

### Google Fonts (OFL, free commercial, no attribution in the rendered product)
- **Cinzel Decorative**, https://fonts.google.com/specimen/Cinzel+Decorative. Grand casino headlines and logo.
- **Playfair Display**, https://fonts.google.com/specimen/Playfair+Display. Elegant high-contrast serif for UI headers.
- **Bebas Neue**, https://fonts.google.com/specimen/Bebas+Neue. Condensed all-caps, art-deco adjacent. Chip denominations and HUD numerals.
- Pair with Inter or Work Sans for body text.

---

## Conditional sources (verify per item)

### Poly Pizza, https://poly.pizza
Mostly CC0 or CC-BY, normalized per model. No login. **The license badge is per-model and was not visible in list view.** Check each model page.
- Chips: https://poly.pizza/search/chips
- Chandeliers: https://poly.pizza/search/chandelier

### Sketchfab
Only usable via the CC0 filter, https://sketchfab.com/tags/cc0, **and even then verify the license field on the model page itself.** See the warning below.
- Generic CC0 table to reshape: https://sketchfab.com/3d-models/cc0-table-335ce901383647a782b73152987afa18
- Stylized poker table by Morgan.J (CC-BY, attribution required): https://sketchfab.com/3d-models/stylized-poker-table-game-asset-48fd86c57c2b497a900223d8f115f188
- Low-poly slot machine by Bar0nline (verify license): https://sketchfab.com/3d-models/low-poly-slot-machine-d42ef425b3554abf9fc86e39a9b13389

### OpenGameArt, https://opengameart.org
Mixes CC0, CC-BY and GPL per upload. Check the badge every time.
- Cards Set (listed CC0): https://opengameart.org/content/cards-set
- 54 Casino sound effects: https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips

### Freesound, https://freesound.org
Per-file license: CC0, CC-BY or CC-BY-NC. Filter to CC0. Free account required to download. CC-BY-NC files are a hard reject.
- Poker Chips pack by fartheststar: https://freesound.org/people/fartheststar/packs/12843/

### Mixamo, https://www.mixamo.com
Free for unlimited commercial use, no royalties. Free Adobe account required.
**Restriction:** you may ship the animations inside the finished game, but may not redistribute the raw FBX animation files as a standalone pack. Shipping them baked into a GLB is fine.
Note its library is stand/walk focused. Seated poker poses will need manual work; check the Sitting category first.

### VRoid Studio
A free authoring tool, not an asset source. You own what you make. Worth considering if the head-plane face-swap mechanic needs custom heads.

---

## Rejected, and why

| Source | Reason |
| --- | --- |
| **Ready Player Me** web-creator avatars | CC-BY-NC-SA 4.0 by default. Commercial use requires registering as a paid/approved developer partner, which is not "no purchase required". Reject unless that partnership is actually done. |
| **Polygonal Mind "100 Avatars R1/R2 CC0 Character Pack"** (Sketchfab) | The title says CC0. The license field on the page reads **CC-BY**. Confirmed by direct fetch. Usable only with attribution. Flagged here because the title is actively misleading. |
| Sketchfab "Poker Table" by samt2510 | CC-BY-NC, non-commercial only. |
| Any Sketchfab item badged CC-BY-NC or CC-BY-NC-SA | Non-commercial. |
| TurboSquid, CGTrader, Free3D "free" listings | These mix paid-tier and platform-license content. Reject by default unless the specific page states CC0 or public domain, which is rare. |
| Zapsplat | Requires an account and its free-tier standard license carries usage caveats. Re-verify current ToS before relying on it. |
| Sonniss GDC bundles | Free, but each year's bundle ships its own license file. Do not assume CC0 without reading that year's terms. |

**The general lesson:** never trust an asset's title, tags, or the platform's reputation. Read the license field on the page.

---

## Pipeline

```bash
# every GLB entering public/models/
npx gltf-transform optimize in.glb out.glb --compress draco --texture-compress webp
```

- **Draco** cuts geometry size by roughly 90 to 95 percent. `GLTFLoader` needs `DRACOLoader` configured; the decoder runs in a worker so it does not block, but budget the ~150KB WASM in the loading bundle.
- **KTX2 / Basis Universal** for the large PBR sets. They stay compressed on the GPU, roughly 10x VRAM reduction versus raw PNG/JPG. ambientCG and Poly Haven ship full-res JPG by default, which will bloat both download and VRAM if shipped as-is.
- **gltfpack** (meshoptimizer) is the leaner alternative when only vertex quantization and mesh simplification are wanted.
- **Blender glTF export**: use the built-in glTF 2.0 exporter, "+Y Up" enabled, Principled BSDF (maps straight to `MeshStandardMaterial`). Apply Decimate before export on anything over 5 to 10k tris that is a background prop.

### Tri-count budgets

| Asset class | Budget |
| --- | --- |
| Hero table | under 15k |
| Seated avatar (up to 9 live at once) | under 8k each |
| Background props | under 2k each |
| Card | 50 to 100 |
| Chip | keep low, they are instanced by the hundred |
