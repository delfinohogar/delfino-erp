import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

// Integracion: requiere emulador de Firestore/Auth y Postgres local corriendo.
// Se lanza con `npm run test:integration`, que envuelve la corrida en
// `firebase emulators:exec`, asi las variables de emulador ya vienen puestas.
export default defineConfig({
  resolve: base.resolve,
  test: {
    include: ["tests/integration/**/*.test.js"],
    exclude: ["node_modules/**", "dist/**", "publicar/**"],
    environment: "node",
    globalSetup: ["./tests/integration/setup.mjs"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
