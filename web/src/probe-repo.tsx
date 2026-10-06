// 临时渲染探针：验仓库详情页的摆法与应用内的 issue / PR / Actions。
// 数据是这里现编的（形状照 feed.rs 的 json! 键写），所以它测的是前端而不是网络。
// 复跑：corepack pnpm@10 --filter web exec vite --port 1430 —— 浏览器开 http://localhost:1430/probe.html
//      加 ?keep=1 则不卸载、不画结果浮层，方便人肉看布局。
import { createRoot } from "react-dom/client";
import "./styles.css";
import { DetailView } from "./views/DetailView";
import { StatsView } from "./views/StatsView";
import { initStore } from "./lib/store";

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

const FILES: Record<string, unknown> = {
  "src/main.rs": { path: "src/main.rs", bytes: 44, truncated: false, binary: false, text: 'fn main() {\n  println!("探针");\n}\n' },
  "README.md": { path: "README.md", bytes: 120, truncated: false, binary: false, text: "# 探针仓库\n第二行\n第三行" },
  "docs/img/logo.png": { path: "docs/img/logo.png", bytes: 3000, truncated: false, binary: true, text: "" },
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
  readme_html: "<p>探针 README</p>",
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

const calls: string[] = [];
const dwells: { ms: number; readDepth: number; tab: string }[] = [];
const w = window as unknown as { __TAURI_INTERNALS__: unknown; __PROBE__?: unknown };
w.__TAURI_INTERNALS__ = {
  transformCallback: (cb: () => void) => cb,
  unregisterCallback: () => undefined,
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push(`${cmd}:${args?.path ?? args?.kind ?? args?.url ?? ""}`);
    if (cmd === "get_detail") return DETAIL;
    if (cmd === "repo_tree") return TREE;
    if (cmd === "repo_file_read") return FILES[args.path as string] ?? { path: args.path, bytes: 0, truncated: false, binary: false, text: "" };
    if (cmd === "repo_list") return LIST[args.kind as string];
    if (cmd === "issue_detail") return ISSUE_DETAIL;
    if (cmd === "pr_detail") return PR_DETAIL;
    if (cmd === "pr_files") return PR_FILES;
    if (cmd === "issue_comments") return { count: 1, items: [{ author: "bob", association: "MEMBER", created_at: "2026-10-02T00:00:00Z", body_html: "<p>探针评论正文</p>" }] };
    if (cmd === "actions_runs") return RUNS;
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
    if (cmd === "settings_json") return { refill_on: "1", theme: "light", set: "github" };
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
  root.render(<DetailView repoId={123} onBack={() => undefined} onNotice={() => undefined} />);
  await sleep(600);

  // ---- 摆法：树在右栏、不做页签，导航是 GitHub 那一排
  const navLabels = [...document.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim());
  ok("导航是四项：概览 / Issues / Pull requests / Actions（文件不是页签）",
    navLabels.length === 4 &&
      ["概览", "Issues", "Pull requests", "Actions"].every((t) => navLabels.some((l) => l.startsWith(t))),
    navLabels.join(" | "));
  ok("树在右栏，进页面就在（不用点任何页签）", !!box("文件") && txt().includes(".github") && txt().includes("README.md"));
  ok("右栏的树与左栏的 README 同屏", !!box("文件") && !!box("README") && txt().includes("探针 README"));
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

  // ---- 树：点文件 → 左栏预览
  await click(one("button", "README.md"));
  ok("点文件后左栏变成该文件的预览", txt().includes("第二行") && txt().includes("第三行"));
  ok("预览出现时 README 让位", !box("README"));
  await click(one("button", "返回 README"));
  ok("返回 README 后左栏还原", !!box("README") && txt().includes("探针 README"));

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

  // ---- 统计页的补货面板（换一个 root 渲染，不再碰 DetailView）
  const box2 = document.createElement("div");
  box2.id = "probe-stats";
  document.body.appendChild(box2);
  initStore();
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

await run();
