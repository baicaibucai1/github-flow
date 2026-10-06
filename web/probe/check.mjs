// 三路候选的验收断言。复跑：
//   node probe/check.mjs --baseline   # 红线：拿"现在这版"跑，应当大面积失败
//   corepack pnpm@10 --filter web probe:build && node probe/check.mjs
//
// 断言只钉两件事：(1) 是不是 GitHub 的那几个具体数值；(2) 内容有没有少。
// 视觉好不好看不在这里断言 —— 那要你眼睛判。
//
// 作用域刻意分开：设计 token 只看**产出的 CSS**（第三方 JS 里藏着 sonner 的
// border-radius:6px，混在一起断会把无关依赖当成"这个候选有 GitHub 圆角"）；
// 内容齐全看 CSS+JS+HTML 的并集（真数据被打进 JS 里）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // .../web/probe
const web = join(here, "..");
const mode = process.argv.includes("--baseline") ? "baseline" : "probe";
const data = JSON.parse(readFileSync(join(here, "profile.json"), "utf8"));

// 期望值全部来自 GitHub 自己的 Primer 亮色主题（不是我们臆造的"像 GitHub 的颜色"）
const FACTS = [
  { id: "canvas", what: "色板里有 #f6f8fa（Primer 的 canvas.subtle）", re: /#f6f8fa/i },
  { id: "border", what: "边框 #d0d7da / #d1d9e0", re: /#d0d7da|#d1d9e0/i },
  { id: "link", what: "链接蓝 #0969da", re: /#0969da/i },
  { id: "fg", what: "正文色 #1f2328 / #24292f", re: /#1f2328|#24292f/i },
  {
    id: "radius",
    what: "圆角被定成 6px（看 radius 声明，不看阴影里的 6px）",
    re: /--radius[a-z-]*:\s*6px|border-radius:\s*6px|rounded-\[6px\]|--borderRadius:\s*['"]?6px/i,
  },
  { id: "font14", what: "正文 14px 或 .875rem", re: /(^|[^0-9.])14px|(^|[^0-9.])\.875rem|0\.875rem/ },
];

// 内容齐不平齐是硬伤：三版必须渲染同一份真数据
const CONTENT = [...data.popular.map((r) => r.name), data.name, data.login, "American", String(data.followers)];

// 被否掉的那种摆法：12 栏浮块面板网格
const ANTI = { id: "no-dashboard-grid", what: "不是 12 栏面板网格的 dashboard 摆法" };

function readDir(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

function runTargets() {
  if (mode === "baseline") {
    const css = readDir(join(web, "dist", "assets"), [".css"]).join("\n");
    const js = readDir(join(web, "dist", "assets"), [".js"]).join("\n");
    const src = readFileSync(join(web, "src", "views", "MeView.tsx"), "utf8");
    return [{ name: "当前这版（MeView + Soda ink）", css, js, all: css + js, src, allowsJs: false }];
  }
  return ["a", "b", "c"].map((n) => {
    const dir = join(web, "probe-dist");
    const html = readFileSync(join(dir, n + ".html"), "utf8");
    const refs = [...html.matchAll(/(?:href|src)="\.?\/?([^"]+\.(?:css|js))"/g)].map((m) => m[1]);
    let css = "";
    let js = "";
    const ownCssFiles = [];
    for (const ref of refs) {
      const p = join(dir, ref.replace(/^\//, ""));
      if (!existsSync(p)) continue;
      const t = readFileSync(p, "utf8");
      if (p.endsWith(".css")) {
        css += "\n" + t;
        ownCssFiles.push(p.split(/[\\/]/).pop());
      } else js += "\n" + t;
    }
    // 公共 chunk 只算进 JS（数据可能被打进共享块）。
    // 刻意**不**把别人的 CSS 混进来：否则 A 的样式表会让 B、C 也"通过"色值断言
    // —— 第一版就是这么假绿的。
    const assets = join(dir, "assets");
    if (existsSync(assets))
      for (const f of readdirSync(assets)) {
        if (refs.some((r) => r.endsWith(f))) continue;
        if (!f.endsWith(".js")) continue;
        js += "\n" + readFileSync(join(assets, f), "utf8");
      }
    const src =
      readFileSync(join(here, n + ".tsx"), "utf8") +
      (existsSync(join(here, n + ".css")) ? readFileSync(join(here, n + ".css"), "utf8") : "");
    return {
      name: n.toUpperCase() + " 候选",
      css,
      js,
      all: css + js,
      src,
      ownCssFiles,
      // B 是 styled-components 体系：token 值在运行时注入，产物 CSS 里本来就没有色值。
      // 允许它退到 JS 里找，但会在输出上标出来，不混为"同样通过"。
      allowsJs: n === "b",
    };
  });
}

let pass = 0;
let fail = 0;
for (const t of runTargets()) {
  console.log(`\n### ${t.name}`);
  if (mode === "probe")
    console.log(`  （色值断言只读它自己的 CSS：${t.ownCssFiles.join(", ") || "无 —— 说明样式表没被引用"}）`);
  for (const f of FACTS) {
    let hit = f.re.test(t.css);
    let where = "";
    if (!hit && t.allowsJs && f.re.test(t.js)) {
      hit = true;
      where = "（在 JS 里，运行时注入）";
    }
    console.log(`  ${hit ? "PASS" : "FAIL"}  ${f.what}${where ? " " + where : ""}`);
    hit ? pass++ : fail++;
  }
  if (mode === "probe") {
    const missing = CONTENT.filter((c) => !t.all.includes(c));
    const ok = missing.length === 0;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  内容齐全（${CONTENT.length} 项：6 个仓库名 + 姓名 + login + 位置 + followers）` +
        (ok ? "" : " —— 缺: " + missing.slice(0, 4).join(", "))
    );
    ok ? pass++ : fail++;
    const clean = !t.src.includes("lg:grid-cols-12");
    console.log(`  ${clean ? "PASS" : "FAIL"}  ${ANTI.what}`);
    clean ? pass++ : fail++;
    const shared = /profile\.json/.test(t.src);
    console.log(`  ${shared ? "PASS" : "FAIL"}  用的是同一份真数据 probe/profile.json`);
    shared ? pass++ : fail++;
    // 这一条就是抓 c.css 那种事的：文件在磁盘上，但入口没 import，页面其实没样式
    const hasCss = t.ownCssFiles.length > 0;
    console.log(`  ${hasCss ? "PASS" : "FAIL"}  样式表被这个入口真正引用（产物里有自己的 CSS）`);
    hasCss ? pass++ : fail++;
  } else {
    console.log("  N/A   内容齐全（真应用的数据是运行时从 Rust 取的，静态断言不适用）");
  }
}
console.log(`\n=== 合计 ${pass} 通过 / ${fail} 失败（模式：${mode}）===`);
process.exit(fail ? 1 : 0);
