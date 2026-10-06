// 临时渲染探针：验"点开仓库 → 右栏是文件树、左栏是 README 或选中文件的预览"这一套摆法。
// 数据是这里现编的（形状照 feed.rs 的 json! 键写），所以它测的是前端而不是网络。
// 复跑：corepack pnpm@10 --filter web exec vite --port 1430 —— 浏览器开 http://localhost:1430/probe.html
import { createRoot } from "react-dom/client";
import "./styles.css";
import { DetailView } from "./views/DetailView";

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
      { number: 21, title: "探针 PR 一", author: "carol", created_at: "2026-10-03T00:00:00Z", comments: 1, draft: true, labels: ["docs", "good first issue"] },
    ],
  },
};

const calls: string[] = [];
const dwells: { ms: number; readDepth: number; tab: string }[] = [];
const w = window as unknown as { __TAURI_INTERNALS__: unknown; __PROBE__?: unknown };
w.__TAURI_INTERNALS__ = {
  transformCallback: (cb: () => void) => cb,
  unregisterCallback: () => undefined,
  convertFileSrc: (p: string) => p,
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    calls.push(`${cmd}:${args?.path ?? args?.kind ?? ""}`);
    if (cmd === "get_detail") return DETAIL;
    if (cmd === "repo_tree") return TREE;
    if (cmd === "repo_file_read") return FILES[args.path as string] ?? { path: args.path, bytes: 0, truncated: false, binary: false, text: "" };
    if (cmd === "repo_list") return LIST[args.kind as string];
    if (cmd === "log_event" && args.kind === "dwell") dwells.push(JSON.parse(String(args.payload)));
    return {};
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txt = () => document.body.innerText;
/** 按可见文字找元素；sel 限定标签，避免误命中 */
const one = (sel: string, s?: string) =>
  [...document.querySelectorAll(sel)].find((e) => (s ? (e.textContent ?? "").trim().startsWith(s) : true)) as HTMLElement | undefined;
/** 找那个 Box：它的表头文字以 title 开头 */
const box = (title: string) =>
  [...document.querySelectorAll("section")].find((s) => (s.querySelector("h2")?.textContent ?? "") === title) as HTMLElement | undefined;

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

  // ---- 摆法本身：树在右栏、不做页签
  const navLabels = [...document.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim());
  ok("页签只有三个（文件不再是页签）",
    navLabels.length === 3 && navLabels.filter((l) => ["概览", "Issues", "Pull requests"].some((x) => l.startsWith(x))).length === 3,
    navLabels.join(" | "));
  ok("树在右栏，进页面就在（不用点任何页签）", !!box("文件") && txt().includes(".github") && txt().includes("README.md"));
  ok("右栏的树与左栏的 README 同屏", !!box("文件") && !!box("README") && txt().includes("探针 README"));
  ok("树的请求只发一次", calls.filter((c) => c.startsWith("repo_tree")).length === 1, calls.join(","));
  // 位置判定：宽视口看左右，窄视口（无头面板就是窄的）只能看 DOM 顺序——
  // 这是探针环境的限制，不是布局的限制，所以两种都写清。lg 断点是 1024。
  ok("树排在 README 之后（宽视口下即在右侧）",
    (() => {
      const t = box("文件")!, r = box("README")!;
      const wide = innerWidth >= 1024;
      const after = (r.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const toRight = t.getBoundingClientRect().left > r.getBoundingClientRect().left;
      return wide ? toRight : after;
    })(),
    `视口宽 ${innerWidth}（${innerWidth >= 1024 ? "按左右判" : "窄，按 DOM 顺序判"}）`);
  ok("子目录默认收起（展开才看得到里层）", !txt().includes("FUNDING.yml"));

  // ---- 点文件：左栏切成预览，README 让位
  await click(one("button", "README.md"));
  ok("点文件后左栏变成该文件的预览", txt().includes("第二行") && txt().includes("第三行"));
  ok("预览出现时 README 让位（不同屏堆着）", !box("README"), txt().slice(0, 80));
  ok("预览标题是文件路径，并且有「返回 README」", !!box("README.md") && txt().includes("返回 README"));
  const row0 = document.querySelector("table tr");
  ok("行号单独一列", row0?.children[0]?.textContent?.trim() === "1" && !(row0?.children[1]?.textContent ?? "").startsWith("1"),
    `第一行左列="${row0?.children[0]?.textContent ?? ""}"`);

  await click(one("button", "返回 README"));
  ok("返回 README 后左栏还原", !!box("README") && txt().includes("探针 README"));

  // ---- 树本身还能用：展开目录、读里面的文件、二进制明说
  await click(one("button", ".github"));
  ok("展开目录能看到里面的文件", txt().includes("FUNDING.yml"));
  await click(one("button", "src"));
  await click(one("button", "main.rs"));
  ok("嵌套目录里的文件也能读", txt().includes("println!(") && txt().includes("fn main() {"));
  await click(one("button", "docs"));
  await click(one("button", "img"));
  await click(one("button", "logo.png"));
  ok("二进制文件不塞正文", txt().includes("二进制文件，不做预览"));

  // ---- 两个列表页签不受影响
  await click(one("nav button", "Issues"), 320);
  ok("Issues 页签列出两条，计数进胶囊", txt().includes("探针 issue 一") && (one("nav button", "Issues")?.textContent ?? "").includes("2"));
  await click(one("nav button", "Pull requests"), 320);
  ok("PR 页签只有 PR，draft 标出来", txt().includes("探针 PR 一") && txt().includes("draft"));
  await click(one("nav button", "概览"), 320);
  ok("切回概览：树还在（没被卸载重取）", !!box("文件") && calls.filter((c) => c.startsWith("repo_tree")).length === 1,
    calls.filter((c) => c.startsWith("repo_tree")).join(","));

  // 卸载会补最后一条 dwell：借这一步验 dwell 带没带页签。
  // ?keep=1 时不卸载也不画结果浮层——那是留给人肉看布局的（截图/自己开页面看）。
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
  line(`仓库视图渲染探针：${n} 通过 / ${R.length - n} 失败`, "#1f2328", true);
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
