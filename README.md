# Github Flow · gh-feed

本地优先的 GitHub 项目发现器。不是 GitHub 客户端——它只解决一件事：**帮你决定要不要深入看某个项目**。
（界面显示名是 **Github Flow**；包名、数据目录 `%LOCALAPPDATA%\gh-feed\` 仍是 `gh-feed`，
改它们会把已经攒下的库和凭据文件孤立掉，要改得单独做一次迁移。）

状态：**可运行的原型**。窗口能开、数据是真的、推送会随你的行为变化。未发布、未签名。

## 它跟 "trending 列表" 的区别

GitHub 没有 trending 接口，官方页面的排序也是黑盒。所以这里把两件事拆开：

- **测量**有官方接口：`GET /repos/{owner}/{repo}/stargazers/history` 一次请求拿到一个项目从出生到今天的**每周新增 star 曲线**。实测各周之和与 `stargazers_count` 自洽（差 1，即未满的当天）。
- **发现**没有官方接口，只能自己造候选：限定出生窗口后，"累计 star" 就等于"这段时间涨的 star"，于是 `created:>N天 + sort=stars` 本身就是增速榜。

热度可以问 GitHub，名单必须自己造——整个架构由此展开。

## 三条推送通道

| 通道 | 来源 | 作用 |
|---|---|---|
| 画像 | 你的收藏/仓库 → TF-IDF 加权词表 → 生成 search 查询 → RRF 融合 | 懂你的口味 |
| 热度 | 出生 ≤7/30/90 天 × star 档位，再用周曲线复核斜率与曲率 | 抓住正在起跳的项目 |
| 探索 | 出生 ≤7 天、star 1..19 的新生池，按语言分层随机抽 | 破兴趣气泡，制造"我提前发现了它" |

排序是线性打分（斜率 0.6 + 曲率 0.2 + 新鲜度 0.15 + 活跃 0.05），规则层做乘性降权。**MVP 不用任何大模型**，全部是可解释的统计量。

## 已实测的关键事实

- 未登录配额：core 60/h、search 10/min、**GraphQL 0**（`/rate_limit` 实测，该请求不计配额）
- search 每个查询**最多翻到 1000 条**（`page=11` → 422）；非法 `sort` 值被静默忽略
- 近 7 天出生且涨到 20+ star 的项目，全 GitHub 只有 **526 个** → 候选池不需要切网格
- GitHub search 是词面 AND：同一意图换措辞，前 20 名结果只重合 **1/20** → 所以匹配必须在本地做，search 只当进料口
- 新项目 72% 没有 topics、16% 没有简介、简介平均 101 字符；`in:readme` 会炸出 10 万条垃圾
- 新项目的 `stargazers/history` 只有 1 个周桶 → 斜率要用桶内的 `days[7]` 每日数组算
- 新项目 watcher 普遍为 0 → 任何 `watchers/stars` 反作弊规则都必须加 star 门槛，否则会把整个新秀通道判成刷量
- 内嵌 WebView 加载 github.com 返回 200（`frame-ancestors 'none'` 只约束被嵌入，不约束顶层文档；**iframe 方案永久不可行**）
- API 渲染的 README **保留相对图片路径**，不处理会被解析成 `tauri.localhost/...` 并返回 200 假成功

## 为什么是本地优先

行为日志只留本机，**没有服务端，也不回传**。代价很明确：达不到流媒体那种"懂所有人"的精准，因为群体协同过滤需要跨用户数据。换来的是：不需要账号系统、不需要服务器、隐私承诺是真的。

唯一的例外是翻译——开启后被翻译的简介会发给第三方翻译服务，所以默认关闭，设置页里写明。

## 目录

```
web/                 界面：React 19 + Vite + Tailwind v4
  src/App.tsx        三栏工作台外壳（Soda 的 FileManagerPage）
  src/views/         FeedView（信息流）/ DetailView（详情）/ MeView（我的）/ StatsView / SettingsView
  src/lib/bridge.ts  与 Rust 命令的类型契约；界面不碰 SQL
soda/                Soda UI 源码：ui（组件箱）+ patterns（页面骨架）+ theme（token 真源）
package.json         pnpm workspace 根（web + soda/*）
src-tauri/
  src/feed.rs        取数、配额记账、落库、斜率、规则、排序（唯一出入口）
  src/main.rs        Tauri 命令层
  src/bin/collect.rs CLI：采集 / 画像 / 探索 / 详情 / 校准 / 设置
docs/                推送子系统技术手册 v0.1.1
measurements/        上面那些"已实测事实"的原始响应与复跑脚本
tools/               WebView2 承载探针（.NET，用于在不装 MSVC 的情况下验证内嵌浏览）
```

界面用 Soda UI 的**组件箱与 token 层**（`bg-card` / `text-muted-foreground` / `gap-md`，
出现色阶数字或散装像素即越界），但页面骨架不套 `@soda/patterns` 那八个：它们定的是
"顶部标签 + 12 栏面板"的 dashboard 摆法，而这轮要的是 GitHub 的连续流。所以页面内容统一走
`web/src/components/gh.tsx` 这一层词汇（带表头的 Box、Box 里的一行、左侧导航、贡献格、语言点），
外壳仍是 `FileManagerPage`。默认主题集是 `github`（Primer 的色值 + 6px 圆角 + 无阴影），
想切回 Soda 自带的四套在设置→外观。README 那种第三方 HTML 除外，它在 `styles.css` 的 `.md`
段里按同一套 token 手写。

皮肤这层有断言守着，复跑：

```bash
corepack pnpm@10 --filter web build && node web/check-skin.mjs   # 14 条：token/默认集/逐页信息块
```

搬进来的只有 `base-nova` 一套结构样式——对照样本 vega/maia/luma 没搬，真项目留多套等于
Soda 的 ADR-101"单一真相"当场失效。同样没搬 `@tauri-apps/plugin-sql`：取数必须在 Rust 侧。

**一个上游坑，已就地补**：组件箱里写的 `data-horizontal:` / `data-vertical:` 在 Tailwind v4
下编译成 `[data-horizontal]`，而 Base UI 落在 DOM 上的是 `data-orientation="horizontal"`，
两边对不上——于是 Tabs 永远不竖排（页面标签和内容并排、被撑成一列高盒子），
Separator 高度为 0（分隔线看不见），滚动条尺寸同理。修法是 `web/src/styles.css` 里补两条
`@custom-variant`，不动 vendored 组件源码。soda-ui 自己的构建产物里同样是死选择器
（playground 只验了横向溢出所以没暴露），这条应该往上游提。

## 构建

Tauri 2 走 **GNU 工具链**（不需要 Visual Studio）。依赖 MinGW 在 PATH 里：

```bash
export PATH=/path/to/msys64/mingw64/bin:$PATH   # dlltool/windres 要能找到
corepack pnpm@10 install                        # 本机 pnpm 只能经 corepack
corepack pnpm@10 --filter web build             # 前端产物：web/dist（已 gitignore）
cd src-tauri && cargo build                     # 前端资源在编译期嵌进 exe
./target/debug/gh-feed.exe
```

改界面时用 `corepack pnpm@10 --filter web dev` 起 Vite（:1420）再配 `tauri dev` 才有热更新；
`cargo build` 出来的 exe 读的是构建那一刻的 `web/dist`，改完前端要重新 `cargo build`。

窗口 `minWidth` 定在 1024：Soda 的三栏骨架在 `lg` 以下按契约直接隐藏侧栏，没有做兜底抽屉。

采集器可以单独跑（不依赖界面）：

```bash
./target/debug/collect.exe 1 12        # 热度采集：每查询 1 页、补测 12 条曲线
./target/debug/collect.exe explore 3   # 探索池：每语言抽 3 个
./target/debug/collect.exe profile <login>   # 建画像并检索
./target/debug/collect.exe calibrate   # 分桶校准（样本 <20 的桶不生效）
./target/debug/collect.exe stats       # 看事件计数
```

数据与凭据都在 `%LOCALAPPDATA%\gh-feed\`（`gh-feed.db`、`accounts.json`、`ui.log`），**都不进仓库**。
`ui.log` 是界面自己写进去的：窗口一关就什么都没了，判成败看这份日志而不是看退出码。

## 还没做

- 场外收藏回收（手册 9.5：登录后轮询 `/user/starred`，把你在 GitHub 网页上点的 star 收回来当正样本）
- 收藏的组织结构（分类/标签/稍后看）
- 内容策略口径（破解工具、疑似营销号推不推）
- CSP（README 是外部 HTML，目前只靠正则清洗）
- 凭据换成系统钥匙串（现在是本机单独文件）
- 代码签名与自动更新（双平台约 $400~600/年）
