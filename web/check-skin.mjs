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
const statview = readFileSync(join(web, "src", "views", "StatsView.tsx"), "utf8");
const pkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8"));
// 仓库视图是跨语言的改动（Rust 取数 + command 注册 + 前端），所以断言也要跨过语言层
const rust = readFileSync(join(web, "..", "src-tauri", "src", "feed.rs"), "utf8");
const mainrs = readFileSync(join(web, "..", "src-tauri", "src", "main.rs"), "utf8");
const bridge = readFileSync(join(web, "src", "lib", "bridge.ts"), "utf8");
const detail = readFileSync(join(web, "src", "views", "DetailView.tsx"), "utf8");
const item = existsSync(join(web, "src", "views", "ItemDetail.tsx"))
  ? readFileSync(join(web, "src", "views", "ItemDetail.tsx"), "utf8") : "";
const actions = existsSync(join(web, "src", "views", "ActionsPanel.tsx"))
  ? readFileSync(join(web, "src", "views", "ActionsPanel.tsx"), "utf8") : "";
const mdlib = existsSync(join(web, "src", "lib", "md.ts")) ? readFileSync(join(web, "src", "lib", "md.ts"), "utf8") : "";
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
    file: "src/views/ItemDetail.tsx",
    name: "应用内的 issue / PR 详情",
    need: ["返回列表", "描述", "评论", "变更", "在浏览器打开", "应用内浏览"],
    ban: [],
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
    what: "导航只留能做的四项：概览 / Issues / Pull requests / Actions（且文件仍不是页签）",
    pass: ["概览", "Issues", "Pull requests", "Actions"].every((t) => new RegExp(`label: "${t}"`).test(detail)) &&
      !/value: "files"/.test(detail),
  },
  {
    id: "dropped-unadaptable",
    what: "Projects / Security / Insights 从导航里去掉了（REST 拿不到：GraphQL-only / 要仓库权限），且留下「为什么去掉」的注释",
    pass: !/label: "Projects"/.test(detail) && !/label: "Security"/.test(detail) && !/label: "Insights"/.test(detail) &&
      !/REST_MISSING/.test(detail) && /先去掉/.test(detail),
  },
  {
    id: "in-app-item",
    what: "点列表里的一条进应用内详情（ItemDetail），行点击不再把 URL 交给系统浏览器",
    pass: /ItemDetail/.test(detail) && /opened \? \(/.test(detail) &&
      item.length > 0 && /issueDetail\(/.test(item) && /issueComments\(/.test(item) && /prFiles\(/.test(item) &&
      !/onOpen=/.test(detail),
  },
  {
    id: "actions-panel",
    what: "Actions 面板在应用内读运行列表（日志要权限，所以点一条走应用内窗口）",
    pass: actions.length > 0 && /actionsRuns\(/.test(actions) && /openInside\(/.test(actions),
  },
  {
    id: "md-shared",
    what: "README 与 issue/PR 正文共用同一个清洗函数（只在一条路径上补清洗迟早会漏）",
    pass: mdlib.length > 0 && /export function sanitizeHtml/.test(mdlib) &&
      /sanitizeHtml\(d\.readme_html\)/.test(detail) && /sanitizeHtml\(body\)/.test(item),
  },
  {
    id: "html-media",
    what: "issue/PR 正文走官方渲染的 html 媒体类型（不引 markdown 库、也不抓页面）",
    pass: /application\/vnd\.github\.html\+json/.test(rust) && /fn get_json_as/.test(rust),
  },
  {
    id: "item-sanitized",
    what: "应用内详情里每一处 dangerouslySetInnerHTML 都套了清洗（三处正文：描述、评论、PR 描述）",
    pass: (() => {
      const n = (item.match(/dangerouslySetInnerHTML/g) || []).length;
      const s = (item.match(/sanitizeHtml\(/g) || []).length;
      return n > 0 && s >= n;
    })(),
  },
  {
    id: "rust-registered-2",
    what: "五条新命令（issue_detail / issue_comments / pr_detail / pr_files / actions_runs）都在 Rust 侧注册了",
    pass: ["issue_detail", "issue_comments", "pr_detail", "pr_files", "actions_runs"].every(
      (c) => new RegExp(`#\\[tauri::command\\][\\s\\S]{0,140}fn ${c}\\(`).test(mainrs) &&
        new RegExp(`\\b${c}\\b`).test(mainrs.slice(mainrs.indexOf("generate_handler!")))
    ),
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
  {
    id: "refill-scheduler",
    what: "后台静默补货挂在启动流程里（setup 里 spawn、20 分钟一步、设置可关）",
    pass: /fn spawn_refill\(\)/.test(mainrs) && /spawn_refill\(\);/.test(mainrs) &&
      /from_secs\(20 \* 60\)/.test(mainrs) && /refill_on/.test(mainrs),
  },
  {
    id: "refill-budget",
    what: "补货有硬护栏：配额低于 200 跳过整轮 + 用量用原子计数器记账（不是拿 /rate_limit 前后相减）",
    pass: /core_left < 200/.test(rust) && /fn http_calls\(\)/.test(rust) &&
      /HTTP_CORE_CALLS\.fetch_add/.test(rust) && /let core_used = calls1 - calls0/.test(rust),
  },
  {
    id: "social-source-primary",
    what: "相似用户以「我关注的人」为主要参考（权重 1.0），并顺着他们 follow 再走一跳（0.6）",
    pass: /我关注的人（1\.0）——主参考/.test(rust) && /add\(who, 1\.0\)/.test(rust) &&
      /users\/\{who\}\/following/.test(rust) && /add\(&u\.login, 0\.6\)/.test(rust),
  },
  {
    id: "stargazers-locked",
    what: "把「谁 star 了别人的仓库」这个端点已被 GitHub 锁掉写进代码（免得以后有人又去做行为共现）",
    pass: /锁给仓库管理员/.test(rust) && /404/.test(rust),
  },
  {
    id: "channel-slots",
    what: "四条通道按槽位混排（不然画像/相似用户永远进不了前 50），且降权项不许占推荐位",
    pass: /const PATTERN: \[&str; 20\]/.test(rust) && /热 11 \/ 画像 4 \/ 相似 3 \/ 探索 2/.test(rust) &&
      /"profile" if !c\.spam => 1/.test(rust),
  },
  {
    id: "feed-100",
    what: "展示每页 100 条（抓足量、少显示）",
    pass: /export const LIMIT = 100/.test(bridge),
  },
  {
    id: "refill-visible",
    what: "补货状态看得见：统计页有池子/上次补货/「现在补一轮」，设置页有开关",
    pass: /refillStatus/.test(statview) && /现在补一轮/.test(statview) && /静默补货/.test(statview) &&
      /refill_on/.test(settings) && /后台静默补货/.test(settings),
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

      // ---- 应用内详情的取数：issue 正文、评论、PR 改动量与 diff、Actions 运行
      // 用 #1 是因为它是 react 最早的那条（2013 年的 PR，7 条评论），不会明天就没了
      const iss = raw(["issue", String(id), "1"]);
      LIVE.push([`issue 详情拿得到官方渲染的正文（${(iss.v?.body_html ?? "").length} 字符）`,
        !!iss.v && iss.v.body_html.length > 0 && !!iss.v.title && iss.v.number === 1]);
      // 空正文的评论在真实数据里是存在的（实测 react/react#1 的第 7 条：body 字段整个不存在、
      // body_html 是空串），所以这里要求"都有作者与时间 + 至少一半有正文"，别把真实数据当脏数据
      const cm = raw(["comments", String(id), "1"]);
      const withBody = (cm.v?.items ?? []).filter((x) => (x.body_html ?? "").length > 0).length;
      LIVE.push([`评论读得到（${cm.v?.count ?? 0} 条，其中 ${withBody} 条有正文，每条都有作者）`,
        !!cm.v && cm.v.count > 0 && cm.v.items.every((x) => !!x.author && !!x.created_at) && withBody >= cm.v.count / 2]);
      const pr = raw(["pr", String(id), "1"]);
      LIVE.push([`PR 详情带改动量（+${pr.v?.additions ?? 0}/-${pr.v?.deletions ?? 0}，${pr.v?.changed_files ?? 0} 文件）`,
        !!pr.v && pr.v.additions > 0 && pr.v.changed_files > 0 && !!pr.v.head && !!pr.v.base]);
      const fl = raw(["files", String(id), "1"]);
      LIVE.push([`变更文件的 unified diff 拿得到（${fl.v?.count ?? 0} 个文件，有 patch）`,
        !!fl.v && fl.v.items.length > 0 && fl.v.items.some((f) => (f.patch ?? "").length > 0)]);
      const ac = raw(["actions", String(id)]);
      LIVE.push([`Actions 运行列表拿得到（共 ${ac.v?.total ?? 0} 次，取回 ${ac.v?.count ?? 0} 条）`,
        !!ac.v && ac.v.total > 0 && ac.v.items.length > 0 && !!ac.v.items[0].name]);
      // ---- 补货器 / 相似用户 / 槽位混排（真打 GitHub，2026-10-06 加的第三条通道）
      const st0 = raw(["refill-status"]);
      LIVE.push([`补货状态读得到（池子 ${st0.v?.pool ?? 0} 条，开关 ${st0.v?.enabled ? "开" : "关"}）`,
        !!st0.v && st0.v.pool > 500 && st0.v.enabled === true]);
      const rf = raw(["refill"]);
      LIVE.push([`跑一步补货：通道=${rf.v?.channel} 新增=${rf.v?.inserted}，真实请求 core ${rf.v?.core_used} / search ${rf.v?.search_used}`,
        !!rf.v && ["profile", "hot", "explore", "social", "skip"].includes(rf.v.channel) &&
          rf.v.core_used >= 1 && rf.v.core_used <= 60 && rf.v.pool_after >= rf.v.pool_before]);
      const st1 = raw(["refill-status"]);
      LIVE.push([`补货后池子只增不减（${st0.v?.pool} → ${st1.v?.pool}），状态里能看到画像词表与相似用户源`,
        st1.v.pool >= st0.v.pool && st1.v.profile_terms > 0]);
      const top = raw(["top", "12"]);
      const nonHot = (top.v ?? []).filter((c) => c.channel !== "hot").length;
      LIVE.push([`槽位混排生效：前 12 名里有 ${nonHot} 条来自非热榜通道（画像/相似用户/探索）`,
        nonHot >= 1 && (top.v ?? []).length === 12]);
      const soc = run(["social", "8"]);
      const mm = soc.match(/入库 (\d+) 条/);
      LIVE.push([`相似用户通道跑得动（${mm ? mm[1] : "?"} 条入库，源以「我关注的人」为主）`,
        /我关注 \d+（主）/.test(soc) && !!mm && Number(mm[1]) > 0]);
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

