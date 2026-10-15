import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // `dependencies` (e.g. tiktok-live-connector) stay external and ship in node_modules;
    // workspace packages are devDependencies, so they get bundled from TS source.
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          game: resolve(__dirname, "src/renderer/game/index.html"),
          settings: resolve(__dirname, "src/renderer/settings/index.html"),
        },
      },
    },
  },
});
