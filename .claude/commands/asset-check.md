---
description: Audit every shipped asset against docs/ASSET-CREDITS.md and the free-for-commercial-use rule
---

Audit this project's art assets for license compliance.

1. List every asset file actually present under `public/` (models, textures, audio, fonts) and every font loaded from a stylesheet.
2. Cross-reference against `docs/ASSET-CREDITS.md`.
3. Report:
   - Assets in the build with **no credits entry** - these block release.
   - Credits entries whose file no longer exists - stale rows to remove.
   - Any entry whose license is not free-for-commercial-use, or is CC-BY without the attribution reproduced in the in-app credits panel.
4. For anything unverifiable, use the `asset-scout` agent to re-check the source page, or recommend replacing it with a CC0 alternative or procedural geometry.

Do not modify assets. Report findings and propose the fix.
