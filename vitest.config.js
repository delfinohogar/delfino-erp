import { defineConfig } from "vitest/config";

// Los modulos del ERP importan Firebase por URL desde el CDN de Google (build.js lo deja
// fuera del bundle a proposito). Este alias los mapea al paquete npm de la MISMA version,
// para poder importarlos desde Node sin tocar una linea del codigo de la app.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-app\.js$/, replacement: "firebase/app" },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-firestore\.js$/, replacement: "firebase/firestore" },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-auth\.js$/, replacement: "firebase/auth" },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-functions\.js$/, replacement: "firebase/functions" },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-storage\.js$/, replacement: "firebase/storage" },
    ],
  },
  test: {
    include: ["tests/unit/**/*.test.js"],
    exclude: ["node_modules/**", "dist/**", "publicar/**", "functions/**"],
    environment: "node",
  },
});
