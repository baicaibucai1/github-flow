import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 三个候选的独立构建：只给验收脚本用，不进应用的构建产物。
// root 必须是 probe/ 本身，否则 Vite 会按 root 的相对层级把 html 吐到
// probe-dist/web/probe/ 下面，验收脚本按名字找就找不到（第一版就踩了）。
export default defineConfig({
  root: r("probe"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@soda\/ui$/, replacement: r("../soda/ui/src/index.ts") },
      { find: /^@soda\/ui\/(.*)$/, replacement: r("../soda/ui/src/$1") },
      { find: /^@soda\/patterns$/, replacement: r("../soda/patterns/src/index.ts") },
      { find: /^@soda\/patterns\/(.*)$/, replacement: r("../soda/patterns/src/$1") },
    ],
  },
  build: {
    outDir: r("probe-dist"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        a: resolve(import.meta.dirname, "probe/a.html"),
        b: resolve(import.meta.dirname, "probe/b.html"),
        c: resolve(import.meta.dirname, "probe/c.html"),
      },
    },
  },
});
