import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const viteHost = host || "127.0.0.1";
const rootDir = dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 宠物主窗口(index.html)和 3 个面板窗口共用的 panel.html 都要打进 build 产物，
  // 否则 tauri 在生产模式下用 WebviewUrl::App("panel.html") 打开时会 404。
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
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    // 默认的 1420 端口落在这台机器 Windows 保留的 TCP 排除区间(1338-1437)里，会导致
    // EACCES: permission denied，换成 5173（Vite 默认端口，未被排除）。
    port: 4173,
    strictPort: true,
    host: viteHost,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 4174,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
