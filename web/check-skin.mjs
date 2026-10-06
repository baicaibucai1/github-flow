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
// 仓库视图是跨语言的改动（Rust 取数 + command 注册 + 前端），所以断言也要跨过语言层
const rust = readFileSync(join(web, "..", "src-tauri", "src", "feed.rs"), "utf8");
const mainrs = readFileSync(join(web, "..", "src-tauri", "src", "main.rs"), "utf8");
const bridge = readFileSync(join(web, "src", "lib", "bridge.ts"), "utf8");
const detail = readFileSync(join(web, "src", "views", "DetailView.tsx"), "utf8");
const treex = existsSync(join(web, "src", "components", "RepoTree.tsx"))
  ? readFileSync(join(web, "src", "components", "RepoTree.tsx"), "utf8") : "";

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
    need: ["README", "语言构成", "最近 release", "应用内浏览 GitHub", "dwell", "star 增长", "概览", "Issues", "Pull requests"],
    ban: [/lg:grid-cols-12/],
  },
  {
    file: "src/components/RepoTree.tsx",
    name: "仓库文件树与预览",
    need: ["二进制文件，不做预览", "已截断", "在 GitHub 打开"],
    ban: [/dangerouslySetInnerHTML/],
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
  // ---- 仓库视图（文件树 / 预览 / Issues / PR）
  {
    id: "rust-registered",
    what: "三条命令在 Rust 侧有 #[tauri::command] 且已进 generate_handler（少了后者前端只会报 command not found）",
    pass: ["repo_tree", "repo_file_read", "repo_list"].every(
      (c) => new RegExp(`#\\[tauri::command\\][\\s\\S]{0,120}fn ${c}\\(`).test(mainrs) &&
        /generate_handler!\[[^\]]*\brepo_tree\b[^\]]*\brepo_file_read\b[^\]]*\brepo_list\b[^\]]*\]/.test(mainrs)
    ),
  },
  {
    id: "rust-shape",
    what: "取数侧的三条边界写在码里：issue 列表滤掉 PR、树 4000 条封顶、单文件 200KB 封顶",
    pass: /pull_request/.test(rust) && /4_000/.test(rust) && /200_000/.test(rust),
  },
  {
    id: "rust-cache",
    what: "四类缓存 TTL 各自独立（分支 1 天 / 树 1 小时 / 文件 6 小时 / 列表 10 分钟），不是一刀切",
    pass: /86_400/.test(rust) && /3_600/.test(rust) && /6 \* 3_600/.test(rust) && /600\b/.test(rust),
  },
  {
    id: "ipc-types",
    what: "bridge.ts 里三条命令有类型化的出入口（字段名跟 feed.rs 的 json! 键对齐）",
    pass: /repo_tree/.test(bridge) && /repo_file_read/.test(bridge) && /repo_list/.test(bridge) &&
      /TreeResult/.test(bridge) && /FileResult/.test(bridge) && /ListItem/.test(bridge),
  },
  {
    id: "repo-nav",
    what: "详情页的导航只剩三个页签：概览 / Issues / Pull requests（文件不再是页签）",
    pass: /概览/.test(detail) && /Issues/.test(detail) && /Pull requests/.test(detail) && !/value: "files"/.test(detail),
  },
  {
    id: "tree-in-sidebar",
    what: "文件树长在概览那一屏里（RepoTreeBox），选中文件后左栏切成预览（FilePreview）",
    pass: (() => {
      // 把"概览"那一支切出来看：树和预览必须都在它里面，而不是另起一个页签/一屏
      const ov = detail.slice(detail.indexOf('tab === "overview"'), detail.indexOf('tab === "issues"'));
      return ov.includes("RepoTreeBox") && ov.includes("FilePreview") && /f\.sel \?/.test(ov);
    })(),
  },
  {
    id: "preview-return",
    what: "预览是双向的：能给回 README，不是一条单向路",
    pass: /返回 README/.test(treex) && /backToReadme/.test(treex),
  },
  {
    id: "tree-collapse",
    what: "文件树是扁平路径自己拼出层级、目录可展开收起（recursive 一次拿全，前端不逐层请求）",
    pass: /function buildTree|const buildTree/.test(treex) && /expand|collapsed|open/.test(treex) &&
      !/git\/trees\//.test(treex),
  },
  {
    id: "preview-guard",
    what: "代码预览有护栏：二进制不塞进界面、行数封顶、被截断要说",
    pass: /binary/.test(treex) && /MAX_LINES|slice\(0,\s*\d+\)/.test(treex) && /truncated/.test(treex),
  },
  {
    id: "tree-look",
    what: "树是 IDE 侧栏那种摆法：行上没有通栏分隔线、缩进有 1px 引导线、选中态是左侧主色条（不是把原文加粗当选中）",
    pass: (() => {
      // 只查"行"那一串 class：预览区的脚注该有 border-t，那是另一回事
      const rowBase = (treex.match(/const rowBase\s*=\s*\n?\s*"([^"]+)"/) || [])[1] ?? "";
      return rowBase.length > 0 && !rowBase.includes("border-b") &&
        /border-s border-border/.test(treex) && /w-0\.5[\s\S]{0,40}bg-primary/.test(treex) && /h-7/.test(treex);
    })(),
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

// ------------------------------------------------------------------ --live
// 上面全是"源码里有没有这句话"级别的断言，钉不住取数本身对不对。加 --live 会真的
// 驱动 collect.exe 打一次 GitHub，把四条行为事实钉住：树拿得到、文件读得动、
// issue 列表不把 PR 混进来、第二次读命中缓存（这条是配额保护，不测就等于没做）。
// 要联网、要已构建的 debug 产物，所以默认不跑：node check-skin.mjs --live
const liveArg = process.argv.find((a) => a === "--live" || a.startsWith("--live="));
if (liveArg) {
  const { execFileSync } = await import("node:child_process");
  const exe = join(web, "..", "src-tauri", "target", "debug", "collect.exe");
  const LIVE = [];
  if (!existsSync(exe)) {
    console.log("\n### --live：collect.exe 不在，先跑 cargo build --bin collect");
  } else {
    const run = (a) => execFileSync(exe, a, { encoding: "utf8", timeout: 180_000, maxBuffer: 32e6 });
    const raw = (a) => {
      const out = run(a);
      const line = out.split("\n").find((l) => l.startsWith("RAW "));
      return { out, v: line ? JSON.parse(line.slice(4)) : null };
    };
    let id = Number(liveArg.split("=")[1]) || 0;
    if (!id) {
      // 优先挑一个既有 issue 又有 PR 的仓库，否则"两边编号不相交"这条会空过
      const list = run(["repos", "400"]);
      id = Number((list.match(/id=(\d+)\s+react\/react\b/) || list.match(/id=(\d+)/) || [])[1]);
    }
    try {
      const t = raw(["tree", String(id)]);
      LIVE.push(["tree 拿得到条目", !!t.v && t.v.count > 0 && t.v.entries.every((e) => typeof e.path === "string" && typeof e.dir === "boolean") && !!t.v.branch]);
      const f0 = t.v.entries.find((e) => !e.dir && /\.md$/i.test(e.path)) || t.v.entries.find((e) => !e.dir);
      const f = raw(["file", String(id), f0.path]);
      LIVE.push(["file 读得出内容（文本有字节，二进制就明说不预览）",
        !!f.v && f.v.bytes > 0 && (f.v.binary ? f.v.text === "" : f.v.text.length > 0)]);
      const i = raw(["list", String(id), "issue"]);
      const p = raw(["list", String(id), "pull"]);
      const inum = new Set((i.v?.items ?? []).map((x) => x.number));
      const pnum = new Set((p.v?.items ?? []).map((x) => x.number));
      const mixed = [...inum].filter((x) => pnum.has(x));
      LIVE.push([`issue 列表没混进 PR（issue ${inum.size} 条 / pull ${pnum.size} 条，交集 ${mixed.length}）`,
        inum.size > 0 && pnum.size > 0 && mixed.length === 0]);
      const again = run(["tree", String(id)]);
      LIVE.push(["第二次读树命中缓存，不再打 API", again.includes("命中 1 小时缓存")]);
    } catch (e) {
      LIVE.push(["live 跑通了（上面若有 FAIL 是这条没执行）", false]);
      console.log("  live 异常：" + String(e).slice(0, 200));
    }
    console.log(`\n### --live（repo id=${id}，真打 GitHub）`);
    for (const [what, ok] of LIVE) {
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
      ok ? pass++ : fail++;
    }
  }
}

console.log(`\n=== 合计 ${pass} 通过 / ${fail} 失败 ===`);
if (!existsSync(assetsDir)) console.log("（dist 不在，先跑 corepack pnpm@10 --filter web build）");
process.exit(mode === "baseline" ? 0 : fail ? 1 : 0);

