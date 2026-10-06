// 「我的」页换成 GitHub 皮肤（候选 A）之后的验收断言。复跑：
//   node check-skin.mjs --baseline   # 改之前跑，应当大面积失败
//   corepack pnpm@10 --filter web build && node check-skin.mjs
//
// 只钉可判定的事：token 在不在产物里、默认主题集是不是它、排版是不是两栏连续流、
// 信息块有没有丢、Primer 依赖有没有清干净。好不好看由你眼睛判。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(fileURLToPath(import.meta.url));
const mode = process.argv.includes("--baseline") ? "baseline" : "after";

const assetsDir = join(web, "dist", "assets");
const css = readdirSync(assetsDir)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(assetsDir, f), "utf8"))
  .join("\n");

const store = readFileSync(join(web, "src", "lib", "store.tsx"), "utf8");
const meview = readFileSync(join(web, "src", "views", "MeView.tsx"), "utf8");
const settings = readFileSync(join(web, "src", "views", "SettingsView.tsx"), "utf8");
const pkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));

// 逐页：必须还在的信息块（钉可见文字，不钉实现细节）+ 不许回来的摆法
const PAGES = [
  {
    file: "src/views/FeedView.tsx",
    name: "发现",
    need: ["显示更多", "热度榜是空的", "重新读取"],
    ban: [/sm:grid-cols-2/, /columns:/],
  },
  {
    file: "src/components/RepoCard.tsx",
    name: "发现页的条目行",
    need: ["收藏", "不感兴趣", "浏览器打开", "clone", "出生"],
    ban: [/hero/],
  },
  {
    file: "src/views/DetailView.tsx",
    name: "详情",
    need: ["README", "语言构成", "最近 release", "应用内浏览 GitHub", "dwell", "star 增长"],
    ban: [/lg:grid-cols-12/],
  },
  {
    file: "src/views/SettingsView.tsx",
    name: "设置",
    need: ["外观", "账号", "网络", "翻译", "数据", "粘贴 token", "设备码", "client_id", "HTTP 代理", "重新校准"],
    ban: [/set_token_cmd/],
  },
  {
    file: "src/views/StatsView.tsx",
    name: "统计",
    need: ["曝光", "触达", "点开率", "样本不足", "没有任何一条离开这台机器"],
    ban: [/DashboardPage/, /PanelCard/],
  },
  {
    file: "src/views/MeView.tsx",
    name: "我的",
    need: ["Popular repositories", "Contribution activity", "它以为你喜欢什么", "语言权重", "你做过什么", "哪些桶已经在动排序", "身份与凭据"],
    ban: [/DashboardPage/, /PanelCard/, /lg:grid-cols-12/],
  },
];

const CHECKS = [
  {
    id: "token-set",
    what: 'token 层里有 data-set="github" 这一套（压缩后引号会被去掉，所以两种都认）',
    pass: /\[data-set=\\?"?github\\?"?\]/.test(css),
  },
  {
    id: "token-values",
    what: "产物 CSS 里能同时找到 Primer 的四个关键值（#f6f8fa / #0969da / #d0d7da / #1f2328）",
    pass: ["#f6f8fa", "#0969da", "#d0d7da", "#1f2328"].every((v) => css.toLowerCase().includes(v)),
  },
  {
    id: "radius6",
    what: "github 皮肤把圆角定成 6px",
    pass: /--radius:\s*6px/.test(css),
  },
  {
    id: "default-set",
    what: "默认主题集是 github（打开就是这套，不用手切）",
    pass: /set:\s*"github"/.test(store),
  },
  {
    id: "picker",
    what: "设置页的主题集选择里有 github",
    pass: /\["github"/.test(settings),
  },
  {
    id: "flow",
    what: "「我的」页是 296px 两栏连续流，不是 12 栏面板网格",
    pass: /296px/.test(meview) && !/lg:grid-cols-12/.test(meview),
  },
  {
    id: "blocks",
    what: "信息块一个没丢（仓库/活跃/词表/语言/行为/分桶/凭据）",
    pass: [
      "Popular repositories",
      "Contribution activity",
      "它以为你喜欢什么",
      "语言权重",
      "你做过什么",
      "哪些桶已经在动排序",
      "身份与凭据",
    ].every((k) => meview.includes(k)),
  },
  {
    id: "no-primer",
    what: "Primer 的两个包已经从依赖里清掉",
    pass: !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((k) => k.startsWith("@primer/")),
  },
];

let pass = 0;
let fail = 0;
console.log(`### ${mode === "baseline" ? "改之前（基线）" : "改之后"} 的断言`);
for (const c of CHECKS) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.what}`);
  c.pass ? pass++ : fail++;
}
console.log("\n### 逐页：信息块在不在、被否掉的摆法回没回来");
for (const p of PAGES) {
  const src = existsSync(join(web, p.file)) ? readFileSync(join(web, p.file), "utf8") : "";
  const missing = p.need.filter((k) => !src.includes(k));
  const still = p.ban.filter((re) => re.test(src)).map(String);
  const ok = !missing.length && !still.length;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${p.name}` +
      (missing.length ? ` —— 缺: ${missing.join(" / ")}` : "") +
      (still.length ? ` —— 不该有: ${still.join(" ")}` : "")
  );
  ok ? pass++ : fail++;
}

console.log(`\n=== 合计 ${pass} 通过 / ${fail} 失败 ===`);
if (!existsSync(assetsDir)) console.log("（dist 不在，先跑 corepack pnpm@10 --filter web build）");
process.exit(mode === "baseline" ? 0 : fail ? 1 : 0);
