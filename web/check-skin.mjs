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
const richx = existsSync(join(web, "src", "components", "RichHtml.tsx"))
  ? readFileSync(join(web, "src", "components", "RichHtml.tsx"), "utf8") : "";
const collectrs = existsSync(join(web, "..", "src-tauri", "src", "bin", "collect.rs"))
  ? readFileSync(join(web, "..", "src-tauri", "src", "bin", "collect.rs"), "utf8") : "";
const cardx = readFileSync(join(web, "src", "components", "RepoCard.tsx"), "utf8");
const feedview = readFileSync(join(web, "src", "views", "FeedView.tsx"), "utf8");
const probeSrc = readFileSync(join(web, "src", "probe-repo.tsx"), "utf8");
const exposure = readFileSync(join(web, "src", "lib", "exposure.ts"), "utf8");

// 逐页：必须还在的信息块（钉可见文字，不钉实现细节）+ 不许回来的摆法
const PAGES = [
  {
    file: "src/views/FeedView.tsx",
    name: "发现",
    need: ["显示更多", "热度榜是空的", "重新读取", "双列卡片网格", "刷新"],
    // 2026-10-07 他把发现页改成双列卡片，这条 ban（sm:grid-cols-2）到此作废；
    // 但 CSS columns 那种真瀑布流仍然不许——它会把条目顺序与曝光 slot 的口径冲掉。
    ban: [/columns:/],
  },
  {
    file: "src/components/RepoCard.tsx",
    name: "发现页的卡片",
    need: ["收藏", "不感兴趣", "浏览器打开", "clone", "出生", "opengraph.githubassets.com", "这张预览图没取到"],
    ban: [/hero/],
  },
  {
    file: "src/views/DetailView.tsx",
    name: "详情",
    need: ["README", "语言构成", "最近 release", "应用内浏览 GitHub", "dwell", "star 增长", "概览", "Issues", "Pull requests", "RichHtml"],
    // README 的 HTML 不许再就地 setInnerHTML：那正是"点了没反应"的出处，必须过 RichHtml
    ban: [/lg:grid-cols-12/, /dangerouslySetInnerHTML/],
  },
  {
    file: "src/components/RepoTree.tsx",
    name: "仓库文件树与预览",
    need: ["二进制文件，不做预览", "已截断", "在 GitHub 打开", "看源码", "看渲染", "RichHtml"],
    ban: [/dangerouslySetInnerHTML/],
  },
  {
    file: "src/views/ItemDetail.tsx",
    name: "应用内的 issue / PR 详情",
    need: ["返回列表", "描述", "评论", "变更", "在浏览器打开", "应用内浏览", "RichHtml"],
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
    what: "第三方 HTML 只有一个出口：清洗函数在 lib/md.ts，只有 RichHtml 调它，README / 文件渲染版 / issue 正文 / 评论都用 RichHtml",
    pass: mdlib.length > 0 && /export function sanitizeHtml/.test(mdlib) &&
      /sanitizeHtml\(html\)/.test(richx) && /<RichHtml/.test(detail) && /<RichHtml/.test(item) && /<RichHtml/.test(treex),
  },
  {
    id: "html-media",
    what: "issue/PR 正文走官方渲染的 html 媒体类型（不引 markdown 库、也不抓页面）",
    pass: /application\/vnd\.github\.html\+json/.test(rust) && /fn get_json_as/.test(rust),
  },
  {
    id: "item-sanitized",
    what: "dangerouslySetInnerHTML 全仓只出现在 RichHtml 一处，散装正文（描述/评论）都收拢到它",
    pass: (() => {
      const inRich = (richx.match(/dangerouslySetInnerHTML/g) || []).length;
      const elsewhere = [detail, item, treex, actions].reduce((a, s) => a + (s.match(/dangerouslySetInnerHTML/g) || []).length, 0);
      const n = (item.match(/<RichHtml/g) || []).length;
      return inRich === 1 && elsewhere === 0 && n >= 2;
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
  // ---- 2026-10-07 他点的三条：README 点「简体中文」没反应 / 点 md 不渲染 / 代码块没标注
  {
    id: "href-rewrite-order",
    what: "feed.rs:2536 改写器按**位置**取最先出现的属性（min_by_key），不是按 src/href 类型抢先；旧的 if-else 链不许回来",
    pass: /\.min_by_key\(\|\(p, _, _, _\)\| \*p\)/.test(rust) &&
      !/if let Some\(p\) = rest\.find\("src=\\"\"\)/.test(rust) &&
      /link_base/.test(rust),
  },
  {
    id: "link-blob-base",
    what: "feed.rs:2611 url_bases 把链接基址定成 github.com 的 blob 页（图片仍走 raw），README 调用点传了 link_base",
    pass: /pub fn url_bases/.test(rust) && /\/blob\/{}\/\{\}/.test(rust) &&
      /rewrite_readme_urls\(&readme0, &raw_base, &link_base, &web_base\)/.test(rust),
  },
  {
    id: "md-official-render",
    what: "feed.rs:2066 repo_file_read 有 mode=html 这一档：走 html+json 媒体类型，且缓存按 mode 分行（file-html）",
    pass: /mode == "html"/.test(rust) && /ACCEPT_HTML \} else \{ "application\/vnd\.github\.raw"/.test(rust) &&
      /"file-html"/.test(rust),
  },
  {
    id: "ipc-mode-param",
    what: "mode 一路贯通：main.rs:235 command 收 Option<String>、bridge:247 repoFile 收 mode、collect.rs:242 file 收第 4 个参数",
    pass: /fn repo_file_read\(repo_id: i64, path: String, mode: Option<String>\)/.test(mainrs) &&
      /repoFile\(id: number, path: string, mode: "raw" \| "html" = "raw"\)/.test(bridge) &&
      /args\.get\(4\)\.map\(\|s\| s\.as_str\(\)\)\.unwrap_or\("raw"\)/.test(collectrs),
  },
  {
    id: "readme-path-plumb",
    what: "相对链接要按 README 所在目录解，所以 readme_path 得从 Rust 一路传到前端：feed.rs:1949 / bridge.ts:47 / DetailView 的 basePath",
    pass: /"readme_path": extra_v\["readme_path"\]/.test(rust) && /readme_path\?: string/.test(bridge) &&
      /basePath=\{\(d\.readme_path \?\? ""\)/.test(detail),
  },
  {
    id: "rich-single-exit",
    what: "第三方 HTML 的点击只有 RichHtml 一个出口：README、文件渲染版、issue 正文、评论都用它，没有第二处 openExternal(href)",
    pass: /openInside\(href, repoId\)/.test(richx) && /<RichHtml/.test(detail) && /<RichHtml/.test(item) &&
      /<RichHtml/.test(treex) && !/openExternal\(a\.getAttribute\("href"\)/.test(detail) &&
      !/openExternal\(a\.getAttribute\("href"\)/.test(item),
  },
  {
    id: "anchor-id-fix",
    what: "GitHub 渲染出来的 h1~h6 不带 id（实测 h2 只有 class=heading-element），所以锚点要自己补 slug，否则 README 目录天生点不动",
    pass: /if \(!h\.id\) h\.id = slug\(/.test(richx) && /export function slug\(/.test(richx) &&
      /user-content-/.test(richx),
  },
  {
    id: "md-default-render",
    what: "RepoTree.tsx:143 点 md 默认给渲染版（isMd 判定为 render），并且能一键切回源码",
    pass: /isMd\(p\) \? "render" : "source"/.test(treex) && /看源码/.test(treex) && /看渲染/.test(treex),
  },
  {
    id: "code-label-css",
    what: "产物 CSS 里代码块有等宽字体与语言标注条（.codehead），不再是一块无标注的等宽文字",
    pass: /\.codehead/.test(css) && /\.codebox/.test(css) && /font-family:var\(--font-mono\)/.test(css),
  },
  {
    id: "api-dump-char-safe",
    what: "collect.rs:161 探针按**字符**取前 200（原来按字节切会在中文中间劈开直接 panic），并能把完整响应落盘",
    pass: /body\.chars\(\)\.take\(200\)/.test(collectrs) && !/&body\[\.\.body\.len\(\)\.min\(200\)\]/.test(collectrs) &&
      /std::fs::write\(dump, &body\)/.test(collectrs),
  },
  // ---- 2026-10-07 他补的两条：整行该可点 / 翻译只发一批就停
  {
    id: "row-click-opens",
    what: "RepoCard.tsx 整张卡 onClick → onOpen，且卡内的按钮/链接用 closest() 排除掉（否则点收藏会把详情页也打开）",
    pass: /const cardClick = /.test(cardx) && /onClick=\{cardClick\}/.test(cardx) &&
      /closest\("button,a,/.test(cardx),
  },
  {
    id: "feed-card-grid",
    what: "发现页是按容器宽度出列的双列卡片网格（@container + @lg:grid-cols-2）+ GitHub OG 头图，图懒加载且取不到有降级",
    pass: /@container/.test(feedview) && /@lg:grid-cols-2/.test(feedview) && !/columns:/.test(feedview) &&
      /opengraph\.githubassets\.com/.test(cardx) && /loading="lazy"/.test(cardx) &&
      /onError=\{\(\) => setState\("bad"\)\}/.test(cardx),
  },
  {
    id: "og-cover-look",
    what: "卡图对齐顶部（居中裁会把 OG 图里的头像切一半）、在路上时右下角挂加载标志、取不到换成 octicon 的 GitHub 标",
    pass: /object-top/.test(cardx) && /data-og-load/.test(cardx) && /animate-spin/.test(cardx) &&
      /M6\.766 11\.328/.test(cardx) && /aria-label="GitHub"/.test(cardx),
  },
  {
    id: "translate-continues",
    what: "store.tsx 的翻译队列发完一批会 rearm 接着发（一屏 92 条简介，单次上限 8 条，不续跑等于只翻 8 条）",
    pass: /const rearm = \(\) =>/.test(store) && /rearm\(\);/.test(store) && /trTimer = window\.setTimeout\(flushTranslate, 900\)/.test(store),
  },
  {
    id: "translate-no-poison",
    what: "feed.rs:1843 翻译失败不写缓存（旧写法把原文当译文存进去，那条就永远不会再试，界面看着就是坏了）",
    pass: /None => \{ failed \+= 1; \}/.test(rust) && !/if got\.trim\(\)\.is_empty\(\) \{ t\.clone\(\) \}/.test(rust),
  },
  {
    id: "translate-cli",
    what: "collect.exe translate 能单独验翻译（RAW 里带 failed 与库里 zh=原文 的行数，红绿都有据可查）",
    pass: /Some\("translate"\)/.test(collectrs) && /FROM translation WHERE zh = src/.test(collectrs),
  },
  {
    id: "probe-covers-two",
    what: "DOM 探针真的点了卡片、真的等到第二批翻译（12 条 = 8+4），还真的数了列数与 OG 图",
    pass: /点整张卡（简介那一块）就进详情/.test(probeSrc) && /8\+4/.test(probeSrc) &&
      /双列\*\*卡片/.test(probeSrc) && /opengraph\.githubassets\.com/.test(probeSrc) &&
      /data-og-load/.test(probeSrc) && /objectPosition/.test(probeSrc),
  },
  {
    id: "feed-refresh",
    what: "发现页有「刷新」：先 refill_now 补一步、再 fetchPage(0) 重读，回显通道/新增/真实请求数/池子前后；配额跳过时也要说明",
    pass: /const refresh = \(\) =>/.test(feedview) && /refillNow\(\)/.test(feedview) &&
      /fetchPage\(0\)\.then\(\(\) => r\)/.test(feedview) && /补了一轮：通道/.test(feedview) &&
      /只重读了本机已有的内容/.test(feedview) && /刷新中/.test(feedview),
  },
  // ---- 2026-10-07 他说"整体使用感非常非常卡顿，完全不可用"：这四条钉住修的地方
  {
    id: "perf-no-n-plus-one",
    what: "load_feed 不再对全池逐行查 weeks：fill_weeks 一次 IN 批量，且只在分页后给这一页补（saved/seen 同理）",
    pass: /fn fill_weeks/.test(rust) && /ORDER BY repo_id, week DESC/.test(rust) &&
      /fn mark_saved_seen/.test(rust) && /fill_weeks\(conn, &mut page\)/.test(rust) &&
      /mark_saved_seen\(conn, &mut page\)/.test(rust) &&
      !/for \(i, id\) in ids\.iter\(\)\.enumerate\(\)/.test(rust),
  },
  {
    id: "perf-commands-off-main",
    what: "阻塞活不在主线程上：bg! 宏走 spawn_blocking，读榜/详情/文件命令都是 async fn",
    pass: /macro_rules! bg/.test(mainrs) && /spawn_blocking/.test(mainrs) &&
      /async fn get_channel/.test(mainrs) && /async fn get_detail/.test(mainrs) &&
      /async fn repo_file_read/.test(mainrs) && /async fn log_impressions/.test(mainrs),
  },
  {
    id: "perf-impression-batch",
    what: "曝光攒批上报（一屏 100 张卡不能发 100 次 IPC），且关窗前会倒空队列",
    pass: /log_impressions/.test(exposure) && /FLUSH_AT/.test(exposure) && /beforeunload/.test(exposure) &&
      !/call\("log_impression"/.test(exposure) &&
      /pub struct Imp/.test(rust) && /prepare_cached\("INSERT OR IGNORE INTO impression/.test(rust) &&
      /generate_handler!\[[^\]]*log_impressions,/.test(mainrs) && !/ log_impression,/.test(mainrs),
  },
  {
    id: "perf-init-once",
    what: "建表每进程只跑一次（以前每条命令都 open_db + init_db，一屏上百次）",
    pass: /static DB_INIT: std::sync::Once/.test(rust) && /DB_INIT\.call_once/.test(rust),
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
    // ---- 离线单元：相对路径改写器。这条不打网络，钉的是"链接排在下一个 src= 之前就没被改写"那个回归
    const rw = raw(["rewrite"]);
    const rwHtml = rw.v?.html ?? "";
    LIVE.push([
      `改写器按位置处理属性：链接补成 blob 页（改了 ${rw.v?.fixed ?? 0} 个），锚点没动，已是绝对地址的也没动`,
      rwHtml.includes('href="https://github.com/o/r/blob/main/README.zh-CN.md"') &&
        rwHtml.includes('href="https://github.com/o/r/blob/main/docs/a.md"') &&
        rwHtml.includes('src="https://raw.githubusercontent.com/o/r/main/public/logo.png"') &&
        rwHtml.includes('href="#用法"') &&
        rwHtml.includes('src="https://example.com/x.png"') &&
        rw.v?.fixed === 3,
    ]);
    try {
      const t = raw(["tree", String(id)]);
      const bm = raw(["bench", "3"]);
      LIVE.push([
        `榜单查询同进程计时：一页 ${bm.v?.rows ?? 0} 条，最慢 ${bm.v?.worst_ms ?? "?"}ms（门槛 250ms；修之前实测 1040ms）`,
        !!bm.v && bm.v.rows > 0 && bm.v.worst_ms < 250,
      ]);
      LIVE.push(["tree 拿得到条目", !!t.v && t.v.count > 0 && t.v.entries.every((e) => typeof e.path === "string" && typeof e.dir === "boolean") && !!t.v.branch]);
      const f0 = t.v.entries.find((e) => !e.dir && /\.md$/i.test(e.path)) || t.v.entries.find((e) => !e.dir);
      const f = raw(["file", String(id), f0.path]);
      LIVE.push(["file 读得出内容（文本有字节，二进制就明说不预览）",
        !!f.v && f.v.bytes > 0 && (f.v.binary ? f.v.text === "" : f.v.text.length > 0)]);
      // ---- 他点的第二条：点 md 只给一堆源码。mode=html 让 GitHub 自己渲染
      // （实测 contents 端点带 html+json 媒体类型返回 200，外面包一层 div#file.md）
      const mdPath = (t.v.entries.find((e) => !e.dir && /\.(md|markdown)$/i.test(e.path)) || f0).path;
      const hv = raw(["file", String(id), mdPath, "html"]);
      LIVE.push([`md 的渲染版拿得到（${(hv.v?.html ?? "").length} 字符 HTML，且不带源码正文）`,
        !!hv.v && /<h\d|<article|<p[\s>]/.test(hv.v.html ?? "") && !hv.v.text]);
      const relHref = (hv.v?.html ?? "").match(/href="(?!#|https?:|mailto:|data:)[^"]*"/g) ?? [];
      LIVE.push([
        `渲染版里没有相对链接残留${relHref.length ? "（还留着 " + relHref.slice(0, 3).join(",") + "）" : ""}`,
        relHref.length === 0,
      ]);
      const hv2 = run(["file", String(id), mdPath, "html"]);
      LIVE.push(["第二次读同一份渲染版命中缓存，没再打 API", hv2.includes("命中 6 小时缓存")]);
      const i = raw(["list", String(id), "issue"]);      const p = raw(["list", String(id), "pull"]);
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
      // ---- 翻译：真打一次外部服务，并把"翻不动就别把原文当译文存进缓存"钉住
      const uniq = "Probe sentence about a tiny disk cleaner " + Date.now();
      const tr1 = raw(["translate", uniq]);
      const zh1 = String(Object.values(tr1.v?.result.map ?? {})[0] ?? "");
      LIVE.push([
        `翻译真出中文（${zh1.slice(0, 24)}），这次联网 ${tr1.v?.result.net} 条`,
        !!tr1.v && tr1.v.result.net === 1 && /[\u4e00-\u9fff]/.test(zh1) && zh1 !== uniq,
      ]);
      const tr2 = raw(["translate", uniq]);
      LIVE.push([`同一句第二次命中本地缓存、不再联网（net=${tr2.v?.result.net} cached=${tr2.v?.result.cached}）`,
        !!tr2.v && tr2.v.result.net === 0 && tr2.v.result.cached === 1]);
      const trBad = raw(["translate", "--url=http://127.0.0.1:9/x", "Another probe sentence " + Date.now()]);
      LIVE.push([
        `打不通时失败 ${trBad.v?.result.failed} 条、库里 zh=原文 的行数没涨（还是 ${trBad.v?.poisoned} 行）`,
        !!trBad.v && trBad.v.result.failed === 1 && trBad.v.poisoned === tr1.v.poisoned,
      ]);
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

