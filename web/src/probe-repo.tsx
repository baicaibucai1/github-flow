// 临时渲染探针：只验"点开仓库 → 文件树 / 预览 / Issues / PR 这四块真的画出来了、点得动"。
// 数据是这里现编的（形状照 feed.rs 的 json! 键写），所以它测的是前端而不是网络。
// 复跑：corepack pnpm@10 exec vite --port 1425 —— 浏览器开 http://localhost:1425/probe.html
// 验完删掉：vite build 只收 index.html，probe.html 进不了产物。
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
const one = (sel: string, s?: string) =>
  [...document.querySelectorAll(sel)].find((e) => (s ? (e.textContent ?? "").trim().startsWith(s) : true)) as HTMLElement | undefined;

async function run() {
  const R: [string, boolean, string][] = [];
  const ok = (name: string, cond: boolean, note = "") => R.push([name, !!cond, note]);
  // 只点一次：目录是开关，点两下等于没展开
  const click = async (el: HTMLElement | undefined, ms = 180) => {
    el?.click();
    await sleep(ms);
  };

  const root = createRoot(document.getElementById("root")!);
  root.render(<DetailView repoId={123} onBack={() => undefined} onNotice={() => undefined} />);
  await sleep(500);

  ok("四个页签都在", ["概览", "文件", "Issues", "Pull requests"].every((t) => txt().includes(t)));
  ok("概览仍是 README + 侧栏（老内容没被换掉）", txt().includes("探针 README") && txt().includes("语言构成") && txt().includes("最近 release"));
  ok("停在概览时不发树/列表请求（懒加载）", !calls.some((c) => c.startsWith("repo_tree")) && !calls.some((c) => c.startsWith("repo_list")), calls.join(","));

  await click(one("nav button", "文件"));
  ok("切到文件：只列根目录这一层，子目录默认收起", txt().includes(".github") && txt().includes("README.md") && !txt().includes("FUNDING.yml"));
  ok("目录排在文件前面（跟 GitHub 一致）", txt().indexOf(".github") < txt().indexOf("README.md"));
  ok("树只请求一次", calls.filter((c) => c.startsWith("repo_tree")).length === 1, calls.join(","));

  await click(one("button", ".github"));
  ok("展开 .github 才看到里面的文件", txt().includes("FUNDING.yml"));

  await click(one("button", "README.md"), 260);
  ok("选中文件后右侧出正文", txt().includes("第二行") && txt().includes("第三行"));
  const row0 = document.querySelector("table tr");
  ok("行号单独一列（1 / 2 而不是拼在正文里）", row0?.children[0]?.textContent?.trim() === "1" && !(row0?.children[1]?.textContent ?? "").startsWith("1"),
    `第一行左列="${row0?.children[0]?.textContent ?? ""}"`);
  ok("预览的标题就是文件路径", txt().includes("README.md"));

  await click(one("button", "src"));
  await click(one("button", "main.rs"), 260);
  ok("两层目录点开后读到 src/main.rs", row0 !== null && txt().includes("println!(") && txt().includes("fn main() {"));

  await click(one("button", "docs"));
  await click(one("button", "img"));
  await click(one("button", "logo.png"), 260);
  ok("二进制文件不塞正文，改说一句人话", txt().includes("二进制文件，不做预览"));

  await click(one("nav button", "Issues"), 320);
  ok("Issues 页签列出两条", txt().includes("探针 issue 一") && txt().includes("探针 issue 二"));
  ok("条数进了页签胶囊", (one("nav button", "Issues")?.textContent ?? "").includes("2"), one("nav button", "Issues")?.textContent ?? "");
  ok("列表行带上游元信息（编号 / 作者 / 讨论数）", txt().includes("#11") && txt().includes("alice") && txt().includes("2 条讨论"));
  ok("issue 与 PR 各发各的请求（不是一次 /issues 两用）", calls.some((c) => c === "repo_list:issue") && calls.some((c) => c === "repo_list:pull") === false, calls.filter((c) => c.startsWith("repo_list")).join(","));

  await click(one("nav button", "Pull requests"), 320);
  ok("PR 页签只有 PR，且 draft 标出来了", txt().includes("探针 PR 一") && txt().includes("draft"));
  ok("切页签不重发已取过的列表", calls.filter((c) => c === "repo_list:issue").length === 1, calls.filter((c) => c.startsWith("repo_list")).join(","));

  // 卸载会补最后一条 dwell：借这一步验 dwell 到底带没带页签。
  // 现在详情页有四个页签，"在读 README" 与 "在翻文件树" 是两个不同的信号，
  // 合成一条 dwell 等于把最好的训练数据搅浑（这条只有行为能验，静态断言盯不住）。
  root.unmount();
  await sleep(300);
  const last = dwells[dwells.length - 1];
  ok("dwell 带得清是哪个页签（不再只有一条糊在一起的 ms+readDepth）",
    !!last && last.tab === "pulls" && last.ms >= 1000, JSON.stringify(last ?? {}));

  w.__PROBE__ = R;
  showResults(R, calls, errs);
  return R;
}

/** 结果直接写在页面上：他打开这个地址就能自己看哪条绿哪条红，不用回头问我。 */
function showResults(R: [string, boolean, string][], calls: string[], errs: string[]) {
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;right:8px;top:8px;z-index:9999;max-width:420px;max-height:96vh;overflow:auto;" +
    "background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:6px;padding:10px;" +
    "font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;box-shadow:0 6px 24px rgba(31,35,40,.18)";
  const n = R.filter(([, p]) => p).length;
  // 全部用 textContent 拼：断言名里带文件路径与尖括号时，写 innerHTML 会被当标签吃掉
  const line = (text: string, color: string, bold = false) => {
    const d = document.createElement("div");
    d.textContent = text;
    d.style.color = color;
    if (bold) d.style.fontWeight = "700";
    box.appendChild(d);
  };
  line(`仓库视图渲染探针：${n} 通过 / ${R.length - n} 失败`, "#1f2328", true);
  for (const [name, pass, note] of R) line(`${pass ? "PASS" : "FAIL"} ${name}${note ? " —— " + note : ""}`, pass ? "#1a7f37" : "#cf222e");
  line(`console 错误 ${errs.length} 条${errs.length ? "：" + errs.join(" | ") : ""}`, "#656d76");
  line(`IPC 序列：${calls.join(" → ")}`, "#656d76");
  document.body.appendChild(box);
  document.title = (n === R.length ? "PROBE PASS " : "PROBE FAIL ") + `${n}/${R.length}`;
}

const errs: string[] = [];
window.addEventListener("error", (e) => errs.push(String(e.message)));
window.addEventListener("unhandledrejection", (e) => errs.push("reject " + String(e)));

await run();
