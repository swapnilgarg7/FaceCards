import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@facecards/shared": fileURLToPath(
        new URL("./shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["{server,shared,client}/**/*.test.ts"],
    environment: "node",
  },
});
