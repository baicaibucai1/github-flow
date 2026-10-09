// 临时渲染探针：验仓库详情页的摆法与应用内的 issue / PR / Actions。
// 数据是这里现编的（形状照 feed.rs 的 json! 键写），所以它测的是前端而不是网络。
// 复跑：corepack pnpm@10 --filter web exec vite --port 1430 —— 浏览器开 http://localhost:1430/probe.html
//      加 ?keep=1 则不卸载、不画结果浮层，方便人肉看布局。
import { createRoot } from "react-dom/client";
import "./styles.css";
import { DetailView } from "./views/DetailView";
import { FeedView } from "./views/FeedView";
import { StatsView } from "./views/StatsView";
import { initStore } from "./lib/store";
import { SHOT } from "./shotdata";

const TREE = {
  branch: "main",
  count: 9,
  truncated: false,
  entries: [
    { path: ".github", dir: true, size: 0 },
    { path: ".github/FUNDING.yml", dir: false, size: 40 },
    { path: "README.md", dir: false, size: 120 },
    { path: "docs", dir: true, size: 0 },
    { path: "docs/guide.md", dir: false, size: 90 },
    { path: "docs/img", dir: true, size: 0 },
    { path: "docs/img/logo.png", dir: false, size: 3000 },
    { path: "src", dir: true, size: 0 },
    { path: "src/main.rs", dir: false, size: 44 },
  ],
};

// README 的 HTML 形状照 GitHub html+json 的实测输出：标题**没有 id**、代码块是
// div.highlight.highlight-source-shell、相对链接已被 Rust 补成 blob 页（这里再留一个
// 没补的 docs/guide.md，模拟 7 天缓存里的老数据，前端一样要在应用内接住）。
const README_HTML =
  "<h1 class=\"heading-element\" dir=\"auto\">探针 MangoDisk</h1>" +
  "<p><a href=\"https://github.com/probe/repo/blob/main/README.zh-CN.md\">简体中文</a> " +
  "<a href=\"docs/guide.md\">指南</a> <a href=\"#功能\">功能</a> " +
  "<a href=\"https://probe.example.com/home\">主页</a></p>" +
  "<h2 class=\"heading-element\" dir=\"auto\">功能</h2><p>这一节讲功能。</p>" +
  "<div class=\"highlight highlight-source-shell notranslate position-relative overflow-auto\" dir=\"auto\"><pre>brew install mangodisk</pre></div>" +
  "<div class=\"snippet-clipboard-content notranslate position-relative overflow-auto\"><pre class=\"notranslate\"><code>裸围栏没有语言</code></pre></div>";

const FILES: Record<string, { raw?: unknown; html?: string }> = {
  "src/main.rs": { raw: { path: "src/main.rs", bytes: 44, truncated: false, binary: false, text: 'fn main() {\n  println!("探针");\n}\n' } },
  "README.md": {
    raw: { path: "README.md", bytes: 120, truncated: false, binary: false, text: "# 探针仓库\n第二行源码\n第三行源码" },
    html: "<h1 class=\"heading-element\">探针仓库渲染版</h1><p>渲染后的第一段</p>" +
      "<div class=\"highlight highlight-source-python notranslate\"><pre>print(1)</pre></div>",
  },
  "README.zh-CN.md": {
    raw: { path: "README.zh-CN.md", bytes: 130, truncated: false, binary: false, text: "# 简体中文源码" },
    html: "<h1 class=\"heading-element\">简体中文</h1><p>这是渲染出来的中文正文</p>",
  },
  "docs/guide.md": {
    raw: { path: "docs/guide.md", bytes: 90, truncated: false, binary: false, text: "# 指南源码" },
    html: "<h1 class=\"heading-element\">指南</h1><p>指南的渲染正文</p>",
  },
  "docs/img/logo.png": { raw: { path: "docs/img/logo.png", bytes: 3000, truncated: false, binary: true, text: "" } },
};

const DETAIL = {
  id: 123,
  full_name: "probe/repo",
  description: "a probe repo",
  url: "https://github.com/probe/repo",
  stars: 42,
  forks: 3,
  open_issues: 4,
  subscribers: 5,
  language: "Rust",
  window: "hot",
  age_days: 30,
  weeks: [1, 2, 3],
  langs: ["Rust 90.0%"],
  releases: "v1.0|首个版本|2026-01-01",
  readme_html: README_HTML,
  readme_path: "README.md",
  saved: false,
};

const LIST: Record<string, unknown> = {
  issue: {
    kind: "issue",
    count: 2,
    items: [
      { number: 11, title: "探针 issue 一", author: "alice", created_at: "2026-10-01T00:00:00Z", comments: 2, draft: false, labels: ["bug"] },
      { number: 12, title: "探针 issue 二", author: "bob", created_at: "2026-10-02T00:00:00Z", comments: 0, draft: false, labels: [] },
    ],
  },
  pull: {
    kind: "pull",
    count: 1,
    items: [
      { number: 21, title: "探针 PR 一", author: "carol", created_at: "2026-10-03T00:00:00Z", comments: 1, draft: true, labels: ["docs"] },
    ],
  },
};

const ISSUE_DETAIL = {
  number: 11,
  is_pull: false,
  title: "探针 issue 一",
  url: "https://github.com/probe/repo/issues/11",
  state: "open",
  author: "alice",
  created_at: "2026-10-01T00:00:00Z",
  closed_at: "",
  comments: 1,
  labels: [{ name: "bug", color: "d73a4a" }],
  body_html: "<p>探针 issue 正文</p>",
  reactions: 2,
};

const PR_DETAIL = {
  number: 21,
  title: "探针 PR 一",
  url: "https://github.com/probe/repo/pull/21",
  state: "open",
  draft: false,
  merged: false,
  mergeable_state: "clean",
  author: "carol",
  created_at: "2026-10-03T00:00:00Z",
  base: "main",
  head: "feat/probe",
  additions: 12,
  deletions: 3,
  changed_files: 1,
  commits: 1,
  review_comments: 0,
  labels: [{ name: "docs", color: "0075ca" }],
  body_html: "<p>探针 PR 正文</p>",
};

const PR_FILES = {
  count: 1,
  truncated: false,
  items: [
    {
      filename: "src/a.ts",
      status: "modified",
      additions: 12,
      deletions: 3,
      changes: 15,
      patch: "@@ -1,3 +1,3 @@\n-旧行要删掉\n+新行加进来",
      patch_truncated: false,
      binary: false,
    },
  ],
};

const RUNS = {
  total: 2,
  count: 2,
  items: [
    { id: 1, name: "CI", title: "修个 bug (#7)", status: "completed", conclusion: "success", event: "push", branch: "main", run_number: 7, created_at: "2026-10-05T00:00:00Z", url: "https://github.com/probe/repo/actions/runs/1" },
    { id: 2, name: "Release", title: "发布 v1.0", status: "completed", conclusion: "failure", event: "push", branch: "main", run_number: 6, created_at: "2026-10-04T00:00:00Z", url: "https://github.com/probe/repo/actions/runs/2" },
  ],
};

// 发现页一屏给 12 条：超过单次翻译的 8 条上限，才能验出"发完一批就不续跑"那个坑
const FEED = Array.from({ length: 12 }, (_, i) => ({
  id: 101 + i,
  full_name: `probe/repo-${i + 1}`,
  description: `Description number ${i + 1} for the probe repository`,
  language: "Rust",
  topics: ["probe"],
  url: `https://github.com/probe/repo-${i + 1}`,
  stars: 500 + i,
  forks: 3,
  open_issues: 2,
  subscribers: 4,
  window: "7d",
  age_days: 12,
  slope: 40,
  curvature: 1.2,
  score: 0.9 - i / 100,
  spam: false,
  channel: i % 4 === 1 ? "profile" : "hot",
  lang_hit: true,
  saved: false,
  seen: false,
  weeks: [1, 2, 3],
  why: ["热度上升"],
}));

const calls: string[] = [];
const notices: string[] = [];
const trCalls: number[] = [];
// ?shot=feed|detail 是"给 README 出图"的模式：渲染真数据、不跑断言、不画浮层
const SHOT_MODE = new URLSearchParams(location.search).get("shot") ?? "";
const dwells: { ms: number; readDepth: number; tab: string }[] = [];
const w = window as unknown as { __TAURI_INTERNALS__: unknown; __PROBE__?: unknown };w.__TAURI_INTERNALS__ = {
  transformCallback: (cb: () => void) => cb,
  unregisterCallback: () => undefined,
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push(`${cmd}:${args?.path ?? args?.kind ?? args?.url ?? ""}${args?.mode ? "(" + args.mode + ")" : ""}`);
    if (SHOT_MODE) {
      // 出图模式喂真数据；翻译关掉，否则卡上会显示假译文"中文·…"
      if (cmd === "get_channel")
        // 出图取 6 张有简介的：门面图第一格是"（无简介）"很难看；六张一屏放得下，也不会拍到还没解码的图
        return ((SHOT.cards as { seen: boolean; description?: string }[]) ?? [])
          .filter((c) => !!c.description)
          .slice(0, 6)
          .map((c) => ({ ...c, seen: false }));
      if (cmd === "get_detail") return SHOT.detail;
      if (cmd === "repo_tree") return SHOT.tree;
      if (cmd === "repo_list")
        return (SHOT.lists as Record<string, unknown>)?.[String(args?.kind)] ?? { kind: args?.kind, count: 0, items: [] };
      if (cmd === "settings_json") return { refill_on: "1", translate_on: "0", theme: "light", set: "github" };
    }
    if (cmd === "get_detail") return DETAIL;
    if (cmd === "repo_tree") return TREE;
    if (cmd === "repo_file_read") {
      const e = FILES[args.path as string];
      const dirOf = (p: string) => (p.includes("/") ? p.split("/").slice(0, -1).join("/") : "");
      if (args.mode === "html") {
        return e?.html
          ? { path: args.path, bytes: 400, truncated: false, binary: false, text: "", html: e.html, base_path: dirOf(String(args.path)) }
          : { path: args.path, bytes: 0, truncated: false, binary: false, text: "", error: "这份没有渲染版" };
      }
      return e?.raw ?? { path: args.path, bytes: 0, truncated: false, binary: false, text: "" };
    }
    if (cmd === "repo_list") return LIST[args.kind as string];
    if (cmd === "issue_detail") return ISSUE_DETAIL;
    if (cmd === "pr_detail") return PR_DETAIL;
    if (cmd === "pr_files") return PR_FILES;
    if (cmd === "issue_comments") return { count: 1, items: [{ author: "bob", association: "MEMBER", created_at: "2026-10-02T00:00:00Z", body_html: "<p>探针评论正文</p>" }] };
    if (cmd === "actions_runs") return RUNS;
    if (cmd === "refill_now")
      return { channel: "profile", inserted: 7, core_used: 8, search_used: 6, note: "", pool_before: 4762, pool_after: 4769 };
    if (cmd === "get_channel") return FEED;
    if (cmd === "do_translate") {
      const ts = (args.texts as string[]) ?? [];
      trCalls.push(ts.length);
      return { map: Object.fromEntries(ts.map((t) => [t, "中文·" + t.slice(0, 18)])), net: ts.length, cached: 0, failed: 0 };
    }
    if (cmd === "open_in_app_window") return "已打开应用内浏览窗口";
    // 统计页要用
    if (cmd === "get_stats")
      return { pool: 4045, ranked: 100, impressions: 306, reach: 37, sessions: 39, opens: 29, hides: 0, saved: 0, login: "probe", db: "C:/probe.db" };
    if (cmd === "refill_status")
      return {
        pool: 4045, enabled: true, next_step: 3, social_sources: 31, profile_terms: 350,
        last: [
          { at: Math.floor(Date.now() / 1000) - 120, step: 2, channel: "explore", core_used: 6, search_used: 6, inserted: 6 },
          { at: Math.floor(Date.now() / 1000) - 600, step: 1, channel: "hot", core_used: 12, search_used: 9, inserted: 38 },
        ],
      };
    if (cmd === "get_counts") return { all: 900, hot: 800, profile: 587, social: 1923, explore: 40, saved: 0, pool: 4045, last_collect: 0, last_refill: 0 };
    if (cmd === "me_report")
      return { login: "probe", terms: [], langs: [], min_n: 20, profile_hits: 0, starred_snapshot: 0, saved: 0, hides: 0, kinds: [], hide_reasons: [], buckets: [], fitted_at: 0 };
    if (cmd === "settings_json") return { refill_on: "1", translate_on: "1", theme: "light", set: "github" };
    if (cmd === "log_event" && args.kind === "dwell") dwells.push(JSON.parse(String(args.payload)));
    return {};
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txt = () => document.body.innerText;
const one = (sel: string, s?: string) =>
  [...document.querySelectorAll(sel)].find((e) => (s ? (e.textContent ?? "").trim().startsWith(s) : true)) as HTMLElement | undefined;
/** 改名：按"包含"找。diff 的文件行前面还有状态词（modified），用 startsWith 会找不到 */
const has = (sel: string, s: string) =>
  [...document.querySelectorAll(sel)].find((e) => (e.textContent ?? "").includes(s)) as HTMLElement | undefined;
/** 找那个 Box：它的表头文字以 title 开头 */
const box = (title: string) =>
  [...document.querySelectorAll("section")].find((s) => (s.querySelector("h2")?.textContent ?? "") === title) as HTMLElement | undefined;
const externalCalls = () => calls.filter((c) => c.startsWith("open_url"));

async function run() {
  const R: [string, boolean, string][] = [];
  const ok = (name: string, cond: boolean, note = "") => R.push([name, !!cond, note]);
  const click = async (el: HTMLElement | undefined, ms = 200) => {
    el?.click();
    await sleep(ms);
  };

  const root = createRoot(document.getElementById("root")!);
  root.render(<DetailView repoId={123} onBack={() => undefined} onNotice={(m) => notices.push(m)} />);
  await sleep(600);

  // ---- 摆法：树在右栏、不做页签，导航是 GitHub 那一排
  const navLabels = [...document.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim());
  ok("导航是四项：概览 / Issues / Pull requests / Actions（文件不是页签）",
    navLabels.length === 4 &&
      ["概览", "Issues", "Pull requests", "Actions"].every((t) => navLabels.some((l) => l.startsWith(t))),
    navLabels.join(" | "));
  ok("树在右栏，进页面就在（不用点任何页签）", !!box("文件") && txt().includes(".github") && txt().includes("README.md"));
  ok("右栏的树与左栏的 README 同屏", !!box("文件") && !!box("README") && txt().includes("这一节讲功能"));
  ok("树的请求只发一次", calls.filter((c) => c.startsWith("repo_tree")).length === 1, calls.join(","));
  ok("树排在 README 之后（宽视口下即在右侧）",
    (() => {
      const t = box("文件")!, r = box("README")!;
      const wide = innerWidth >= 1024;
      const after = (r.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return wide ? t.getBoundingClientRect().left > r.getBoundingClientRect().left : after;
    })(),
    `视口宽 ${innerWidth}（${innerWidth >= 1024 ? "按左右判" : "窄，按 DOM 顺序判"}）`);
  ok("子目录默认收起（展开才看得到里层）", !txt().includes("FUNDING.yml"));

  // ---- 他点的第三条：代码块没有标注（GitHub 的 HTML 里语言在类名里，界面没用起来）
  const heads = () => [...document.querySelectorAll(".codehead")].map((e) => (e.textContent ?? "").trim());
  ok("README 的代码块有语言标注条：声明了的取 highlight-source-*，裸围栏写「代码」",
    heads().join(",") === "shell,代码", heads().join("|"));
  // ---- 他点的第一条：README 里点「简体中文」没反应（第三方 HTML 的相对链接被 open_url 挡了）
  ok("GitHub 渲染的标题没有 id，我们补了 slug 锚点才落得了地", !!document.getElementById("功能"));
  await click(has("a", "功能"), 260);
  ok("点目录锚点在应用内滚过去：没有notice、也没甩浏览器",
    notices.length === 0 && externalCalls().length === 0, notices.join("|"));
  await click(has("a", "简体中文"), 420);
  ok("点 README 的文件链接进左栏渲染预览（不是开浏览器）",
    txt().includes("这是渲染出来的中文正文") &&
      calls.some((c) => c === "repo_file_read:README.zh-CN.md(html)") && externalCalls().length === 0,
    calls.slice(-3).join(","));
  await click(one("button", "返回 README"), 300);
  await click(has("a", "指南"), 420);
  ok("老缓存里没补全的相对链接同样在应用内接住",
    txt().includes("指南的渲染正文") && calls.some((c) => c === "repo_file_read:docs/guide.md(html)"),
    calls.slice(-3).join(","));
  await click(one("button", "返回 README"), 300);
  await click(has("a", "主页"), 320);
  ok("站外链接开应用内窗口，一样不切系统浏览器",
    calls.some((c) => c.startsWith("open_in_app_window:")) && externalCalls().length === 0, calls.slice(-2).join(","));

  // ---- 树：点文件 → 左栏预览
  await click(one("button", "README.md"), 320);
  ok("点 md 默认给渲染版，不是源码", txt().includes("渲染后的第一段") && !txt().includes("第二行源码"));
  ok("点 md 发的是 html 模式请求", calls.some((c) => c === "repo_file_read:README.md(html)"), calls.slice(-3).join(","));
  ok("渲染版里的代码块同样带语言标注", heads().includes("python"), heads().join("|"));
  await click(one("button", "看源码"), 320);
  ok("「看源码」切回带行号的原文", txt().includes("第二行源码") && txt().includes("第三行源码"));
  ok("预览出现时 README 让位", !box("README"));
  await click(one("button", "返回 README"), 300);
  ok("返回 README 后左栏还原", !!box("README") && txt().includes("这一节讲功能"));

  // ---- issue：点开进应用内详情（不跳浏览器）
  await click(one("nav button", "Issues"), 320);
  ok("Issues 页签列出两条，计数进胶囊", txt().includes("探针 issue 一") && (one("nav button", "Issues")?.textContent ?? "").includes("2"));
  await click(one("button", "探针 issue 一"), 420);
  ok("点一条 issue 进应用内详情（正文 + 评论都在）",
    txt().includes("探针 issue 正文") && txt().includes("探针评论正文") && txt().includes("bug"));
  ok("详情页标出状态与作者", txt().includes("open") && txt().includes("alice") && txt().includes("#11"));
  ok("拉过 issue 详情与评论各一次", calls.filter((c) => c === "issue_detail:").length === 1 && calls.filter((c) => c === "issue_comments:").length === 1, calls.join(","));
  ok("这一整段没有把用户甩到系统浏览器", externalCalls().length === 0, externalCalls().join(","));
  await click(one("button", "返回列表"), 260);
  ok("返回列表回到 issue 列表", !!box("Issues") && txt().includes("探针 issue 二") && !txt().includes("探针 issue 正文"));

  // ---- PR：点开看改动量与 diff
  await click(one("nav button", "Pull requests"), 320);
  await click(one("button", "探针 PR 一"), 420);
  ok("PR 详情带改动量统计", txt().includes("探针 PR 正文") && txt().includes("+12") && txt().includes("−3"));
  ok("PR 列出变更文件，文件名在", txt().includes("src/a.ts") && txt().includes("feat/probe"));
  await click(has("button", "src/a.ts"), 260);
  ok("展开文件看到 diff 的增删行", txt().includes("@@ -1,3 +1,3 @@") && txt().includes("新行加进来") && txt().includes("旧行要删掉"));
  ok("PR 这段也没跳系统浏览器", externalCalls().length === 0, externalCalls().join(","));

  // ---- Actions：应用内读列表
  await click(one("nav button", "Actions"), 320);
  ok("Actions 页签在应用内列出运行", txt().includes("CI") && txt().includes("成功") && txt().includes("失败"));

  // ---- 三个 REST 拿不到的不再出现在导航里（他 2026-10-06："先去掉吧"）
  ok("导航里没有 Projects / Security / Insights",
    !["Projects", "Security", "Insights"].some((t) => navLabels.some((l) => l.startsWith(t))),
    navLabels.join(" | "));

  await click(one("nav button", "概览"), 320);
  ok("切回概览：树还在（没被卸载重取）", !!box("文件") && calls.filter((c) => c.startsWith("repo_tree")).length === 1,
    calls.filter((c) => c.startsWith("repo_tree")).join(","));
  ok("整轮流程没有把用户甩到系统浏览器", externalCalls().length === 0, externalCalls().join(","));

  // ---- 发现页的两条（他 2026-10-07）：整行可点、翻译要把一屏翻完
  initStore();
  const feedEl = document.createElement("div");
  feedEl.id = "probe-feed";
  // 网格是按**容器宽度**出列的，所以这里给一个固定宽度（接近应用里主区的真实宽度）：
  // 探针结果不该取决于这个调试浏览器窗口多宽
  feedEl.style.cssText = "width:900px";
  document.body.appendChild(feedEl);
  const opens: number[] = [];
  trCalls.length = 0;
  createRoot(feedEl).render(
    <FeedView channel="hot" onOpen={(i) => opens.push(i)} onNotice={(m) => notices.push("feed:" + m)} />
  );
  await sleep(30);
  ok("图还在路上时，每张卡右下角先挂一个加载标志（不标出来就像这仓库没图）",
    feedEl.querySelectorAll("[data-og-load]").length === 12,
    String(feedEl.querySelectorAll("[data-og-load]").length));
  await sleep(600);
  ok("发现页 12 条都渲染出来", feedEl.innerText.includes("probe/repo-1") && feedEl.innerText.includes("probe/repo-12"));
  const gridEl = feedEl.querySelector("div.grid") as HTMLElement | null;
  const cols = gridEl ? getComputedStyle(gridEl).gridTemplateColumns.split(" ").length : 0;
  ok("发现页按容器宽度出**双列**卡片（不是单列连续流）", cols === 2, `列数=${cols}，容器宽 ${gridEl?.clientWidth ?? 0}，视口宽 ${innerWidth}`);
  const imgs = [...feedEl.querySelectorAll("article img")] as HTMLImageElement[];
  ok("每张卡顶部是 GitHub 自己的 OG 预览图，并且是懒加载",
    imgs.length === 12 && imgs.every((im) => (im.getAttribute("src") ?? "").startsWith("https://opengraph.githubassets.com/1/probe/repo-") && im.getAttribute("loading") === "lazy"),
    imgs.length + " 张图");
  ok("卡图对齐**顶部**而不是居中（居中裁会把 OG 图里的头像切一半）",
    imgs.every((im) => getComputedStyle(im).objectPosition.replace(/\s+/g, " ").endsWith("0%")),
    imgs.length ? getComputedStyle(imgs[0]).objectPosition : "没有图");
  ok("同一行的两张卡顶边齐平（卡片高度一致才谈得上扫读）",
    (() => {
      const a = imgs[0].getBoundingClientRect(), b = imgs[1].getBoundingClientRect();
      return Math.abs(a.top - b.top) < 1 && b.left > a.left;
    })(),
    imgs.length > 1 ? `卡1 x=${Math.round(imgs[0].getBoundingClientRect().left)} 卡2 x=${Math.round(imgs[1].getBoundingClientRect().left)}` : "");
  // OG 图会限流（实测撞过 429）：取不到要换成 GitHub 自己的标，而不是灰字或裂图
  imgs[0].dispatchEvent(new Event("error"));
  await sleep(120);
  const cover0 = feedEl.querySelectorAll("[data-og]")[0];
  ok("图取不到时换成 GitHub 的标（octicon mark-github），卡片其余内容照常",
    !!cover0.querySelector('svg[aria-label="GitHub"]') && !cover0.querySelector("img") &&
      feedEl.innerText.includes("probe/repo-1"),
    cover0 ? cover0.innerHTML.slice(0, 60) : "没有图区");
  await click(feedEl.querySelector("p") as HTMLElement, 200);
  ok("点整张卡（简介那一块）就进详情", opens.length === 1 && opens[0] === 101, opens.join(","));
  const before = opens.length;
  await click(
    [...feedEl.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("收藏")) as HTMLElement,
    260
  );
  ok("点「收藏」只收藏、不会顺带把详情页打开",
    opens.length === before && notices.some((m) => m.startsWith("feed:已收藏")), opens.join(","));
  await sleep(2600);
  ok("翻译发完一批会接着发下一批（12 条 = 8 + 4，而不是只发 8 就停）", trCalls.join("+") === "8+4", trCalls.join(","));
  ok("一屏 12 条简介最后都显示成中文",
    [...feedEl.querySelectorAll("p")].filter((p) => (p.textContent ?? "").startsWith("中文·")).length === 12,
    [...feedEl.querySelectorAll("p")].slice(0, 2).map((p) => p.textContent).join(" / "));

  // ---- 「刷新」：先补一轮再重读本屏（只重排本机已有的不叫刷新）
  const chBefore = calls.filter((c) => c.startsWith("get_channel")).length;
  await click(
    [...feedEl.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("刷新")) as HTMLElement,
    900
  );
  ok(
    "点「刷新」会先跑一步补货、再重读本屏，并把真实请求数与池子变化回显成一句话",
    calls.filter((c) => c === "refill_now:").length === 1 &&
      calls.filter((c) => c.startsWith("get_channel")).length > chBefore &&
      notices.some((m) => m.includes("补了一轮：通道 profile 新增 7 条") && m.includes("core 8 / search 6") && m.includes("4762 → 4769")),
    calls.slice(-3).join(",")
  );

  // ---- 统计页的补货面板（换一个 root 渲染，不再碰 DetailView）
  const box2 = document.createElement("div");
  box2.id = "probe-stats";
  document.body.appendChild(box2);
  createRoot(box2).render(<StatsView />);
  await sleep(700);
  const sv = () => box2.innerText;
  ok("统计页有「静默补货」这一块，并写明抓进来的量远大于展示量",
    sv().includes("静默补货") && /池子\s*4,?045/.test(sv()) && sv().includes("远大于展示量"));
  ok("补货面板显示画像词表与相似用户源", sv().includes("画像词表 350") && sv().includes("相似用户源 31"));
  ok("补货面板列出最近几轮的用量（哪个通道、新增多少、请求几次）",
    sv().includes("explore") && sv().includes("新增 6") && sv().includes("core 12"));
  ok("有「现在补一轮」按钮", sv().includes("现在补一轮"));
  ok("四档通道里出现「相似用户」这一档", sv().includes("相似用户") && /1,?923/.test(sv()));

  const keep = new URLSearchParams(location.search).has("keep");
  if (!keep) {
    root.unmount();
    await sleep(300);
    const last = dwells[dwells.length - 1];
    ok("dwell 带得清是哪个页签", !!last && last.tab === "overview" && last.ms >= 1000, JSON.stringify(last ?? {}));
  }

  w.__PROBE__ = R;
  if (!keep) showResults(R, calls, errs);
  else document.title = `LOOK ${R.filter(([, p]) => p).length}/${R.length}`;
  return R;
}

/** 结果直接写在页面上：他打开这个地址就能自己看哪条绿哪条红。 */
function showResults(R: [string, boolean, string][], calls: string[], errs: string[]) {
  const boxEl = document.createElement("div");
  boxEl.style.cssText =
    "position:fixed;right:8px;top:8px;z-index:9999;max-width:430px;max-height:96vh;overflow:auto;" +
    "background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:6px;padding:10px;" +
    "font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 6px 24px rgba(31,35,40,.18)";
  const n = R.filter(([, p]) => p).length;
  const line = (text: string, color: string, bold = false) => {
    const d = document.createElement("div");
    d.textContent = text;
    d.style.color = color;
    if (bold) d.style.fontWeight = "700";
    boxEl.appendChild(d);
  };
  line(`仓库详情页渲染探针：${n} 通过 / ${R.length - n} 失败`, "#1f2328", true);
  for (const [name, pass, note] of R) line(`${pass ? "PASS" : "FAIL"} ${name}${note ? " —— " + note : ""}`, pass ? "#1a7f37" : "#cf222e");
  line(`console 错误 ${errs.length} 条${errs.length ? "：" + errs.join(" | ") : ""}`, "#656d76");
  line(`IPC 序列：${calls.join(" → ")}`, "#656d76");
  document.body.appendChild(boxEl);
  document.title = (n === R.length ? "PROBE PASS " : "PROBE FAIL ") + `${n}/${R.length}`;
}

const errs: string[] = [];
window.addEventListener("error", (e) => errs.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => errs.push("reject " + String(e)));

/** 给 README 出图：固定 1200px 宽（接近应用主区真实宽度），只渲染一个视图，等图落地 */
async function renderShot(which: string) {
  initStore();
  document.body.style.cssText = "width:1200px;margin:0;background:var(--background);overflow-x:hidden";
  // 出图时关掉所有过渡：卡图有 300ms 淡入，无头浏览器在 load 事件那一刻就拍，
  // 拍到的是 opacity≈0 的"空白图区"（上一版八张全白就是这么来的）
  const st = document.createElement("style");
  st.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(st);
  // 这台机器直连 github.com 不通（只有走代理才通），而出图用的浏览器实例没配代理，
  // 所以 OG 卡图先在本地留一份（web/public/shots/，已 gitignore，复现命令见 README 配图一节）。
  // 换 src 不能事后改属性 —— React 下一次渲染就给你写回远端地址（试过，图还是全裂）。
  // 这里只在出图页面里拦一次 setter：赋值为远端 URL 时改成本地副本，应用代码一行没动。
  const local = (v: string) => {
    const m = String(v).match(/^https:\/\/opengraph\.githubassets\.com\/1\/(.+)$/);
    return m ? `/shots/${m[1].replace(/\//g, "_")}.png` : v;
  };
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")!;
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    get: d.get,
    set(v: string) {
      d.set!.call(this, local(v));
    },
  });
  // 光靠事后循环改 loading 还是会漏掉视口外的：出图页一律即时加载（应用里仍是懒加载）
  const ld = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "loading")!;
  Object.defineProperty(HTMLImageElement.prototype, "loading", {
    get: ld.get,
    set() {
      ld.set!.call(this, "eager");
    },
  });
  const root = createRoot(document.getElementById("root")!);
  const noop = () => undefined;
  // 先把本地副本灌进 HTTP 缓存再渲染：无头浏览器里懒加载 + 虚拟时间会抢不过截图那一刻，
  // 上一版就是这么拍出"八张卡只有一张有图"的
  await Promise.all(
    ((SHOT.cards as { full_name: string }[]) ?? []).map(
      (c) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.onload = () => res();
          im.onerror = () => res();
          im.src = local(`https://opengraph.githubassets.com/1/${c.full_name}`);
        })
    )
  );
  if (which === "feed") {
    root.render(<FeedView channel="hot" onOpen={noop} onNotice={noop} />);
  } else if (which === "detail") {
    root.render(<DetailView repoId={Number(SHOT.detail?.id ?? 1)} onBack={noop} onNotice={noop} />);
  }
  const painted = async () => {
    const im = [...document.querySelectorAll("article img, .md img")] as HTMLImageElement[];
    await Promise.all(im.map((x) => x.decode().catch(() => null)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  };
  for (let i = 0; i < 60; i++) {
    const im = [...document.querySelectorAll("article img")] as HTMLImageElement[];
    // 出图页的 body 宽 1200px，而这个浏览器窗口只有 ~550px —— 视口外的懒加载图根本不发请求
    im.forEach((x) => (x.loading = "eager"));
    if (im.length && im.every((x) => x.complete && x.naturalWidth > 0)) break;
    await sleep(150);
  }
  // 无头截图的时机不靠定时器（虚拟时间会把 sleep 瞬间跑完，真网络还没回来），
  // 而是等每张图 decode() 完 + 两帧 rAF —— 这些是真实任务，虚拟时间必须等它们
  await painted();
  const imgs = [...document.querySelectorAll("img")];
  document.title = `SHOT ${which} 图 ${imgs.filter((i) => i.complete && i.naturalWidth).length}/${imgs.length}`;
  await painted();
}

if (SHOT_MODE) await renderShot(SHOT_MODE);
else await run();
