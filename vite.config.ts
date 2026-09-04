import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const viteHost = host || "127.0.0.1";
const rootDir = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, "index.html"),
        panel: resolve(rootDir, "panel.html"),
        preview: resolve(rootDir, "preview.html"),
        imageViewer: resolve(rootDir, "image-viewer.html"),
        controlPanel: resolve(rootDir, "control-panel.html"),
        screenshotSelector: resolve(rootDir, "screenshot-selector.html"),
        screenshotResult: resolve(rootDir, "screenshot-result.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: viteHost,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
