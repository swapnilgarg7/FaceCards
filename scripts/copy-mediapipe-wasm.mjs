/**
 * Stage the MediaPipe wasm runtime into the client's static assets.
 *
 * The runtime is ~18 MB across four files and is versioned with the npm
 * package, so it is copied on every dev start and build rather than committed:
 * a checked-in binary that has to be manually re-synced after `npm update` is a
 * binary that will be a release behind within a month.
 *
 * The model itself (`blaze_face_short_range.tflite`, ~230 KB) *is* committed,
 * because it is not in any npm package. It comes from Google's model CDN, and
 * a build that fetches it at runtime is a build that breaks when that URL
 * moves. See `docs/ASSET-CREDITS.md`.
 */

import { cp, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Resolved rather than joined onto `node_modules`, so this works whether npm
// hoisted the package to the workspace root or left it under `client/`.
const packageRoot = dirname(require.resolve("@mediapipe/tasks-vision"));
const source = join(packageRoot, "wasm");
const destination = join(repoRoot, "client", "public", "mediapipe", "wasm");

/** Copying 18 MB on every `npm run dev` is a second nobody needs to spend. */
async function upToDate() {
  const probe = "vision_wasm_internal.wasm";
  try {
    const [from, to] = await Promise.all([
      stat(join(source, probe)),
      stat(join(destination, probe)),
    ]);
    return from.size === to.size && to.mtimeMs >= from.mtimeMs;
  } catch {
    return false;
  }
}

if (await upToDate()) {
  process.exit(0);
}

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`[mediapipe] staged wasm runtime -> ${destination}`);
