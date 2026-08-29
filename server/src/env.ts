import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Side-effect module: loads the repo-root `.env` into `process.env`.
 *
 * It exists as its own file, and must be the *first* import in `index.ts`,
 * because ESM evaluates a module's imports before its body. Calling
 * `dotenv.config()` inside `index.ts` would run after `config.ts` had already
 * been evaluated through the import chain, and every value would read as
 * unset. npm runs this workspace with cwd=server/, so the default lookup would
 * miss the root file anyway.
 */
dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
