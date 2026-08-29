import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { DEFAULT_CLIENT_PORT } from "../shared/src/constants.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root configures both halves. Two would drift.
  envDir: repoRoot,
  resolve: {
    alias: {
      // Explicit, so `@facecards/shared` resolves to TypeScript source rather
      // than to a build step nobody wants in the inner loop.
      "@facecards/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: DEFAULT_CLIENT_PORT,
    strictPort: true,
  },
});
