# GitHub 发现器 · 推送子系统技术手册 v0.1

范围：**只覆盖"推送"（画像 → 抓取 → 匹配 → 排序 → 反馈）**。不含 UI 视觉、不含账号 OAuth 流程选型、不含发布签名——那三块各自在后面单独讨论。

阅读前提：本手册的每一条设计都能回溯到第 1 节的实测数字。**没有实测支撑的地方一律标注"未核实"**，审核时请重点看这些标注，因为它们是实现时唯一会变的东西。

**修订记录**

- **v0.1.1（本轮）**：新增 9.6（内嵌浏览 + 重排版能力，已实测）；D6/L2 关闭（自建源码浏览器取消，交 WebView）；新增 D9/D10；**纠正 5.3 的斜率公式**（born7 项目只有一个周桶，原公式算不出来，改用 `days[]` 有效日前缀）；**纠正 R2**（无 star 门槛会把整个新秀通道判成刷量）；新增陈旧性按通道分档；9.1/9.3 事件补 `webview_open`/`webview_close`；第 11 节补三条"已验证但限定用途"的条目。
- **v0.1**：首版。

---

## 0. 已锁定的决策（先钉住，避免后面反复）

| 编号 | 决策 | 状态 |
|---|---|---|
| D1 | 产品定位是"发现器"，不是 GitHub 客户端 | 已定 |
| D2 | 本地优先，**无服务端**；行为日志**只留本机**，永不回传 | 已定（本轮） |
| D3 | 推送来自两条通道：① 画像驱动抓取 ② 热度驱动 + 受控探索 | 已定 |
| D4 | MVP **不引入大模型**，全部用统计方法 | 已定（本轮） |
| D5 | **群体协同过滤（CF）作废**——它需要跨用户日志，与 D2 冲突 | 已定（本轮，随 D2 自动关闭） |
| D6 | 项目内容默认**在应用内自绘展示，点卡片永不自动跳浏览器**；但保留三个显式出口并当作信号记录 | 已修订（见 9.2、9.5） |
| D7 | `in:readme` 与 `topic:` 作为召回源**永久禁用** | 本手册推出，需你确认 |
| D8 | 不做匿名模式（未登录时不承诺任何推荐能力） | 本手册推出，需你确认 |
| D9 | **内嵌浏览 + 自绘重排版能力已实测成立**（见 9.6）；但程序化取数一律走 API，WebView 只作用户视角的逃生舱 | 已实测（本轮） |
| D10 | ~~Tauri 必须用 MSVC~~ **已被推翻：windows-gnu 可行**。单独拉最新 `wry` 会导入 `api-ms-win-core-winrt-error-l1-1-0.dll`（该 API set 在 Win11 上不作为文件存在）导致起不来；改用 `web2exe-tauri` 模板里那套锁定的 tauri/wry 版本并把 MinGW 放进 PATH，GNU 产物正常运行——本仓库整个应用已连日在 `x86_64-pc-windows-gnu` 上跑通 | 已实测（推翻 v0.1.1 结论） |
| D11 | **界面层直接采用 Soda UI**（组件箱 + 页面骨架 + token 真源，源码落进本仓库 `soda/`）。取数出入口仍然只有 Rust：不引入 `@tauri-apps/plugin-sql`，前端不许写 SQL、不许自己排序打分 | 已实测 |

**D6 为什么成立（此处已修订，原来的推导是错的）。** 我原先写的是"否则就丢信号"，把"用户点了卡片就跳去浏览器"当成了既定事实——那不是事实，那是我们自己可以决定的事，所以那条推导不成立。正确的理由有三条：

1. **只有内容在自己的界面里，行为才存在。**不是"否则会丢"，而是"这样做才有"：README 滚到没滚到底、有没有看 release 列表，只在自绘界面里可测。
2. **一次跳转的成本是一整个会话。**发现流里用户要连着扫十几个项目；每次把他送到浏览器，本次使用基本就到此为止，他多半不回来。
3. **不打断才谈得上低成本划走。**"看一眼、不对、下一个"是曝光数据最密的时候，跳浏览器会把这段节奏打断。

但**反过来"永不出应用"也是错的**，三条硬理由：读源码需要跳转、blame、文件树和大文件渲染（自建能用的代码阅读器是另一个产品量级，而且会滑回你已否掉的 D1——GitHub 客户端）；`git clone`、装依赖、跑起来天然在应用外；浏览器里他带着 GitHub 登录态，看私有仓库、Discussions、CI 都零成本。**这个产品的职责是帮他决定要不要深入；他想深入时把他送出去是成功，不是漏洞。**

因此 D6 的完整表述是：**默认不出应用（点卡片永不自动开浏览器），但保留三个显式出口，并把它们当作最高价值的信号而不是需要修补的漏**（见 9.5）。代价照旧要认：README 渲染、release/issue 列表都得自己做，而且内容要额外花 API 请求去取（见第 10 节预算）。

---

## 1. 事实基线：本会话实测到的数（全部匿名请求）

这节是地基。下面每条后面的"约束"就是设计之所以那样的原因。

**1.1 配额是分池的，且匿名态极小。** 通过 `GET /rate_limit`（这个请求本身不计配额）实测：core 60、search **10**、**graphql 0**、code_search 60。

> 约束：GraphQL 匿名一次都发不出去。任何"批量富化字段"的设计在没有 token 时不成立。认证态的 core 5000/h、search 30/min 是文档口径，**未核实**（需要你的 token）。

**1.2 star 增长曲线有官方端点，且自洽。** `GET /repos/{owner}/{repo}/stargazers/history` 匿名可用，返回形如 `[{"week":1790467200,"total":95,"days":[28,17,18,15,17,0,0]}]`：按周倒序，`week` 是该周起点的 epoch 秒，`total` = 当周新增 star 数（实测等于 `days` 七个值之和），`days` 是周一到周日的每日新增。

实测两个样本：
- `vitejs/vite`：近 8 周每周新增在 95~151 之间。
- `deepseek-ai/deepseek-harness`：创建于 2026-08-13，返回 8 周（正好等于它的完整生命周期），各周新增 **119,018 → 65,219 → 18,129 → 9,871 → 8,783 → 8,900 → 6,946 → 5,061**。八周之和 = **241,927**，而仓库对象的 `stargazers_count` = **241,928**，差 1（当天未满）。

> 约束：**一次请求拿到一个项目从出生到今天的完整增长曲线，且数字自洽可校验。**这是整个热度通道能成立的原因。老仓库（5 年 +）是否需要分页，**未核实**。

**1.3 旧的逐用户 stargazers 路由已被收紧。** `GET /repos/vitejs/vite/stargazers` 带 `Accept: application/vnd.github.star+json` 匿名返回 **401 Requires authentication**。

> 约束：不能以"仓库"为单位反查它的 star 者群体。任何"谁还收藏了这个"的能力只能反过来走（以人为单位，见 1.4）。

**1.4 但"某人收藏了什么"公开可读、可整份翻、且天然按时间倒序。** `GET /users/{login}/starred` 匿名 200，`per_page=100`；从响应 `Link` 头的 `rel="last"` 页码（`per_page=1` 时）可直接读出总数：gaearon **1,493**、sindresorhus **2,938**、ruanyf **236**。加 `star+json` 媒体类型可拿到每条的 `starred_at`，且顺序按它倒序（实测一个账号返回的 5 条依次是 2026-02-02、2026-01-12、2026-01-12、2025-12-22、2025-07-15）。**这个端点吃的是 core 池**（响应头 `X-RateLimit-Resource: core`）。

> 约束：这是画像最便宜的原料来源，也是"社交通道"的实现基础。但它和仓库详情、增速曲线抢同一个池。

**1.5 Search 每个查询只能看到前 1000 条。** 实测 `page=11`（per_page=100）返回 **422 "Only the first 1000 search results are available"**。且 `total_count` 官方口径为近似值。

**1.6 非法 sort 值被静默忽略。** 传 `sort=trending` 不报错，按默认相关性返回。

> 约束：**代码不能信任排序**。任何"我以为按 X 排了"的假设必须用返回字段自校验（例如要求 `items` 的 `stargazers_count` 单调不增）。这是会悄悄出错的类别，值得写成一个断言。

**1.7 "值得关注的新项目"这个区间本身很小。** 窗口 `created:>2026-09-25`（近 7 天出生）：

| star 档位 | 数量 |
|---|---|
| 1..19 | **63,154** |
| 20..99 | **526** |
| 100..499 | **99** |
| 500..1999 | **16** |
| ≥2000 | **4** |

> 约束：**"切网格扫全库"这个担心被数据否掉了**——20 star 以上的一周新贵总共 526 个，一个查询就装得下（<1000）。探索层才需要切分（1..19 那 6.3 万）。

**1.8 GitHub search 是词面 AND，且对措辞极敏感。** 同一意图四种写法，各取前 20 名：

| 写法 | 命中总数 | 与 `local-first notes` 前 20 的重叠 |
|---|---|---|
| `local-first notes` | 2,879 | — |
| `offline-first notes` | 1,275 | **1/20** |
| `topic:local-first` | 23,603 | **2/20** |
| `local-first notes in:readme` | 101,589（`incomplete_results=true`） | **0/20** |
| `local-first zzzqqxnope` | **0** | — |

> 三条硬约束：① 单一措辞丢掉约九成应得结果 → **必须多措辞并发 + 结果融合**；② 加一个陌生词直接归零 → **画像不能把用户的词原样丢给 search**；③ 默认匹配"名字+简介"，**`in:readme` 一开就是垃圾场**（第一名 `awesome-go`，186,509 star，与笔记毫无关系）→ 永久禁用（D7）。

**1.9 内容特征的真实成色。** 从 `stars:20..99, created:>2026-09-25` 取 100 条：

| 字段 | 空率 / 值 |
|---|---|
| `description` 为空 | **16%** |
| `description` 短于 15 字符 | 1% |
| 非空 `description` 平均长度 | **101 字符** |
| `topics` 为空 | **72%** |
| `language` 为空 | 15% |
| `homepage` 为空 | 74% |
| `license` 为空 | 20% |

> 约束：可用原料只有"仓库名 + 约 100 字符简介 + 语言"三样。topic 有 72% 是空的，而且非空的那些里存在灌水：`topic:local-first` 的前几名里有多个项目 topics 数量正好是 **20**（GitHub 的上限），且 star 数高得可疑（99,111 / 73,267 / 51,550）。**所以 topic 只做排除、不做召回**（D7）。

**1.10 已观测到的一个"高 star 低实质"实例。** `deepseek-ai/deepseek-harness`：stars **241,928**、forks 29,041、**open_issues 0**、**subscribers(watchers) 1,040**、size 255,632 KB、MIT、有 homepage 有 discussions。同期随机取的新项目，stars 几百但 open_issues 是 57 / 12 / 4。

> 这条不是"它是刷的"的证据（它更像是真实爆火 + 关闭了 issue），但它证明了一件事：**只看 star 会误判，而 star 之外的三个比值能在零额外请求的情况下把这类项目标出来**（因为这三个字段都在同一个仓库对象响应里）。第 8 节的规则层据此设计。

**1.11 用户之间的 starred 共现，在本次采样下等于随机水平。** 取 gaearon / ruanyf / sindresorhus 各最近 100 条 starred（1.4 的端点）：两两交集 = **0、1、0**，300 条记录去重后剩 299 条。

> 诚实标注这个测法的偏差：三人历史分别是 1,493 / 236 / 2,938 条，我只取了各自 3%~7% 的窗口，而"够热门"的项目池撑死几万个——**两个各抽 100 的人撞车的随机期望本来就有约 0.5 条**。所以观测值 0 和 1 的含义是"没看到超出随机的信号"，**不等于共现不存在**。要分辨得整份取历史再测。
> 本手册不需要分辨它：D2（只本机）已经把群体协同过滤判掉了（D5），这条留着只是作为"将来若做服务端，先重测这个数"的备忘。

---

## 2. 系统形态

### 2.1 为什么边界画在 Rust / React 之间

一个桌面应用有两处可以写逻辑：壳里（Rust，Tauri command）和界面里（React）。本设计把所有**会花钱、会争抢配额、会改状态**的动作全部放进 Rust 侧：

- 所有 HTTP 与配额记账
- 抓取轮次的编排（多查询、退避、重试）
- 分词与索引
- 打分与排序
- 行为事件的落盘

React 只做两件事：**发起意图**（"刷新""我点开了第 3 条""这条不感兴趣"）和**渲染已经排好序的结果**。

理由不是风格偏好，是三条具体后果：① 如果把查询编排放在前端，配额就变成"每个组件各发各的"，没有任何一处能记账，限流只能靠事后报错；② 候选池是几万条规模的数组，跨 IPC 传给前端再排序，序列化和拷贝的开销会直接压住列表滚动的帧数；③ 学习循环要在打分的同时写事件，两者必须原子地在同一侧发生，否则"曝光"记录会和实际展示不一致。

### 2.2 五个子系统

```
① 采集器 Collector      按查询计划从 GitHub 捞原料，管配额与退避
② 画像器 Profiler       把用户历史变成加权词表 + 语言权重
③ 候选池 Pool           本地仓库元数据库 + 倒排索引，两条通道都往里灌
④ 排序器 Ranker         特征抽取 → 线性打分 → 打散 → 输出 N 条
⑤ 事件器 Ledger         曝光/点开/操作/收藏/负反馈 落盘，供权重校准
```

它们之间的唯一通路是 SQLite + 一层 command 接口。没有消息总线、没有"服务"。

---

## 3. 数据模型（SQLite）

命名约定：表名单数、时间统一存 UTC 秒级整数、JSON 存 TEXT。

### 3.1 账号与凭据

```sql
CREATE TABLE account (
  id            INTEGER PRIMARY KEY,
  github_login  TEXT NOT NULL,
  github_user_id INTEGER NOT NULL UNIQUE,
  auth_mode     TEXT NOT NULL,            -- pat | oauth_device
  cred_ref      TEXT NOT NULL,            -- 指向系统钥匙串的条目名，不存 token 本身
  scopes        TEXT,                     -- 逗号分隔，登录后回读
  is_active     INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL,
  last_used_at  INTEGER
);
```

**`token` 不是这张表的列。** 凭据放系统钥匙串（Windows Credential Manager / macOS Keychain / Linux Secret Service），表里只放定位它的引用名。理由是威胁模型要说得出口：真正能承诺的只有"不落明文磁盘、不进日志、不进崩溃上报、不出这台机器"，而不是"加密了所以安全"——同机同用户的攻击者拿到磁盘密钥等于拿到 token，加不加密没区别。钥匙串换来的是**磁盘层面的干净**（拷走 SQLite 文件无用），这是它唯一的正当价值，不要过度宣传。

已知实现代价（未逐一核实）：Linux 的 Secret Service 需要 gnome-keyring/kwallet 常驻，headless、WSL、CI 下会直接失败，三平台各有失败态，需要在数据模型里体现为一个 `cred_state` 字段而不只是抛错。

**原型现状（2026-10-06 修订）**：上面是目标形态，现在只做到一半——

- 凭据只有一个去处：本机 `accounts.json`（明文，不进 SQLite）。曾经并存过第二个存储
  `cred.bin`（单 token 的原型第一版），而 `token_for()` 在账号表里找不到时会回退去读它，
  于是出现"界面上把账号删了、token 其实还在被用"。这条路已拆掉，账号表是唯一真相；
  库里残留的 `account` 表也没有读者了（写它的 `whoami` 一并删除）。
- `remove_account()` 现在连带清掉 `active_login`，否则"用我自己的口味建画像"会拿一个
  已经不存在的账号去跑：请求退回匿名额度、词表却写在那个 login 名下，**而且不报错**。
- `build_my_profile` 的身份改用 `current_acct()`——"真的带着 token 的那个账号"，
  不再用 `active_login()`（它会退回 `profile_term` 的词表归属，那是原型阶段借来的公开账号
  `yyx990803`：用户点"按我自己的口味"却建出陌生人的画像，而匿名读公开 starred 连错都不报）。
- 新增 `auth_status`（`GET /rate_limit`，**不计配额**，所以可以在启动、登录类写操作之后、
  窗口重新获得焦点、配额窗口翻篇这些时刻各问一次；不做每秒轮询）。它回报
  `authed / login / mode / scopes` 与 core|search|graphql 的 limit-remaining-reset；
  带 token 却回 401/403 就标 `invalid`。界面的"匿名态"横幅与配额徽章都由它驱动。
- `scopes` 从认证响应的 `x-oauth-scopes` 头回读并存进账号表（此前恒为空，界面只能显示
  "scope 未知"）。缺 `read:user` / `public_repo` 时提示但**不拦**——fine-grained token
  不回报 scope，拦了会误伤。
- 明文 `accounts.json` 相对 §3.1 的钥匙串目标仍是未做的（见 README"还没做"）。
  将来换钥匙串只需要动 `load_accounts / save_accounts` 这一对函数。

### 3.2 仓库元数据（候选池本体）

```sql
CREATE TABLE repo (
  id             INTEGER PRIMARY KEY,     -- GitHub 的 repository id，不用 full_name 当主键
  full_name      TEXT NOT NULL,
  owner_login    TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  language       TEXT,
  topics         TEXT,                    -- JSON 数组，仅用于排除
  stars          INTEGER NOT NULL,
  forks          INTEGER,
  open_issues    INTEGER,
  subscribers    INTEGER,                 -- watchers_count，来自仓库对象的 subscribers_count
  created_at     INTEGER NOT NULL,
  pushed_at      INTEGER,
  archived       INTEGER NOT NULL DEFAULT 0,
  size_kb        INTEGER,
  license_spdx   TEXT,
  homepage       TEXT,
  first_seen_at  INTEGER NOT NULL,
  last_refresh_at INTEGER,                -- 元数据新鲜度，驱动"要不要重拉"
  star_slope_7d  REAL,                    -- 第 6 节算出的派生值，缓存住避免重复请求
  star_curvature REAL,
  spam_flag      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_repo_pushed ON repo(pushed_at);
CREATE INDEX idx_repo_stars  ON repo(stars);
CREATE INDEX idx_repo_lang   ON repo(language);
```

**用 GitHub 的数字 `id` 当主键，不用 `full_name`。** 因为仓库可以改名、可以在用户之间转移，`full_name` 会变；而 `id` 稳定。这一条如果写错，改名之后历史收藏和曝光记录会分裂成两条不相干的记录，属于会慢慢腐蚀数据的问题。

### 3.3 star 曲线

```sql
CREATE TABLE star_week (
  repo_id  INTEGER NOT NULL,
  week     INTEGER NOT NULL,              -- 该周起点 epoch 秒
  total    INTEGER NOT NULL,              -- 当周新增
  days     TEXT NOT NULL,                 -- JSON 7 元数组
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, week)
);
```

存原始终点而不是只存派生值。因为派生规则（第 6 节）一定会改，留下原料才能重算而不用重新消耗配额。

### 3.4 画像

```sql
CREATE TABLE profile_term (
  account_id INTEGER NOT NULL,
  term       TEXT NOT NULL,               -- 小写、已按同义词表归一
  kind       TEXT NOT NULL,               -- ngram | manual | synonym | starhist
  weight     REAL NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 0,  -- 由这个 term 生成的查询带来过多少正样本
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, term)
);

CREATE TABLE profile_language (
  account_id INTEGER NOT NULL,
  language   TEXT NOT NULL,
  weight     REAL NOT NULL,
  sample_n   INTEGER NOT NULL,
  PRIMARY KEY (account_id, language)
);

CREATE TABLE starred_snapshot (
  account_id INTEGER NOT NULL,
  repo_id    INTEGER NOT NULL,
  starred_at INTEGER NOT NULL,
  language   TEXT,
  PRIMARY KEY (account_id, repo_id)
);
```

**画像的本体就是 `profile_term` 这张加权词表，不是向量、不是 embedding。** 原因在第 1.8 节：它的下游消费者是词面匹配的 search，embedding 对它没用。**没有 `user_embedding` 这类表是这份设计的自觉选择，不是遗漏。**

### 3.5 查询计划（画像与抓取之间的账本）

```sql
CREATE TABLE query_plan (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL,
  q_string    TEXT NOT NULL,              -- 完整 search q
  term_ids    TEXT NOT NULL,              -- JSON：由哪些 profile_term 组成
  window_kind TEXT NOT NULL,              -- born7 | born30 | born90 | explore
  last_run_at INTEGER,
  yield_n     INTEGER NOT NULL DEFAULT 0, -- 上次实际带回多少新候选
  positive_n  INTEGER NOT NULL DEFAULT 0, -- 历史累计：它带回的东西换来多少正样本
  retired     INTEGER NOT NULL DEFAULT 0
);
```

这张表是"画像在学习"的**唯一机制**（详见 7.4）：哪条措辞真的产出了被用户点开/收藏的东西，就加权；长期零产出的自动退役。**不存这张表的话，画像会永远停在初始统计上，你以为在做闭环，其实只是每次都跑同一批查询。**

### 3.6 曝光与事件

```sql
CREATE TABLE impression (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  repo_id    INTEGER NOT NULL,
  slot       INTEGER NOT NULL,            -- 名次，去位置偏差的必需项
  channel    TEXT NOT NULL,               -- profile | hot | social | explore
  ranker_ver TEXT NOT NULL,
  ts         INTEGER NOT NULL
);

CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  repo_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,               -- open|dwell|action_readme|action_release|action_issue|action_file|open_in_browser|copy_url|copy_clone|star_in_app|hide|search|scroll_deep
  payload    TEXT,                        -- JSON：时长 / 动作计数 / hide 原因 / 搜索串
  impression_id INTEGER,                  -- 关联到那次曝光，拿得到 slot
  ts INTEGER NOT NULL
);
CREATE INDEX idx_event_repo ON event(repo_id, kind);
CREATE INDEX idx_event_acct ON event(account_id, ts);
```

`impression` 与 `event` 分表而不是塞在一起：**曝光未点是一条真实存在的记录，只是它没有对应的 event。** 塞在一起会导致你无法统计"展示了但没人点"的东西，而那是负反馈的主要来源。

### 3.7 权重与校准

```sql
CREATE TABLE feature_stat (
  account_id INTEGER NOT NULL,
  feat       TEXT NOT NULL,               -- 分桶名，如 lang_hit=yes
  n          INTEGER NOT NULL,
  n_positive INTEGER NOT NULL,
  rate       REAL AS (n_positive*1.0/NULLIF(n,0)) STORED,
  PRIMARY KEY (account_id, feat)
);

CREATE TABLE model_weight (
  account_id INTEGER NOT NULL,
  feat       TEXT NOT NULL,
  w          REAL NOT NULL,
  fitted_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, feat)
);
```

---

## 4. 通道一：画像驱动抓取

### 4.1 画像怎么算出来（冷启动，首次登录后一次性，5 分钟内）

原料按信号强度排序，**写过的强于收藏过的**：

1. `GET /users/{me}/repos?sort=updated&per_page=100` — 他自己维护的项目（1~N 页）
2. `GET /user/starred?per_page=100` 前 10 页 — 最近 1000 条收藏，带 `starred_at`
3. `GET /user/following?per_page=100` — 关注列表，供社交通道（第 5.3 节）
4. 一个**手填框**："你现在在折腾什么 / 想看什么"

成本：约 13 次 core 请求。总花费在匿名 60/h 之外（这些都要登录态），在 5000/h 里是零头。

**词表构造公式**（TF-IDF 加时间衰减）：把每个收藏项目的 `name + description` 拼成文档，分词（英文按词、camel/kebab 切开，中文按 2-gram），对每个词 t：

```
tf(t, user) = Σ_{repo} (1 + ln n_t(repo)) · exp(-Δdays / τ)      τ = 90 天
idf(t)      = ln( 1 + N_pool / df(t) )                            在本地候选池内统计
weight(t)   = tf · idf
```

τ=90 天的意思是"三年前的收藏不该继续支配今天的推送"。这个数不是最优值，是**初始值**，校准阶段（7.3）要扫它。

**关键：**`idf` 的语料是**本地候选池**，不是全网。因为没有全网词频可查，而本地池恰好就是你实际会从中推荐的集合，用它算反而更贴题。

### 4.2 措辞扩展（因为 1.8 证明单一措辞只值 5%）

MVP 阶段**不用模型**，用两个统计来源 + 一张人工表：

1. **n-gram 来源**：从收藏项目的 description 里挖高频 2~3-gram（去停用词），这些是**项目作者写给搜索引擎看的词**，最干净。
2. **人工同义词表**：`syn.yaml`，条目形如
   `local-first | offline-first | sync-free | crdt | self-hosted`
   起步 200~300 组，覆盖开发者圈的黑话即可。它同时充当**归一化字典**：画像里所有词先映射到 canonical 形式再存 `profile_term`，避免 "local-first" 和 "offline-first" 被当成两个不相干兴趣各自长权重。
3. 查询生成时，每个 canonical 概念展开成它的**全部别名**，各出一条查询。

> 这里没有大模型，所以扩展能力有上限：**表里没有的黑话组合，画像就想不到。** 这是 D4 的代价，明确认下来。它的补救只能靠 7.4 的闭环（用户主动搜索词会不断喂新词进来）和人工补表。

### 4.3 查询模板

固定四条规则：

1. 必带 `archived:false`。
2. 必带 `stars:>5`（滤掉零头；探索层例外）。
3. **永不使用 `in:readme`**（1.8 的垃圾场）。
4. 每个概念配 2~3 个出生窗口（`created:>`），窗口含义见 5.1。

单条查询形状：

```
q = <canonical 概念的一个别名> [language:<他的高权重语言>]
    stars:>5 archived:false created:>YYYY-MM-DD
sort = stars        ← 在"出生受限"的前提下，这就是增速排序（见 5.2）
per_page = 100
```

规模：12~20 个高权重概念 × 2~3 窗口 ≈ **30~60 条查询/轮**。

### 4.4 融合（RRF）

因为措辞之间几乎不重叠（1/20），**融合不是锦上添花，是正确性要求**：只用第一个命中的查询排序，会让某个措辞碰巧命中的项目霸占整个流。

```
rrf(repo) = Σ_over queries  w_q / (60 + rank_in_q)
```

`w_q` 初始为 1，跑起来以后由 `query_plan.positive_n` 归一化得到（7.4）。k=60 是 IR 领域惯例值，不是最优值。

融合完立刻做两件事：剔除 `impression` 里已出现的（同一条不重复推）、剔除黑名单，再进入候选池。

---

## 5. 通道二：热度 + 受控探索

### 5.1 三个出生窗口

| 窗口 | 含义 | 实测池子（近 7 天） | 用途 |
|---|---|---|---|
| born7 | 出生 ≤7 天 | 20..99 star：526 个 | 新秀榜，主力 |
| born30 | 出生 ≤30 天 | 需实测 | 稳步上升 |
| born90 | 出生 ≤90 天 | 需实测 | 被埋没的好项目 |
| explore | 出生 ≤7 天、star 1..19 | 63,154 个 | 探索层专用 |

born7 那一档 526 个 < 1000，**一个查询拿得完，不需要切网格**——这是 1.7 直接省掉的复杂度。explore 那档超了 63 倍，必须按 `language:` 切（二三十种语言，多数格子会落到 1000 以下），Python/JS 这类可能还得再按 star 子区间切。

### 5.2 为什么"限定出生 + 按 star 排"就等于增速榜

一个只能存在 7 天的项目，它的累计 star 数**就是**它 7 天里涨的 star 数。所以在 search 不支持趋势排序的情况下（1.5、1.6 已确认没有这个能力），**把时间窗口压进 qualifier，就等于把"累计"变成了"增量"**。这是本通道能成立的核心一步，而且零额外请求。

它的失真条件是：**窗口越长，累计里混的历史越多**。所以对进入榜前列的项目，必须做一次真实曲线复核（5.3），窗口 90 天的尤其需要。

### 5.3 曲线复核与斜率派生

对每轮进入前 150 的候选，各调一次 `stargazers/history`（1 请求/个），存进 `star_week`。

**这里有一处本轮实测纠正的公式错误。** 该端点按周聚合，而 born7 通道里的项目只出生几天——**实测三个 2026-09-29 出生的候选，返回的桶数都是 1**（就是当前这个未走完的周）。所以"取最近一个完整周求均值"对新项目**根本算不出来**，而 born7 正是热度通道主力。可用的量在桶内部的 `days[7]` 数组里（每日粒度），要按它算：

```
d[]         = 最近一个桶的 days，去掉尾部尚未发生的 0（即"有效日"前缀）
n_eff       = max(1, 有效日数)
slope_7d    = sum(d) / n_eff                         -- 日均新增，新项目也成立
slope_prev  = 若存在上一个完整周桶 ? 该桶 total/7 : null
curvature   = slope_prev ? (slope_7d + 1) / (slope_prev + 1) : null   -- 新项目没有曲率
age_days    = now - created_at
momentum    = slope_7d * min(age_days, 28) / 28       -- 压制"起跳一天就死掉"的
```

两条随之而来的规则：**`curvature` 对 `age_days < 14` 的项目必须是 null，不允许用 0 或 1 顶替**（否则排序会把"没有历史"误读成"平稳"）；凡是拿 null 曲率参与打分的项，要在卡片上如实显示"数据不足 N 天"，而不是藏起来。

`curvature` 是"发现器"最该用的量：**一个还在加速的 300 star 项目，比一个已经冷却的 20,000 star 项目更值得推送**。而冷却这件事，GitHub 官方 trending 页面不会告诉你。

### 5.4 探索层（你说的"一定的随机性"）

不是随机抽热门，是**固定保留 10~15% 的槽位给 explore 通道**，其中按语言分层随机（每语言抽 1~2 个，避免整个探索层都是 Python）。这一层的目标不是准，是让用户偶尔看到"我提前发现了个只有 8 star 的项目"。

必须配的护栏：探索层**永不与主池混排打分**，直接按槽位插入。否则它会被 1..19 star 天然低热的特征系统性压死，等于没有探索。

### 5.5 社交通道（不是 CF，是信任列表）

`GET /users/{followee}/starred?per_page=30`，对他人在关注列表里的每人 1 次请求，取最近若干条。成本：N 个关注对象 = **N 次 core/轮**（1.4 实测这个端点吃 core 池）。300 人 = 300 次 = 5000/h 的 6%。

它的价值主张和 CF 完全不同：**不需要共现密度**——"一个我信任的人收藏了它"本身就够构成推荐理由。所以它在数据极稀的情况下依然有效，这正是我们砍掉 CF（D5）之后，行为类信号唯一的存身之处。

两个必须实现的约束：
1. **过滤"大 V 且已死"的源**：实测某知名前端最新一条 star 是 8 个月前。规则：某人最近一条 `starred_at` 距今 >45 天 → 该源本轮跳过。
2. **按"他 star 的频率"给源加权**，高频活跃的源贡献更多有效内容。

---

## 6. 匹配层：为什么匹配必须在本地做

这是把两条通道接起来的地方，也是本手册最重要的一节。

1.8 证明了 GitHub search 匹配得很差：同一意图换措辞，结果集几乎不相交。**结论不是"要想更准的措辞"，而是"不要让搜索引擎做匹配"。** 正确分工是：

- **search 只当进料口**：它的任务是在出生窗口 + star 档位约束下把候选捞回来，不问口味。
- **匹配在本地做**：候选池里攒下几万条项目元数据，给它们在本地建倒排索引，用户的画像词表直接和这些本地文档算相似度。

这样做的三个好处：措辞不敏感（他 star 过的项目和候选项目都会归一到同一 canonical 词）、零配额、可解释（能说清"因为它的描述里有 X 和 Y"）。

**本地索引的具体形态**：

```sql
CREATE TABLE term_index (
  term TEXT NOT NULL, repo_id INTEGER NOT NULL, tf INTEGER NOT NULL,
  PRIMARY KEY (term, repo_id)
);
```

文档 = `name`（权重 ×2）+ `description`，去停用词、按 `syn.yaml` 归一。候选池按 1.9 的实测：84% 有简介、平均 101 字符 → **一篇文档约 15~25 个词**。

相似度用 BM25 做召回 + 余弦做精排。**一个必须注意的参数**：BM25 的长度归一参数 `b` 默认 0.75，但文档平均只有 101 字符、长度方差大，`b` 应该**调低到 0.3~0.4**，否则短文档会被过度惩罚——你会看到"描述越简洁的项目越排不上来"这种荒谬结果。`k1` 用 1.2~1.4 起步。这两个数是起点，校准阶段扫它们。

**规模感**：5 万条候选 × 101 字符 ≈ 5MB 文本，倒排表约 60~120 万行，SQLite 单机轻松。**"匹配所需的全部原料本地装得下"是砍掉大模型（D4）换来的真实优势，值得在评审时当成一条论据用。**

短文本的固有天花板也要写在这里：101 个字符表达不了一个项目的全貌，**内容相似的上限就是"领域对不对"**，它判断不了"好不好"。所以第 8 节的规则层和第 5.3 的斜率不是补充，是必需的。

---

## 7. 排序器

### 7.1 特征清单（全部本地可算，无需额外请求）

| 组 | 特征 |
|---|---|
| 内容 | `sim_bm25`、`cos_profile`、`lang_hit`(yes/no)、`term_hit_n`、`owner_hit`(是否已收藏过此人) |
| 热度 | `slope_7d`、`curvature`、`momentum`、`log_stars` |
| 维护 | `days_since_push`、`has_release_90d`、`issue_ratio`、`fork_star_ratio`、`subscribers_star_ratio`、`contrib_n` |
| 社交 | `social_hit_n`(几个关注的人收藏过)、`best_social_recency_days` |
| 疲劳 | `same_owner_shown_7d`、`same_lang_share_7d`、`impression_n_no_click`、`days_since_last_seen` |
| 负向 | `spam_flag`、`blacklist_hit`、`hide_reason_term_hit` |
| 上下文 | `slot`、`channel`、`hour_of_day`、`session_depth` |

约 25~30 维。**`slot` 必须是特征之一**，理由见 7.5。

### 7.2 打分形式

```
raw = w1·内容组 + w2·斜率组 + w3·维护组 + w4·社交组 − w5·疲劳组 − w6·负向组
final = raw + w_slot·log(slot+1)          -- 位置项单独列，学出来后可用于关掉它做重排
```

线性，不用深度模型。理由除了 D4，还有一条硬的：**逻辑回归大约需要每账号几千条标注样本**；一个活跃用户每天约 30 次曝光、有效标注约 10 条 → **需要 3~6 个月才攒够**。所以一阶段不能用它。

### 7.3 一阶段：分桶校准（数据少时唯一站得住的做法）

对每个离散特征值统计"在该条件下变成正样本的比例"：

```
rate(feat=bucket) = n_positive / n_exposed
w(feat=bucket)    = (rate + 0.05) / (global_rate + 0.05)     -- 平滑，防小样本炸权重
```

写进 `feature_stat.rate` 与 `model_weight.w`。它的好处：**20~50 条样本一个桶就有意义**、每个决定都能向用户复述（"因为你收藏过 3 个同类项目，这一类现在排得高"）、算错了肉眼能看出来。每 200 条新事件重算一次，单机耗时毫秒级。

正样本定义见 9.3。攒够 3000 条之后再切二阶段（每账号一个逻辑回归 + L2，本地训练），一阶段的分桶结果可以当作先验初始化。

### 7.4 两条回路必须分开（这是设计纪律，不是实现细节）

```
收藏 / 主动搜索  →  回写 profile_term  →  改变【抓取】：下一轮去 GitHub 捞什么
点开 / 停留 / 跳过 →  只回写 model_weight →  改变【排序】：捞回来的怎么排
```

**混用的失败模式很具体**：用户只是没滚到第 15 位，系统把这次未点当成"讨厌这个领域"，于是从画像里删掉那个词，从此不再去搜它——兴趣面自我收窄，几轮之后推什么都是"他看过的那几样"。**这就是气泡的产生机制**，而且它一旦形成，从数据上再也看不出问题（那部分候选根本没被捞回来，连曝光记录都不存在）。

护栏两条：
1. `profile_term` **只由强信号写入**：`star_in_app`、`search`、`external`。曝光未点永不影响词表。
2. 每次抓取都强制留一小撮查询用**旧措辞**跑（哪怕它 `yield_n` 已经很低）。这是防词表收敛的保险，代价是浪费一点配额，值得。

### 7.5 打散与位置偏差

**打散**：每 10 条里同 `owner` 最多 1 个、同 `language` 最多 5 个、同 canonical 概念最多 3 个。**连续 3 条不能来自同一 channel**，否则"热度榜"会挤掉画像个性化，用户会感觉"这应用根本没在读我的口味"。

**位置偏差**：用户不点第 15 位，很可能只是没滚到那儿。所以 9.1 要求 `impression` 必须存 `slot`，而 7.1 把 `slot` 当特征。校准时按名次给弱负样本降权：

```
neg_weight(slot) = 1 / log2(slot + 2)      -- 名次越靠后，"没点"越不该算负面
```

**曝光定义**：卡片进入视口 ≥50% 且驻留 ≥1 秒才算一次曝光。这条写在手册里是因为它决定了负样本干不干净——把"没看到"记成"不喜欢"，学出来的权重会系统性打死排得靠后的那类项目。

---

## 8. 规则层（反噪音，不用模型）

目标：**把"高 star 但空洞"的项目压下去**，1.10 那个实例就是这一层存在的理由。

| # | 规则 | 依据 |
|---|---|---|
| R1 | `stars>5000 且 open_issues=0` → 降权 50%，并标 `issue_closed_or_disabled` | 1.10 真实样本 |
| R2 | **仅当 `stars > 5000` 时**才检查 `subscribers/stars < 0.005` → 降权（242k star / 1040 watcher ≈ 0.0043） | 本轮实测纠正：新项目的 watcher 天然接近 0（107 star 的仓库 `watchers=0`、98 star 的 `=2`），**原规则无门槛会把整个 born7 通道全部判为可疑**——那不是反作弊，是自杀。这三个字段仍在同一个响应里，零额外成本 |
| R3 | `days[7]` 数组方差过小且周新增 >5000 → `spam_flag=1` | 1.2：真实爆火是"起跳后衰减"（119k→65k→18k→…），刷量是"每天等量直线" |
| R4 | 有 `homepage` 却 `subscribers` 极低，且 description 含营销词 → `spam_flag=1` | 1.9 homepage 空率 74%，有主页却不留 watcher 的，是导流特征 |
| R5 | `archived=true`、`pushed_at` 距今 >365 天且 topics 含停维词 → 从热度通道剔除 | 热度榜推停维项目是硬伤 |
| R6 | 同 owner 在候选池出现 >5 次且全是新项目 → 该 owner 全部降权 | 批量注册/刷量常见形态 |

实现要求：**规则只做乘性降权和标记，不做硬删**。理由是硬删不可解释也不可回滚，用户会问"为什么不给我看 X"而你答不上来；`spam_flag` 保留在库里，设置页可以给一个"显示被降权内容"的开关。这条既是对的调试工具，也是诚实的产品态度。

---

## 9. 行为事件规范

### 9.1 事件类型与字段
见 3.6 的 `impression` / `event`。`kind` 取值：

`open`（点开详情）、`dwell`（含 ms）、`action_readme`（README 滚动深度 0~1）、`action_release`、`action_issue`（看了 issue 列表）、`webview_open` / `webview_close`（L2 深度浏览，见 9.6，URL 级观测）、`open_in_browser` / `copy_url` / `copy_clone`（三个显式出口，见 9.2）、`star_in_app`、`hide`（带原因枚举）、`search`（带原始串）、`scroll_deep`（会话内滚到第几名）、`offsite_star`（9.5 回收到的场外收藏）。

`hide` 的原因枚举必须固定 4 个，不要开放输入：`too_old`、`wrong_language`、`looks_promotional`、`already_know`。**原因枚举是负反馈唯一可靠的形式**，也直接对应四条规则（`too_old`→调 R5；`looks_promotional`→加强 R3/R4）。

### 9.2 阅读深度分层：哪些必须在应用内，哪些明确交出去

`action_readme` / `action_release` / `action_issue` 这些事件的存在，完全依赖内容渲染在你自己的界面里。但不等于所有东西都要自绘——按"采集价值 vs 工程代价"分四层：

| 层 | 内容 | 是否自绘 | 取数据的请求 | 理由 |
|---|---|---|---|---|
| **L0 卡片** | 名称、简介、语言、star 曲线缩略、推荐理由 | **必须** | 0（候选池已有） | 决策发生在这里，曝光也在这里 |
| **L1 详情页** | README 渲染、最近 release、contributors、open issues 摘要、语言构成、完整 star 曲线 | **必须** | 1~4 次 core/次点开 | 这是全部行为信号（停留、滚动、动作计数）的来源，也是"值不值得深入"的判断材料 |
| **L2 源码/深度浏览** | 文件树、blame、CI 日志、Discussions、通知页 | **不自绘，交给内嵌 WebView**（见 9.6） | 0（WebView 内由 GitHub 自己请求） | 实测证明 WebView 能正常加载 github.com（HTTP 200），自建源码浏览器是重复造轮子 |
| **L3 写操作** | 评论 issue、开 PR、改设置 | **不做** | — | 一做就变成 GitHub 客户端（D1 已否）；用户在浏览器里做这些更快且已登录 |

L2 是这条链上唯一容易过度建设的口子，明确划界：**只读、不跳转、不编辑**。它的作用域止于"让我判断这东西靠不靠谱"。

三个显式出口对应三个不同的事件，强度不同，**必须分开记，不要合成一个"外部打开"**：

| 出口 | 事件 `kind` | 含义强度 | 说明 |
|---|---|---|---|
| 在浏览器打开 | `open_in_browser` | 强正 | 愿意承担切换成本去 GitHub 上看 |
| 复制仓库地址 | `copy_url` | 强正 | 他要把链接带去别处（群里问、笔记里存） |
| 复制 clone 命令 | `copy_clone` | **最强正** | 他要把它装进自己的机器 = 明确的采用意图 |

三个出口的 UI 位置都在 L1 详情页顶部，**永不在卡片上**——卡片上放跳转按钮等于在用户还没看到任何内容时就给他一条退路，会直接压低 L1 事件量，也就压掉你最好的训练数据。

### 9.3 标签分层（正负样本定义，直接决定学出什么）

| 档位 | 值 | 条件 | 备注 |
|---|---|---|---|
| 强正 | 1.0 | `star_in_app`、`copy_clone`、`open_in_browser`、`copy_url`、`offsite_star`、`webview_open`（在应用内打开深度浏览）、`search` 命中同类并点开 | 回写词表 |
| 中正 | 0.6 | `open` 且 (有效操作 ≥2 类 或 `dwell≥40s`) | 只进权重 |
| **不记** | — | `open` 但只看首屏、`dwell<10s` | **故意不记成负样本** |
| 弱负 | 0.2 | 曝光未点，按 7.5 名次衰减 | 只进权重，且**永不进词表**（7.4 纪律 1） |
| 强负 | 1.0 | `hide` 带原因；同 owner/同语言连续跳过 3 次 | 进负向规则 + 词表减分 |

**"不记"这一档是设计出来的，不是遗漏。** 随手点开又退出的行为海量存在，把它记成负样本会系统性打死"标题和简介写得吸引人"的项目——而那恰恰是好项目的特征之一。

### 9.4 保留期与形状

- `event`/`impression` 本机保留 **180 天**，滚动删除（长期数据没有边际价值，且占空间）。
- 每条事件都带 `account_id` 和 `schema_version`。**这是 D2（只本机）之下唯一为将来留的口子**：万一将来要做群体信号，导出格式已经定了，不用改表结构。但**现在不写任何发送代码**——D2 是产品卖点的一部分，不是临时妥协。

### 9.5 场外行为的回收：跳出应用 ≠ 失去观测

上面所有事件都只覆盖"在应用内发生的事"。用户有三条重要的路径在应用外：在浏览器里 star 了、clone 下来装了、在网页上把 issue 提了。如果不做处理，**你会把他的真实采用行为当成"没兴趣"**，因为这些项目在应用内没有 `star_in_app` 记录。

便宜的补救：**定期重读他自己的收藏列表。** 1.4 实测 `/users/{login}/starred` 可整份翻、按 `starred_at` 倒序、每页 100 条。所以：

```
每天 1 次：GET /user/starred?per_page=100   （新增的多半落在第 1 页）
发现本地没有的 (repo_id, starred_at) → 写 starred_snapshot + 一条 offsite_star 事件
offsite_star 的标签强度 = 与 star_in_app 同级（强正），因为它发生在 GitHub 上，是真实动作
```

成本 1~3 次 core 请求/天，几乎免费。这条通道的存在还有第二个作用：**它是画像的持续供料**，即使用户这周完全没打开你的应用，他 star 过的东西仍然会把新词喂进 `profile_term`（7.4 的纪律允许：star 是强信号）。

要写清的边界三条：
1. **时间对齐**：`offsite_star` 只在他 star 之后的若干天内有推荐意义。如果某项目他半年前 star 的、你的候选池今天才发现它，那是"你晚了半年"，不是"验证了你的判断"。所以 `offsite_star` 只在 `first_seen_at` 早于 `starred_at` 时才算命中推荐链路，否则只进画像不进正样本统计。
2. **本地收藏与官方 star 是两个动作，不要合并语义。**`star_in_app` 是"我要留着看"（组织行为，可以有很多），`star_on_github` 是"我公开支持它"（低频、社交性、更强）。建议提供一个可选开关"把这条同步 star 到 GitHub"，**默认关**，且需要 `public_repo` 写权限（回到未决的 Q1 账号轴）。
3. **别顺手读他的公开活动流来做推荐**。技术上可行（`/users/{me}/events` 含他 star 了谁、fork 了什么），但它同样包含 he *unstarred* 之类噪声动作，且信息基本已被 `offsite_star` 覆盖。**不实现**。

### 9.6 内嵌浏览与重排版：已实测成立的能力（本轮新增）

这一节记的是**已经在这台机器上跑出来的结果**，不是设计意图。三项能力全部成立：

| # | 能力 | 验证手段 | 实测结果 |
|---|---|---|---|
| 1 | 内嵌 WebView 加载 GitHub 页面 | .NET WinForms 承载 WebView2 控件，导航 `github.com/vitejs/vite` | `NavigationCompleted success=True status=200`；宿主能收到 `NavigationStarting`（含 `IsUserInitiated`、可 `Cancel`） |
| 2 | 内嵌 WebView 加载**我们自己重排**的页面 | `SetVirtualHostNameToFolderMapping` 把本地目录映射成假域名后导航 | `status=200`，卡片流 / 语言标签 / 增速柱状图 / 内嵌 README 全部正常渲染 |
| 3 | 解析 GitHub 页面拿到结构化数据 | 抓仓库页 HTML，定位 `<script type="application/json" data-target="react-app.embeddedData">` | 命中。vite 页 317KB 中该 JSON 占 22KB，字段见下表 |

**能力 1 的一个前提**：GitHub 对页面设了 `X-Frame-Options: deny` 与 CSP `frame-ancestors 'none'`，所以 **iframe 方案永久不可行**；而 WebView2 里 GitHub 是**顶层文档**，不受该约束——这就是"能内嵌"与"不能内嵌"的分界线。

**页面解析能拿到什么（实测三个 born7 候选）**：`sidebarAbout{description, website, topics[], stargazerCount, watcherCount, forksCount, ownerLogin, repoName, isOrg}` + `overview{commitCount, overviewFiles[0].richText(README 渲染 HTML，实测 20,926~105,536 字符)}`。

**与 API 的对照结论：信息零增益。** 除 `commitCount` 与"已渲染的 README"外，页面里每个字段 `GET /repos/{o}/{r}` 都给；而**页面里没有** release / languages / contributors / issues / **star 增长曲线**（这些是页面二次异步请求），API 全都有。省下的只是请求次数——而第 10 节已实测配额占用仅 15%，**省请求在这个架构里不值钱**。

代价实测到三条：① 317KB vs API 约 6KB，**流量 50 倍**；② 页面给的 README 里图片是 `camo.githubusercontent.com` 的**签名代理 URL**，实测出现坏链，而 API 给 markdown 源 + 原始直链，自绘反而更干净；③ `robots.txt` 的 `User-agent: *` 明确 `Disallow` 了 `/*/tree/`、`/*/*/commits/`、`/*/*/graphs`——**正是我们要解析的那批路径**；且 `embeddedData`、`sidebarAbout` 这些名字没有任何兼容承诺，而桌面端**没有服务端可以热修解析器**。

**由此定的架构（一句话：能力保留，用途限定）**

- **程序化取数一律走 API。** 页面解析不进主链路。
- **WebView 只作"用户视角的逃生舱"**：L2 源码浏览、blame、CI 日志、Discussions、通知页这些 API 拿不全的东西，由用户主动打开、GitHub 自己渲染。这也顺带替掉了原设计里"自建只读源码浏览器"那一整层工程。
- **WebView 只做 URL 级观测，绝不解析它的 DOM**：DOM 级观测有三个必然失败点——用户一跳就跨域断线、GitHub 改版即失效、别人页面的语义与我们的不可比。所以事件只有两个：

```sql
-- 追加到 9.1 的 kind 枚举
webview_open   { repo_id, url, ts }                    -- 强正样本档（9.3）
webview_close  { repo_id, dwell_ms, final_host, ts }   -- final_host 用来识别"跳出站外"
```

  代价说清：拿不到"他看了 README 还是看了 issue"那种细粒度——**那种精度只有 L1 自绘页提供**，这也正是 L1 必须自绘的理由。
- **重排版能力用在刀刃上**：它服务于"我们自绘的详情页"（L1，数据来自 API），不服务于"搬运 GitHub 页面"。

**工具链事实（D10，已更正）**：`wry` 在 `x86_64-pc-windows-gnu` 下的表现**取决于版本**：单独拉最新 wry 会编译通过但产物起不来——导入表里写着 `api-ms-win-core-winrt-error-l1-1-0.dll`，而该 API set 在 Windows 11 上已作为文件不存在（实测 `System32` 里没有），运行即 `error while loading shared libraries`；改用 `web2exe-tauri` 模板锁定的 tauri 2.11.6 / wry 0.55.1 / tao 0.35.3，并把 MinGW（`dlltool`/`windres`）放进 PATH，GNU 产物就正常运行。**不需要 MSVC**，本机整个应用已连日在 GNU 上跑通。本轮那三项 WebView2 能力验证是在**不装任何东西**的前提下完成的：NuGet 解包 `Microsoft.Web.WebView2`（9.8MB）+ 系统已装的 WebView2 运行时 154.0.4258.48 + Windows PowerShell 5.1 承载——它证明的是"WebView2 能加载 github.com"，与用哪套 Rust 工具链无关。

两个附带踩到的实现坑，记下来省后人时间：**PowerShell 5.1 按 GBK 读 `.ps1`**，脚本里写中文字面量会在解析阶段炸（表现是"日志空 + exit 1"），所以承载脚本要纯 ASCII；**P/Invoke 声明 `GetWindowTextW` 必须带 `CharSet=CharSet.Unicode`**，否则按 ANSI 解 UTF-16，标题只读得到第一个字符，窗口枚举会假性"找不到窗口"。

---

## 10. 配额预算（把每天花多少写成可对账的账）

**每账号每轮（每天 1~2 轮）：**

| 动作 | 请求数 | 池 |
|---|---|---|
| 画像查询 30~60 条 | 30~60 | search |
| 探索层按语言切格 | 15~25 | search |
| 三个出生窗口的热度榜 | 3~6 | search |
| **search 小计** | **48~91** | — |
| 曲线复核（前 150 候选） | ≤150 | core |
| 新候选的详情补齐 | 50~100 | core |
| 社交源（N=300） | 300 | core |
| 用户点开 L1 详情（约 25 次 × 1~4） | 25~100 | core |
| L2 源码只读（若做，约 8 次 × 3~8） | 0~64 | core |
| 场外 star 回收（9.5，每天 1 次） | 1~3 | core |
| 画像重建（仅每天首轮） | 13 | core |
| **core 小计** | **539~730** | — |

**结论**：search 91 次 / 分钟级池（认证口径文档说 30/min，**未核实**）→ 约 3~4 分钟跑完进料；core 最多 730 次 / 小时 5000（**未核实**）→ 每小时预算的 15%。**两条通道合起来一天用不掉配额，配额在这个架构下不再是瓶颈**——这正是从"扫全库"换成"按人抓取"省下的东西，也是本次改架构的实际收益。

**仍然要做的三件防护**（不能因为"够用"就不写）：
1. 单一记账点，所有请求走同一个出口并扣账，剩余额度低于阈值时**先砍社交源、再砍复核数量，永不砍抓取轮次**（用户等得到内容比看到大 V 动态重要）。
2. 429 与 `Retry-After`、以及 `X-Ratelimit-Resource` 都要读——二级限制（并发连接、CPU 时间）不给清晰语义，只会 403/429，退避策略必须按资源池分别做。
3. 条件请求（`ETag`/`If-None-Match`）**是否真的省配额，未核实**（社区里有"304 也计一次"的报告）。在实测之前，把它当"省流量"用，不要写进配额预算表。

---

## 11. 明确不做的事（防止实现时又被加回来）

| 砍掉 | 理由 |
|---|---|
| 群体协同过滤 | 与 D2 冲突；且 1.11 实测三人各 100 条 starred 交集 0/1/0 ≈ 随机水平，即使将来有服务端，也要先重测整份历史才知道有没有信号 |
| 大模型摘要/评分 | D4；且成本机制（漏斗+缓存）还没被验证必要 |
| 本地 Ollama | 5~9GB 模型、需独显、CPU 上几十分钟一轮，把用户群收窄到有 GPU 的开发者 |
| 服务端与 token_hash | 只本机（D2），并且那个"只存 SHA256(token)"的设计本身就是错的（hash 即可用凭证） |
| 匿名模式 | 未登录 core 60/h、search 10/min、**graphql 0**（全部实测），刷不出内容流 |
| 用页面解析**替代** API 取数 | 9.6 实测：能力成立，但相对 API **信息零增益**（只多一个 `commitCount` 和一份已渲染 README），代价是 50 倍流量、camo 签名图片坏链、robots 明确 Disallow 目标路径、字段名无兼容承诺且无服务端可热修 |
| HTML 抓 trending 页 | 同上理由；且 5.2 已给出零成本的等价物（出生窗口 + `sort=stars`） |
| 在 WebView 里注入脚本读 DOM | 9.6：跨域即断线、改版即失效、语义与自绘页不可比。只记 URL 级两个事件 |
| `in:readme` | 1.8 实测：10 万条、`incomplete=true`、榜首是 awesome-go |
| topic 召回 | 1.9 实测：72% 为空，非空里有 20/20 灌水的 |
| GH Archive / ClickHouse 全库聚合 | 每天数 GB + 要服务器；本会话对公共 ClickHouse 实例的探测因认证参数失败，**未定性**，但架构上已不需要它 |
| 停留时间当唯一信号 | 9.3 里它只是"中正"档的一个条件，不单列 |

---

## 12. 实施顺序与每阶段的验收（数字必须能测）

**M1 数据管道**（无 UI）：`repo`/`star_week`/`term_index` 建表 + 采集器 + 配额记账。
验收：给定一个出生窗口，能产出 ≤1000 条候选、曲线复核成功率 >95%、一轮请求数落在 10 节的预算表内、429 时不丢数据。

**M2 画像与本地匹配**：4.1~4.4 + 第 6 节。
验收：**不做任何"懂用户"的假设**，只测召回——手工准备 3 个真人的 starred 列表作测试集，画像词表能覆盖其中 ≥60% 的 canonical 概念；且同一概念的不同别名能被归一到同一条目（1.8 的失败模式不再出现）。

**M3 排序与规则**：第 7、8 节，先用默认手工权重。
验收：一个空白用户和一个真实画像用户，**前 20 条的差异 ≥ 12 条**（否则说明排序几乎不看画像，只是在排热度——那是这类产品最常见的静默失败）。

**M4 应用内详情 + 事件回写**：D6 + 第 9 节。
验收：`impression` 有 slot、有 `action_*` 事件、7.3 的分桶表能输出第一个校准结果，并且能举出一条"因为你的行为所以这条排高了"的可解释理由。

**M5 多账号与钥匙串**：账号轴（未决 Q1）定下来之后做。

---

## 13. 需要你确认或拍板的事

**要确认的两条推出结论**（0 节标了"需你确认"）：D7 禁用 `in:readme` 与 topic 召回、D8 不做匿名模式。
**D6 / L2 已在本轮关闭**：实测证明内嵌 WebView 能正常加载 github.com（9.6），所以"自建只读源码浏览器"整层取消，L2 交给 WebView；重排版能力保留但只服务自绘详情页。这里不再有待拍项。

**要你拍的**：
- **Q1 账号形态仍未定**（这是账号轴，第 0 节之外唯一的空白）：让用户粘 PAT / OAuth App device flow / GitHub App device flow。它决定 `auth_mode`、token 生命周期、"重新授权"这个功能要不要存在。**已实测的相关事实**：桌面端走标准 web flow 需要 `client_secret`（文档表里仍是 Required），所以要么 device flow，要么粘 PAT。
- **Q2 通道配比**：我建议 画像 60% / 热度 20% / 社交 15% / 探索 5%。探索层是固定槽位插入（5.4），不参与混排。
- **Q3 是否接受"内容相似只能判断领域对不对，判断不了好不好"**这个天花板（第 6 节末）。它意味着热度斜率和规则层不是补充而是必需；也意味着用户不能只靠"口味相似"被留住。

**我标为未核实、需要 token 才能测完的**：认证态 core/search 的真实额度、GraphQL 批量富化的点数成本、304 是否消耗配额、star history 在老仓库上的分页行为。这些不影响本手册的架构结论，但影响 M1 的实现参数。

**Q4 工具链 —— 已关闭（2026-10-06）**：不需要装 MSVC，也不需要装 VS Build Tools。`windows-gnu` 可行的前提是**版本取自 `web2exe-tauri` 模板的 `Cargo.lock`**（tauri 2.11.6 / wry 0.55.1 / tao 0.35.3）；当时"起不来"是因为单独拉了最新 wry，它导入 `api-ms-win-core-winrt-error-l1-1-0.dll` 而该 API set 在 Win11 上不作为文件存在。换回锁定版本 + MinGW 进 PATH 之后，本机连日构建运行的都是 GNU 产物，Tauri 集成（`WebviewWindowBuilder` 开外部 URL、界面内 README 重排版）也已跑通。

---

## 附录 A：取证命令（全部可复跑）

```bash
# 1.1 各配额池（此请求不计配额）
curl -s https://api.github.com/rate_limit -H 'Accept: application/vnd.github+json'

# 1.2 star 增长曲线，并自校验（各周之和 应≈ stargazers_count）
curl -s https://api.github.com/repos/deepseek-ai/deepseek-harness/stargazers/history
curl -s https://api.github.com/repos/deepseek-ai/deepseek-harness

# 1.3 旧的逐用户 stargazers 已需认证
curl -si 'https://api.github.com/repos/vitejs/vite/stargazers?per_page=1' \
     -H 'Accept: application/vnd.github.star+json' | head -1

# 1.4 某人 starred 的总数与顺序（读 Link 头拿总页数）
curl -si 'https://api.github.com/users/sindresorhus/starred?per_page=1' | grep -i '^link'
curl -s  'https://api.github.com/users/sindresorhus/starred?per_page=5' \
     -H 'Accept: application/vnd.github.star+json'

# 1.5 1000 条上限
curl -si 'https://api.github.com/search/repositories?q=created:%3E2026-08-01+stars:%3E100&per_page=100&page=11' | head -1

# 1.7 出生窗口 × star 档位的池子大小
curl -s 'https://api.github.com/search/repositories?q=created:%3E2026-09-25+stars:20..99&per_page=1'

# 1.8 措辞敏感度 / in:readme 的垃圾场
curl -s 'https://api.github.com/search/repositories?q=local-first+notes&per_page=20&sort=stars'
curl -s 'https://api.github.com/search/repositories?q=local-first+notes+in:readme&per_page=20&sort=stars'

# 1.9 字段成色（100 条样本）
curl -s 'https://api.github.com/search/repositories?q=created:%3E2026-09-25+stars:20..99&per_page=100'
```

原始响应留在 `measurements/`（本目录旁），编号对应：`g1..g5`=档位、`a1..a5`=措辞实验、`samp.json`=字段成色、`dh*.json`=那 24 万 star 的曲线、`sr_*.json`=三个人的 starred。

## 附录 B：内嵌浏览与重排版探针（9.6 的证据，可复跑）

全部**不需要安装任何东西**：NuGet 解包 + 系统已装的 WebView2 运行时 + Windows PowerShell 5.1 承载。

| 文件 | 作用 |
|---|---|
| `webview2net/host.ps1` | 用 WebView2 控件加载**真实 GitHub 页面**，记 `NavigationStarting/Completed/DocumentTitleChanged`；把 user-data 目录显式指到 `webview2net/udf/` 以观察 cookie 落盘 |
| `webview2net/hostui.ps1` | 加载**我们自己重排的页面**：`SetVirtualHostNameToFolderMapping('probe.local', measurements/)` 后导航 `https://probe.local/layout.html` |
| `webview2net/shotwin.ps1` | 按窗口标题抓该窗口矩形截图（不是全屏，避免拍到桌面其它内容） |
| `measurements/anatomy.js` | 解剖仓库页：列出 JSON island、`embeddedData` 键、README `richText` 体量、class 属性计数 |
| `measurements/relayout.js` | 抓 3 个 born7 候选的页面 + `stargazers/history`，输出对照结论与 `layout.html` |

复跑：

```bash
cd measurements && node relayout.js            # 生成 layout.html 并打印字段来源对照
cd ../webview2net
powershell -NoProfile -ExecutionPolicy Bypass -File ./host.ps1   # 看 GitHub 真页
powershell -NoProfile -ExecutionPolicy Bypass -File ./hostui.ps1 # 看我们重排的页
powershell -NoProfile -ExecutionPolicy Bypass -File ./shotwin.ps1 -Out win.png
```

已知环境前提（缺一条就跑不通，都踩过）：`github.com` 直连被重置，**必须走 `127.0.0.1:7890` 代理**（脚本里以 `--proxy-server` 传入）；`.ps1` 里**不能写中文字面量**（PowerShell 5.1 按 GBK 解析会炸）；`GetWindowTextW` 的 P/Invoke 必须 `CharSet=CharSet.Unicode`。

`webview2net/udf/` 是探针留下的浏览器 profile（含 `EBWebView/Default/Network/Cookies`），属于可清理的临时产物。
