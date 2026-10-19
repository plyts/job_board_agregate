import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// Tests contre un vrai serveur IMAP (GreenMail) : `npm run test:imap` (voir docs/TESTING.md).
// La liste `include` remplace celle de la configuration de base (mergeConfig les additionnerait).
export default defineConfig({ ...base, test: { ...base.test, include: ["tests/imap/**/*.test.ts"] } });
