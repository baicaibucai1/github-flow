import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 组件源码在本仓库的 soda/ 下（Soda ADR-101：源码落到应用里，一致性由检查保证而不是包边界）。
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@soda\/ui$/, replacement: r("../soda/ui/src/index.ts") },
      { find: /^@soda\/ui\/(.*)$/, replacement: r("../soda/ui/src/$1") },
      { find: /^@soda\/patterns$/, replacement: r("../soda/patterns/src/index.ts") },
      { find: /^@soda\/patterns\/(.*)$/, replacement: r("../soda/patterns/src/$1") },
      { find: "@soda/theme/tokens.css", replacement: r("../soda/theme/src/tokens.css") },
    ],
  },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
