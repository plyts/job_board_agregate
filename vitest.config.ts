import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    // Les tests d'intégration partagent une base PostgreSQL : pas de parallélisme entre fichiers.
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
  },
});
