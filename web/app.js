import * as api from "./api.js";

const $ = (s) => document.querySelector(s);

// 封面兜底用的色相：按 id 取，避免相邻两张卡撞成同一个颜色
const PAL = [8, 26, 44, 92, 142, 168, 192, 214, 248, 282, 316, 340];

// GitHub 的语言色，只为让列表扫起来有辨识度
const LC = {
  Rust: "#dea584", Python: "#3572A5", TypeScript: "#3178c6", JavaScript: "#f1e05a",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", C: "#666", Zig: "#ec915c",
  Kotlin: "#A97BFF", Swift: "#F05138", Ruby: "#701516", PHP: "#4F5D95",
  "C#": "#178600", Dart: "#00B4AB", Lua: "#000080", Shell: "#89e051", HTML: "#e34c26",
};

const S = {
  feed: [],
  savedList: [],
  savedIds: new Set(),
  view: "feed",
  cat: "",
  query: "",
  cols: 0,
  heights: [],
  buckets: [],
  rendered: 0,
  host: null,
  // 「我的」：me 为空且 meTried 为假时才自动登录一次，
  // 用户手动退出后 meTried 保持为真，不会再偷偷登回去。
  me: null,
  myRepos: [],
  meBusy: false,
  meErr: "",
  meTried: false,
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const hue = (id) => PAL[Math.abs(id) % PAL.length];

const fmt = (n) =>
  n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);

function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const d = (Date.now() - t) / 864e5;
  // 小时粒度是必要的：采集的都是近 90 天内推送的项目，
  // 只显示「今天」会让所有卡片看起来一样新，时效感就没了。
  if (d < 0.042) return "刚刚";
  if (d < 1) return `${Math.max(1, Math.floor(d * 24))} 小时前`;
  if (d < 2) return "昨天";
  if (d < 30) return `${Math.floor(d)} 天前`;
  if (d < 365) return `${Math.floor(d / 30)} 个月前`;
  return `${Math.floor(d / 365)} 年前`;
}

/* ── 卡片 ───────────────────────────── */

// 卡片头部展示的是「这个项目自己怎么写自己」：README 的首图 + 首段。
// 所以三种形态共用一块地方：
//   有图 → 铺图；图挂了或本来没图 → 露出底下的 README 摘录；
//   连 README 都没有 → 退回首字母色块。
// README 的标题多数就是项目名，下面已经有名字了，再写一遍是噪音。
// 只有它比名字多说了点什么（"Learn Rust, one exercise at a time"）才值得当标题。
function distinctTitle(r) {
  const t = r.readme_title || "";
  const n = r.name || "";
  return t && t.toLowerCase() !== n.toLowerCase() && t.length > n.length + 3 ? t : "";
}

function coverHTML(r) {
  const letter = esc((r.name || "?")[0].toUpperCase());
  const hasImg = !!r.cover_url;
  const kind = r.cover_kind || "shot";
  // 宽高比超过 2.2 的图（1175 张里有两百来张）塞进 16:10 会把左右裁掉，
  // `One account. One API ke...` 这种断字比图小一圈更难看，改成完整显示。
  const wide = hasImg && r.cover_h > 0 && r.cover_w > r.cover_h * 2.2;
  const cls = hasImg
    ? `is-img is-${kind}${wide ? " is-wide" : ""}`
    : r.readme_head || r.readme_title
      ? "is-doc"
      : "is-plain";
  const t = distinctTitle(r);
  const showTitle = !!t;
  const img = hasImg
    ? `<img class="shot" src="${esc(r.cover_url)}" alt="" decoding="async" referrerpolicy="no-referrer">`
    : "";
  const snip = `
    <div class="snip">
      ${showTitle ? `<div class="rt">${esc(t)}</div>` : ""}
      ${r.readme_head ? `<p class="rp">${esc(r.readme_head)}</p>` : ""}
      ${!showTitle && !r.readme_head ? `<span class="fb">${letter}</span>` : ""}
    </div>`;
  return `<div class="cover ${cls}">
    ${snip}${img}
    ${cls === "is-doc" ? `<span class="rtag">README</span>` : ""}
    <span class="cnt">${fmt(r.stars)}<i>★</i></span>
    <button class="save ${r.saved ? "on" : ""}" data-act="save" data-id="${r.id}" title="收藏">♥</button>
  </div>`;
}

// README 首段和 GitHub 上的简介经常是同一句话。
// 头部已经把它完整显示出来了，卡片底部再抄一遍就是重复。
//
// 不能按前缀比：`Go client for Kubernetes.` 和 `Go clients for talking to a
// kubernetes cluster.` 一个字都对不上，说的是同一件事。按词的重叠率才认得出来。
function overlap(desc, head) {
  const words = (s) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .map((w) => w.replace(/s$/, ""))
    );
  if (!desc || !head) return false;
  const A = words(desc);
  const B = words(head);
  if (A.size < 3) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / A.size >= 0.75;
}

// 卡片信息编排照小红书：标题一行、简介两行、底部一行「头像 + 作者 + 数字」。
// 项目名当标题，作者降级到底部那一行 —— 铺主是谁不该比项目叫什么更显眼。
function cardHTML(r) {
  const lang = r.language
    ? `<span class="lang" style="color:${LC[r.language] || "#9a9aa1"}"><i class="d"></i>${esc(r.language)}</span>`
    : "";
  // 头部没图时展示的就是 README 首段，底部再抄一遍简介就是重复。
  // 有图的卡片头被图盖住了，简介还得留着。
  const dup = !r.cover_url && overlap(r.description, r.readme_head);
  const desc = dup ? "" : r.description || "";
  return `<article class="card" data-id="${r.id}" style="--h:${hue(r.id)}">
  ${coverHTML(r)}
  <div class="body">
    <h3 title="${esc(r.full_name)}">${esc(r.name)}</h3>
    ${desc ? `<p>${esc(desc)}</p>` : ""}
    <div class="foot">
      <span class="ava">${esc((r.owner || "?")[0])}</span>
      <span class="who">${esc(r.owner)}</span>
      <span class="sp">${lang}</span>
    </div>
  </div>
</article>`;
}

/* ── 瀑布流 ─────────────────────────── */

// 卡宽 165 是 5 列挤出来的结果，读起来太窄；宁可少一列也要让每张卡喘得过气。
// 460 这一档实测会落到 147px，字都挤成竖条了，所以提到 500。
function colsFor(w) {
  if (w < 500) return 2;
  if (w < 720) return 3;
  if (w < 1000) return 4;
  return 5;
}

/* ── 翻译：滚到才翻 ────────────────────────
   没有预翻译。卡片进入视口才进队列，划走的根本不发请求；
   翻过的记在 memo 里，滚回来直接贴，不再算第二遍。
   本地词典是纯计算，一批 30 条也就一两毫秒，所以「看到才翻」
   在体验上跟本来就有的中文没差别。 */
const TR = {
  on: true,
  ready: false,
  engine: "",
  obs: null,
  q: [],
  timer: 0,
  busy: false,
  memo: new Map(),
};

const trKey = (id, f) => id + "\u0000" + f;

/* 一张卡上值得翻的地方，就两处：
   底部那行简介，和封面里那段 README 摘录。
   摘录占了封面整块面积，英文摆在那儿比简介还显眼。 */
function trTargets(card, r) {
  const out = [];
  const d = card.querySelector(".body p");
  if (d && r.description) out.push({ el: d, f: "desc", text: r.description });
  const p = card.querySelector(".cover .rp");
  if (p && r.readme_head) out.push({ el: p, f: "head", text: r.readme_head });
  // 封面标题（README 的一级标题）。项目名那种一个词的留着，
  // 一句话的标题翻掉——`MemoryBear — Empowering AI with Human-Like
  // Memory` 摆在封面正中，是整张卡最大的一行英文。
  const t = card.querySelector(".cover .rt");
  if (t && r.readme_title && r.readme_title.trim().split(/\s+/).length >= 3) {
    out.push({ el: t, f: "title", text: r.readme_title });
  }
  return out;
}

function trSetup() {
  if (!("IntersectionObserver" in window)) return;
  TR.obs = new IntersectionObserver(
    (entries) => {
      let queued = false;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        TR.obs.unobserve(e.target);
        const r = e.target.__repo;
        if (!r) continue;
        for (const t of trTargets(e.target, r)) {
          const text = t.text.trim();
          // 本来就带中文的不排队，翻了也是原样返回，白占一个批次
          if (!text || !/[a-zA-Z]{3}/.test(text) || /[\u4e00-\u9fff]/.test(text)) continue;
          const key = trKey(r.id, t.f);
          const hit = TR.memo.get(key);
          if (hit) {
            trApplyEl(t.el, hit);
            continue;
          }
          TR.q.push({ key, text, el: t.el });
          queued = true;
        }
      }
      if (queued) trKick();
    },
    { rootMargin: "400px 0px" }
  );
}

function trWatch(el, r) {
  el.__repo = r;
  if (TR.on && TR.obs) TR.obs.observe(el);
}

function trKick() {
  if (TR.timer || TR.busy) return;
  TR.timer = setTimeout(trFlush, 90);
}

async function trFlush() {
  TR.timer = 0;
  if (!TR.q.length || TR.busy) return;
  const batch = TR.q.splice(0, 30);
  TR.busy = true;
  try {
    const zh = await api.trLines(batch.map((b) => b.text));
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const t = zh && zh[i];
      if (!t || t === b.text) continue;
      TR.memo.set(b.key, t);
      if (b.el.isConnected) trApplyEl(b.el, t);
    }
  } catch {
    // 翻不动就保持原文。用户看的是内容，不是我们的内部状态，
    // 没必要为一句翻译在卡片上挂个红条。
  } finally {
    TR.busy = false;
    if (TR.q.length) trKick();
  }
}

// 原文先记在元素上，关掉开关时才有东西贴回去
function trApplyEl(el, text) {
  if (el.__orig == null) el.__orig = el.textContent;
  el.textContent = text;
}

function trRestoreEl(el) {
  if (el.__orig != null) el.textContent = el.__orig;
}

/// 开关切换：关掉就把英文贴回去，打开就重扫一遍当前视口。
function trToggle() {
  TR.on = !TR.on;
  const b = document.querySelector("#trbtn");
  if (b) b.classList.toggle("on", TR.on);
  for (const c of document.querySelectorAll(".card")) {
    const r = c.__repo;
    if (!r) continue;
    if (TR.on) {
      let miss = false;
      for (const t of trTargets(c, r)) {
        const hit = TR.memo.get(trKey(r.id, t.f));
        if (hit) trApplyEl(t.el, hit);
        else if (/[a-zA-Z]{3}/.test(t.text)) miss = true;
      }
      if (miss) TR.obs?.observe(c);
    } else {
      for (const t of trTargets(c, r)) trRestoreEl(t.el);
    }
  }
}

/// 详情头部的简介和引文也得翻。
/// 简介多半已经在 memo 里（卡片上翻过了），直接贴；
/// 引文是 readme_head 渲染出来的 HTML，得把原文整段再过一次 md 翻译，
/// 重新渲染才能保住里面的链接。
async function trDetail(r) {
  if (!TR.on) return;
  const d = $("#modal .mdesc");
  if (d && r.description && !/[\u4e00-\u9fff]/.test(r.description)) {
    const key = trKey(r.id, "desc");
    const hit = TR.memo.get(key);
    if (hit) {
      trApplyEl(d, hit);
    } else {
      try {
        const [t] = await api.trLines([r.description]);
        if (t && t !== r.description) {
          TR.memo.set(key, t);
          if (d.isConnected) trApplyEl(d, t);
        }
      } catch {
        /* 翻不动就留原文 */
      }
    }
  }
  const q = $("#modal .mquote p");
  if (q && r.readme_head && !/[\u4e00-\u9fff]/.test(r.readme_head)) {
    try {
      const zh = await api.trMd(r.readme_head);
      if (zh && zh !== r.readme_head && q.isConnected) {
        const base = `https://raw.githubusercontent.com/${r.full_name}/HEAD/`;
        const abs = `https://github.com/${r.full_name}/blob/HEAD/`;
        q.innerHTML = teaser(zh, base, abs);
      }
    } catch {
      /* 同上 */
    }
  }
}

function resetGrid(host) {
  host.innerHTML = "";
  S.host = host;
  // clientWidth 含左右 padding，直接拿它算列宽会高估，列数就会多一档
  const cs = getComputedStyle(host);
  S.avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  S.cols = colsFor(S.avail);
  S.heights = new Array(S.cols).fill(0);
  S.buckets = [];
  for (let i = 0; i < S.cols; i++) {
    const c = document.createElement("div");
    c.className = "col";
    host.appendChild(c);
    S.buckets.push(c);
  }
  S.rendered = 0;
}

function estimate(r, colW) {
  const chars = (r.description || "").length;
  const per = Math.max(10, Math.floor(colW / 7));
  const lines = Math.min(2, Math.max(1, Math.ceil(chars / per)));
  // 头部：有图是 16:10；有 README 文字时按行数估，再拿 min-height 兜一下；
  // 什么都没有才是纯色块，也按 16:10 走。
  const cover =
    r.cover_url || !r.readme_head
      ? colW * 0.625
      : Math.max(
          104,
          40 + 18 + Math.min(4, Math.ceil((r.readme_head.length || 0) / Math.max(12, Math.floor(colW / 7)))) * 20
        );
  // 卡内正文：上下内边距 22 + 标题一行 20 + 简介若干行 + 底部作者行 26
  return cover + 22 + 20 + lines * 19 + 3 + 26;
}

// 按估算高度投到最矮的一列。
// 不用 CSS columns 是因为它按列优先填充，阅读顺序会变成竖着走。
function append(list) {
  const gap = 16;
  const colW = ((S.avail || S.host.clientWidth) - (S.cols - 1) * gap) / S.cols;
  for (const r of list) {
    let idx = 0;
    for (let i = 1; i < S.heights.length; i++) if (S.heights[i] < S.heights[idx]) idx = i;
    S.buckets[idx].insertAdjacentHTML("beforeend", cardHTML(r));
    const el = S.buckets[idx].lastElementChild;
    if (el) trWatch(el, r);
    S.heights[idx] += estimate(r, colW) + gap;
  }
}

// 当前该显示哪些项目：先按视图，再按分类，最后按搜索词。
// 搜索在内存里做，只覆盖已加载的那批 —— 见 boot() 里的说明。
function sourceList() {
  let list = S.view === "feed" ? S.feed : S.savedList;
  if (S.cat) list = list.filter((r) => r.language === S.cat);
  if (S.query) {
    const q = S.query.toLowerCase();
    list = list.filter(
      (r) =>
        (r.full_name || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.readme_head || "").toLowerCase().includes(q) ||
        (r.language || "").toLowerCase().includes(q) ||
        (r.topics || []).some((t) => t.toLowerCase().includes(q))
    );
  }
  return list;
}

function loadMore() {
  const src = sourceList();
  if (S.rendered >= src.length) return;
  const chunk = src.slice(S.rendered, S.rendered + 40);
  append(chunk);
  S.rendered += chunk.length;
}

function renderView() {
  const feedEl = $("#feed");
  const savedEl = $("#savedview");
  const meEl = $("#meview");

  // 对账：浮层已经关了、遮罩类却还挂在 body 上。
  // dim 会让 .main 整体压暗且 pointer-events:none —— 看着像界面坏了，
  // 严重的是连点都点不动。正常关闭都会清，这里兜的是异常路径和调试残留。
  const modalEl = $("#modal");
  if (modalEl && modalEl.hidden && document.body.classList.contains("dim")) {
    document.body.classList.remove("dim");
  }

  feedEl.hidden = S.view !== "feed";
  savedEl.hidden = S.view !== "saved";
  meEl.hidden = S.view !== "me";

  // 「我的」不参与分类和搜索：那两样是用来筛项目流的，
  // 在这一页留着只会让人以为能筛自己的仓库。
  // 连顶栏一起收掉 —— 只藏搜索框会留一条空白的 sticky 条压在顶上。
  const chrome = S.view === "me";
  $("#cats").hidden = chrome;
  const top = $(".top");
  if (top) top.hidden = chrome;

  if (S.view === "me") {
    renderMe();
    return;
  }

  const host = S.view === "feed" ? feedEl : savedEl;

  const src = sourceList();
  if (!src.length) {
    const why = S.query
      ? `没有匹配「${esc(S.query)}」的项目`
      : S.cat
        ? `这个分类下暂时没有项目`
        : S.view === "feed"
          ? "库里还没有可展示的项目"
          : "还没有收藏<br><span style='font-size:12px'>点卡片右上角的心形试试</span>";
    host.innerHTML = `<div class="empty">${why}</div>`;
    S.host = null;
    S.rendered = 0;
    return;
  }
  resetGrid(host);
  loadMore();
}

/* ── 我的 ───────────────────────────── */

// 登录不弹网页、不要让用户粘令牌：本机的 gh CLI 里就有。
// 这里只负责把「读凭据 → 换资料」这次往返的三种状态画出来。
async function doSignin() {
  if (S.meBusy) return;
  S.meBusy = true;
  S.meErr = "";
  renderMe();
  try {
    const me = await api.accountSignin();
    S.me = me;
    S.meTried = true;
    // 仓库列表失败不该让整次登录算失败：资料已经拿到了，先让人看见自己
    try {
      S.myRepos = await api.accountRepos(12);
    } catch (e) {
      S.myRepos = [];
    }
  } catch (e) {
    S.meErr = e?.message || String(e);
    S.meTried = true;
  } finally {
    S.meBusy = false;
    renderMe();
  }
}

async function doSignout() {
  try {
    await api.accountSignout();
  } catch (e) {
    // 退出只是清内存里的令牌，清不掉也不该把界面卡住
  }
  S.me = null;
  S.myRepos = [];
  S.meErr = "";
  S.meTried = true; // 手动退出过就不再自动登录，等用户自己点
  renderMe();
}

function joinDate(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  const d = new Date(t);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function repoCardHTML(r) {
  const lang = r.language
    ? `<span class="rc-lang"><i style="background:${LC[r.language] || "#9aa0aa"}"></i>${esc(r.language)}</span>`
    : "";
  return `<button class="rcard" data-full="${esc(r.full_name)}" title="${esc(r.full_name)}">
    <div class="rc-top">
      <span class="rc-name">${esc(r.name)}</span>
      ${r.private ? `<span class="rc-tag">私有</span>` : ""}
      ${r.fork ? `<span class="rc-tag">fork</span>` : ""}
      ${r.archived ? `<span class="rc-tag">归档</span>` : ""}
    </div>
    <p class="rc-desc">${esc(r.description || "没有写描述")}</p>
    <div class="rc-foot">
      ${lang}
      <span>★ ${fmt(r.stars)}</span>
      <span>${ago(r.pushed_at) || "—"}</span>
    </div>
  </button>`;
}

function renderMe() {
  const el = $("#meview");

  // 第一次进来就直接登，不做「请先登录」这一道手续 ——
  // 凭据本来就在这台机器上，让用户再点一次只是仪式。
  if (!S.me && !S.meTried && !S.meBusy) {
    doSignin();
    return;
  }

  if (S.meBusy) {
    el.innerHTML = `<div class="me-gate">
      <div class="gate-spin"></div>
      <h2>正在登录</h2>
      <p>用本机的 GitHub 凭据换取账号资料…</p>
    </div>`;
    return;
  }

  if (!S.me) {
    el.innerHTML = `<div class="me-gate">
      <div class="gate-mark">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.4" r="3.7"/><path d="M4.9 20c.5-3.9 3.6-6 7.1-6s6.6 2.1 7.1 6"/></svg>
      </div>
      <h2>登录你的 GitHub 账号</h2>
      <p>Flow 读的是本机的 GitHub CLI 凭据（<code>gh auth token</code>）。令牌只在内存里过一遍，不写文件、不上传。</p>
      <button class="btn primary" data-act="signin">用本机凭据登录</button>
      ${S.meErr ? `<div class="gate-err">${esc(S.meErr)}</div>` : ""}
    </div>`;
    return;
  }

  const m = S.me;
  const joined = joinDate(m.since);
  const meta = [
    m.company && esc(m.company),
    m.location && esc(m.location),
    m.blog && esc(m.blog),
    joined && `${joined}加入`,
  ].filter(Boolean);

  el.innerHTML = `<div class="me-wrap">
  <section class="me-hero">
    <img class="me-ava" src="${esc(m.avatar)}" alt="" referrerpolicy="no-referrer">
    <div class="me-id">
      <h2>${esc(m.name || m.login)}</h2>
      <button class="me-login" data-act="open-profile">@${esc(m.login)}</button>
      ${m.bio ? `<p class="me-bio">${esc(m.bio)}</p>` : ""}
      ${meta.length ? `<div class="me-meta">${meta.map((x) => `<span>${x}</span>`).join("")}</div>` : ""}
    </div>
    <div class="me-act">
      <button class="btn" data-act="open-profile">在 GitHub 打开</button>
      <button class="btn ghost" data-act="signout">退出登录</button>
    </div>
  </section>

  <div class="me-stats">
    <div><b>${m.public_repos}</b><span>公开仓库</span></div>
    <div><b>${fmt(m.followers)}</b><span>关注者</span></div>
    <div><b>${m.following}</b><span>正在关注</span></div>
    <div><b class="mono">${esc(m.via)}</b><span>凭据来源</span></div>
  </div>

  <section class="me-sec">
    <div class="me-sh"><h3>我的仓库</h3><span>按最近推送排序 · ${S.myRepos.length} 个</span></div>
    ${
      S.myRepos.length
        ? `<div class="repo-grid">${S.myRepos.map(repoCardHTML).join("")}</div>`
        : `<div class="me-none">没拉到仓库列表，可能是令牌没有 repo 权限</div>`
    }
  </section>

  <section class="me-sec">
    <div class="me-sh"><h3>本机</h3><span>只读</span></div>
    <div class="me-facts">
      <div><span>项目库</span><b>${(S.total || 0).toLocaleString("zh-CN")} 条</b></div>
      <div><span>收藏</span><b>${S.savedList.length} 个</b></div>
      <div><span>客户端</span><b>Flow 0.1.0</b></div>
      <div class="wide"><span>数据库</span><code>${esc(S.dbPath || "")}</code></div>
    </div>
  </section>
</div>`;
}

/* ── 我的仓库预览 ───────────────────── */

// 自己的仓库不在本地库里，所以不能走 openDetail（那个按 id 查库）。
// 但详情要的东西是同一套：README + 目录，于是复用相同的 DOM 骨架，
// 连 fillExtra 都不用改 —— 它只认 data-full。
function peekHTML(full) {
  const r =
    S.myRepos.find((x) => x.full_name === full) || {
      name: full.split("/")[1] || full,
      full_name: full,
      description: "",
      language: "",
      stars: 0,
      forks: 0,
      pushed_at: "",
      private: false,
    };
  const owner = (r.full_name || full).split("/")[0];
  const letter = esc((r.name || "?").slice(0, 1).toUpperCase());
  return `<div class="mbar">
  <button class="mbtn" data-act="close" title="关闭">✕</button>
  <button class="mbtn" data-act="open" data-full="${esc(r.full_name)}" title="在 GitHub 打开">${ICO.link}</button>
  <span class="spacer"></span>
</div>

<div class="mcenter">
  <div class="mhead">
    <span class="mava">${letter}</span>
    <div class="mwho">
      <b>${esc(owner)}</b>
      <span>${esc(r.language || "未标注语言")} · ${ago(r.pushed_at) || "—"}更新</span>
    </div>
    <button class="follow" data-act="open" data-full="${esc(r.full_name)}">打开仓库</button>
  </div>
  <div class="mtext">
    <h3 class="mtitle">${esc(r.name)}</h3>
    ${r.description ? `<p class="mdesc">${esc(r.description)}</p>` : ""}
  </div>
  <div class="msec" id="mdoc" data-full="${esc(r.full_name)}">
    <div class="msec-h"><span>README</span></div>
    <div class="msec-b"><div class="mload">正在拉取 README…</div></div>
  </div>
  <div class="mpad"></div>
</div>

<div class="mright">
  <div class="mrscroll">
    <div class="mrtop"><span class="mava">${letter}</span><b>${esc(r.full_name)}</b></div>
    <div class="mrline"></div>
    <div class="grid2">
      <div><b>${fmt(r.stars)}</b><span>stars</span></div>
      <div><b>${fmt(r.forks)}</b><span>forks</span></div>
      <div><b>${r.private ? "私有" : "公开"}</b><span>可见性</span></div>
      <div><b>${esc((r.pushed_at || "").slice(0, 4) || "—")}</b><span>最后推送</span></div>
    </div>
    <div class="msec" id="mtree" data-full="${esc(r.full_name)}">
      <div class="msec-h"><span>文件</span></div>
      <div class="msec-b"><div class="mload">正在拉取目录…</div></div>
    </div>
  </div>
  <div class="mrfoot">
    <button class="btn" data-act="open" data-full="${esc(r.full_name)}">在 GitHub 打开</button>
  </div>
</div>`;
}

function openPeek(full) {
  $("#modal").innerHTML = peekHTML(full);
  showModal();
  $(".mrscroll")?.scrollTo(0, 0);
  fillExtra({ full_name: full });
}

/* ── 分类行 ─────────────────────────── */

// 分类维度用语言：数据里现成，也比「推荐 / 热门」这种空心词更能帮人缩小范围。
// 只取数量最多的前九个，剩下的归到「其他」不划算 —— 分类行越长越没人点。
function buildCats() {
  const counts = new Map();
  for (const r of S.feed) if (r.language) counts.set(r.language, (counts.get(r.language) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
  const el = $("#cats");
  el.innerHTML =
    `<button class="cat on" data-cat="">推荐</button>` +
    top.map(([l]) => `<button class="cat" data-cat="${esc(l)}">${esc(l)}</button>`).join("");
}

/* ── 详情浮层 ───────────────────────── */

/* ── README 渲染 ─────────────────────── */

// README 是别人写的 markdown，什么都可能有：表格、代码块、嵌套列表、裸 HTML。
// markdown 部分照样「先整行转义，再按结构还原标签」——顺序反了的话，
// README 里藏一个 <script> 就能在应用里执行。
//
// 但裸 HTML 不能一律转义：相当一部分 README 整篇就是 HTML（居中标题、徽章墙、
// 手写表格），全转义出来就是一墙源码。所以这一类走 sanitizeHtml 的白名单通道，
// 规则见下面那段注释。
const HTML_TAGS = new Set([
  "p", "div", "center", "span", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "small",
  "sub", "sup", "kbd", "code", "pre", "samp", "var", "abbr", "q", "cite", "ruby", "rt",
  "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "details", "summary",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "figure", "figcaption", "picture", "section", "article", "aside",
  "header", "footer", "nav", "main",
]);
const HTML_INLINE = new Set([
  "a", "img", "br", "span", "strong", "b", "em", "i", "u", "s", "del", "ins",
  "mark", "small", "sub", "sup", "kbd", "code", "samp", "var", "abbr", "q", "cite", "ruby", "rt",
]);
const HTML_VOID = new Set(["br", "hr", "img", "col"]);
// 这些连同内容一起删：能执行代码，或者能往页面里引外部资源
const HTML_KILL = "script|style|iframe|object|embed|svg|math|template|noscript|form|textarea|select|video|audio|canvas|portal|marquee|applet";
const HTML_ATTR = new Set([
  "alt", "width", "height", "title", "align", "colspan", "rowspan",
  "start", "open", "lang", "dir", "type", "value", "name",
]);

// 只在 HTML 块的开头才把一行当「裸 HTML 块」。行内的 <br>、<kbd> 交给 inlineMd。
const HTML_BLOCK = new RegExp(
  "^\\s*</?(" +
    "p|div|center|h[1-6]|table|thead|tbody|tfoot|tr|td|th|caption|colgroup|" +
    "ul|ol|li|dl|dt|dd|blockquote|pre|details|summary|figure|figcaption|" +
    "picture|section|article|aside|header|footer|nav|main|hr|" +
    HTML_KILL +
  ")\\b",
  "i"
);

// README 里的裸 HTML 一律过这道门。原则是「不认识就丢」，不是「认识才拦」：
//   · 标签白名单，属性白名单，on* 直接丢
//   · href/src 走 safeUrl，javascript: / data: 进不来
//   · class / id 不放行 —— README 里写个 class="card" 会串到我们自己的卡片样式，
//     还会被「点卡片开详情」的事件委托捡走（closest('.card')）
//   · 危险元素连同内容删掉，不留文本残渣
function sanitizeHtml(html, base, abs) {
  let s = String(html || "");
  s = s.replace(/<!--[\s\S]*?-->/g, ""); // 注释先删，里面的标签不能当真的
  const kill = new RegExp(`<(${HTML_KILL})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi");
  // 内容可能嵌套同名标签，删到不动为止
  for (let i = 0; i < 4 && kill.test(s); i++) s = s.replace(kill, "");
  s = s.replace(new RegExp(`<\\/?(${HTML_KILL})\\b[^>]*>`, "gi"), "");
  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, name, attrs) =>
    sanitizeTag(name, attrs, m[1] === "/", base, abs)
  );
}

function sanitizeTag(nameRaw, attrsRaw, closing, base, abs) {
  const name = String(nameRaw || "").toLowerCase();
  if (!HTML_TAGS.has(name)) return "";
  if (closing) return HTML_VOID.has(name) ? "" : `</${name}>`;

  const attrs = [];
  let style = "";
  let src = "";
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = re.exec(String(attrsRaw || "")))) {
    const k = m[1].toLowerCase();
    const v = m[2] ?? m[3] ?? m[4] ?? "";
    if (k.startsWith("on")) continue; // onclick / onerror / onload …
    if (k === "href" || k === "src") {
      const u = k === "src" ? safeUrl(v, base) : safeUrl(v, abs, true);
      if (!u) continue;
      if (k === "src") src = u;
      attrs.push(`${k}="${esc(u)}"`);
      continue;
    }
    if (!HTML_ATTR.has(k)) continue; // style / class / id 都不放行
    if (k === "align") {
      // align 是废弃属性，但 README 里满地都是。转成 inline style 更可控。
      const a = v.toLowerCase();
      if (a !== "left" && a !== "right" && a !== "center" && a !== "justify") continue;
      style =
        name === "img"
          ? a === "center"
            ? "display:block;margin-left:auto;margin-right:auto"
            : `float:${a}`
          : `text-align:${a}`;
      continue;
    }
    attrs.push(`${k}="${esc(v)}"`);
  }
  if (name === "img" && !src) return ""; // 没 src 的图只会显示一个破图标
  if (style) attrs.push(`style="${style}"`);
  // lazy 会在 WebView2 里被换成占位符再不加载，这里别有它
  if (name === "img") attrs.push('decoding="async"', 'referrerpolicy="no-referrer"');
  return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}

// 表格切列。不能直接 split("|")：单元格里的 `a|b` 和转义的 \| 都会被切坏。
function splitRow(line) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  let tick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") tick = !tick;
    if (c === "|" && !tick) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

// 引用式链接的定义行：[key]: https://…（可能带 "title" 或用尖括号包住 URL）
const REF_DEF = /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?\s*$/;

// 介绍区那段是从 README 里截的片段。片段里的 [Rust] 这种短引用，
// 定义在整篇 README 末尾，这里查不到；渲染后把剩下的方括号语法抹掉，
// 免得界面上露出 markdown 语法本身。
function teaser(s, base, abs) {
  return inlineMd(s, base, abs).replace(/!?\[([^\]\n]{1,80})\](\[[^\]\n]*\])?/g, "$1");
}

// README 里的图都是外链，谁也不能保证还在。挂掉就收起来，
// 别在正文里留一个破图标占位。
function dropBrokenImgs(root) {
  for (const img of root.querySelectorAll("img")) {
    if (img.complete && img.naturalWidth === 0) img.classList.add("gone");
    else img.addEventListener("error", () => img.classList.add("gone"), { once: true });
  }
}

function md(src, opt = {}) {
  const base = opt.base || "";
  const abs = opt.abs || "";
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let fence = null;
  let table = null;

  // 引用式链接（[文字][key] + 文末 [key]: https://…）先扫一遍拿定义。
  // 扫的时候跳过代码块——代码里的 [foo]: bar 不是定义。
  const refs = new Map();
  {
    let inFence = false;
    for (const l of lines) {
      if (/^\s*```/.test(l)) inFence = !inFence;
      if (inFence) continue;
      const m = l.match(REF_DEF);
      if (m) refs.set(m[1].toLowerCase(), m[2]);
    }
  }

  const inline = (s) => inlineMd(s, base, abs, refs);
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };

  // 列表按缩进分层。bun 的 README 有 300 多行缩进条目，
  // 拍平之后全成一级，读起来就是另一份文档了。
  const stack = [];
  const box = (v) => (v === null ? "" : `<span class="mtask${v === "x" ? " on" : ""}"></span>`);
  const renderList = (lv) =>
    `<${lv.tag}>` +
    lv.items
      .map((it) => `<li>${box(it.box)}${inline(it.text)}${it.sub ? renderList(it.sub) : ""}</li>`)
      .join("") +
    `</${lv.tag}>`;
  const flushList = () => {
    if (stack.length) {
      out.push(renderList(stack[0]));
      stack.length = 0;
    }
  };
  const flushTable = () => {
    if (table) {
      // 列数按最长的一行补齐，缺格补空，否则表格会歪
      const cols = Math.max(table.head.length, ...table.rows.map((r) => r.length));
      const pad = (r) => Array.from({ length: cols }, (_, i) => r[i] || "");
      const cell = (t, tag, i) => {
        const a = table.align[i];
        return `<${tag}${a && a !== "left" ? ` style="text-align:${a}"` : ""}>${inline(t)}</${tag}>`;
      };
      const head = table.head.length
        ? `<tr>${pad(table.head).map((c, i) => cell(c, "th", i)).join("")}</tr>`
        : "";
      const body = table.rows
        .map((r) => `<tr>${pad(r).map((c, i) => cell(c, "td", i)).join("")}</tr>`)
        .join("");
      out.push(`<div class="mdtable"><table>${head}${body}</table></div>`);
      table = null;
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushTable();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    if (fence) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code>${esc(fence.buf.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        fence.buf.push(raw);
      }
      continue;
    }
    const fm = line.match(/^\s*```\s*(\S*)/);
    if (fm) {
      flushAll();
      fence = { lang: fm[1] || "", buf: [] };
      continue;
    }
    if (!line.trim()) {
      // 列表项之间的空行不结束列表（CommonMark 的 loose list）。
      // 往后看第一个非空行，还是列表项就接着算同一个列表。
      if (stack.length) {
        let k = i + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[k])) {
          i = k - 1;
          continue;
        }
      }
      flushAll();
      continue;
    }

    // 引用式链接的定义行本身不显示，内容已经收进 refs
    if (refs.size && REF_DEF.test(line)) continue;

    // 一行以块级标签开头，就当成裸 HTML 块整段放行（走白名单清洗）。
    // 这类 README 一多，不给这条通道就只能显示成一墙源码。
    const hb = line.match(HTML_BLOCK);
    if (hb) {
      flushAll();
      const tag = hb[1].toLowerCase();
      const buf = [raw];
      let j = i + 1;
      if (tag === "pre" || tag === "table") {
        // 代码块和表格里的空行是内容的一部分，只有闭合标签才算结束
        const close = new RegExp(`</${tag}\\s*>`, "i");
        let done = close.test(line);
        while (!done && j < lines.length) {
          buf.push(lines[j]);
          if (close.test(lines[j])) done = true;
          j++;
        }
      } else {
        // 其余按 CommonMark 的规矩：到空行为止
        while (j < lines.length && lines[j].trim()) {
          buf.push(lines[j]);
          j++;
        }
      }
      out.push(sanitizeHtml(buf.join("\n"), base, abs));
      i = j - 1; // 循环自己会 +1
      continue;
    }

    // 分隔线：--- / *** / ___，但别把表格的分隔行吃掉
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const lv = Math.min(h[1].length, 4);
      out.push(`<h${lv}>${inline(h[2].replace(/\s*#+\s*$/, ""))}</h${lv}>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushAll();
      const t = line.replace(/^\s*>\s?/, "");
      out.push(`<blockquote>${inline(t)}</blockquote>`);
      continue;
    }

    // 表格：表头行 + 一行 ---|---
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = splitRow(line);
      const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
      if (isSep && table) {
        // 分隔行本身不是表头：它前面那一行才是。开头就遇到分隔行说明没有表头。
        if (!table.head.length && table.rows.length === 1) table.head = table.rows.pop();
        table.align = cells.map((c) => {
          const l = c.startsWith(":"), r = c.endsWith(":");
          return l && r ? "center" : r ? "right" : "left";
        });
        continue;
      }
      if (!table) {
        flushPara();
        flushList();
        table = { head: [], rows: [], align: [] };
      }
      table.rows.push(cells);
      continue;
    }
    flushTable();

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      flushTable();
      const indent = li[1].replace(/\t/g, "    ").length;
      const tag = /^\d/.test(li[2]) ? "ol" : "ul";
      let lv = stack[stack.length - 1];
      if (!lv) {
        lv = { indent, tag, items: [] };
        stack.push(lv);
      } else if (indent >= lv.indent + 2) {
        // 缩进够深：挂到上一项下面，成为子列表
        const kids = { indent, tag, items: [] };
        const parent = lv.items[lv.items.length - 1];
        if (parent) parent.sub = kids;
        else lv.items.push({ text: "", box: null, sub: kids });
        stack.push(kids);
        lv = kids;
      } else {
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
        lv = stack[stack.length - 1];
        if (indent < lv.indent) lv.indent = indent;
        if (lv.tag !== tag) {
          // 同一层换了记号类型（有序↔无序），另起一个列表，别硬塞进去
          if (stack.length === 1) {
            flushList();
            lv = { indent, tag, items: [] };
            stack.push(lv);
          } else {
            lv.tag = tag;
          }
        }
      }
      const task = li[3].match(/^\[([ xX])\]\s+(.*)$/);
      lv.items.push({
        text: task ? task[2] : li[3],
        box: task ? (task[1] === " " ? "" : "x") : null,
        sub: null,
      });
      continue;
    }
    flushList();

    if (/^\s*<!--/.test(line)) continue; // HTML 注释
    para.push(line.trim());
  }

  if (fence) out.push(`<pre><code>${esc(fence.buf.join("\n"))}</code></pre>`);
  flushAll();
  return out.join("\n");
}

// 转义过的属性值还原成原文，好交给 sanitizeTag 重新解析
const unescAttr = (s) =>
  String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function inlineMd(s, base, abs, refs) {
  let t = esc(s);

  // 行内代码先抠出来占位，别让后面的规则动它
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  // 收尾的 \s* 是必要的：public-apis 里大量 [名字](https://x/ ) 这种
  // URL 和右括号之间空一格的写法，不留空白就整条链接都认不出来。
  t = t.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[\s\S]*?"|'[\s\S]*?'|&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;))?\s*\)/g, (m, alt, url) => {
    const u = safeUrl(url, base);
    return u ? `<img src="${u}" alt="${alt}" decoding="async" referrerpolicy="no-referrer">` : esc(m);
  });
  t = t.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+(?:"[\s\S]*?"|'[\s\S]*?'|&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;))?\s*\)/g, (m, txt, url) => {
    const u = safeUrl(url, abs, true);
    return u ? `<a href="${u}" target="_blank" rel="noreferrer noopener">${txt}</a>` : txt;
  });

  if (refs && refs.size) {
    // 引用式图片：![alt][key]（key 省略时用 alt 当 key）
    t = t.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, alt, key) => {
      const u = safeUrl(refs.get((key || alt).toLowerCase()) || "", base);
      return u ? `<img src="${u}" alt="${alt}" decoding="async" referrerpolicy="no-referrer">` : m;
    });
    // 引用式链接：[文字][key] / [文字][]。deno 的徽章就是 [![图][a]][b] 这种套法。
    t = t.replace(/\[([^\]]*)\]\[([^\]]*)\]/g, (m, txt, key) => {
      const u = refs.get((key || txt).toLowerCase());
      if (!u) return m;
      const href = safeUrl(u, abs, true);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer noopener">${txt}</a>` : txt;
    });
    // 短引用：[Rust] 直接对应 [Rust]: https://…。只认已经定义过的 key，
    // 没定义的方括号原样留着，别把普通文字吃掉。
    t = t.replace(/(^|[^!])\[([^\]]+)\]/g, (m, pre, txt) => {
      const u = refs.get(txt.trim().toLowerCase());
      if (!u) return m;
      const href = safeUrl(u, abs, true);
      return href ? `${pre}<a href="${href}" target="_blank" rel="noreferrer noopener">${txt}</a>` : m;
    });
  }

  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // 段落里的行内 HTML：<br>、<kbd>、<sub>、<a href> 这些 GitHub 是放行的，
  // 全转义就会在正文里露出尖括号。必须在行内代码还原之前做——
  // 代码里的 &lt;br&gt; 不能被当成标签。
  t = t.replace(/&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[\s\S]*?)?)&gt;/g, (m, close, name, attrs) => {
    const tag = name.toLowerCase();
    if (!HTML_INLINE.has(tag)) return m;
    const one = sanitizeTag(tag, unescAttr(attrs), !!close, base, abs);
    return one || (tag === "img" ? "" : m);
  });

  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

// 只放行 http/https 和仓库内相对路径。README 里的链接不可信，
// javascript: / data: 一律丢回去当纯文本。
function safeUrl(url, prefix, isLink = false) {
  let u = String(url || "").trim();
  if (!u) return "";
  if (/^(https?:)?\/\//i.test(u)) return /^https?:\/\//i.test(u) ? u : "";
  if (/^(javascript|data|vbscript|file):/i.test(u)) return "";
  if (u.startsWith("#")) return isLink ? u : "";
  const rel = u.replace(/^\.?\//, "");
  return prefix ? prefix + rel : "";
}

/* ── 文件树 ───────────────────────────── */

// GitHub 的 git/trees?recursive=1 给的是扁平 path 列表。
// 平铺 + 按 "/" 数量缩进，比真做成可折叠树省事，也更好扫。
// 仓库根目录动辄几百个文件，全列出来没人看，默认收一半。
function treeHTML(entries, total) {
  const list = (entries || []).filter((e) => e && e.path);
  if (!list.length) return "";
  const LIMIT = 90;
  const shown = list.slice(0, LIMIT);
  const html = shown
    .map((e) => {
      const depth = (e.path.match(/\//g) || []).length;
      const name = e.path.split("/").pop();
      const dir = e.type === "tree";
      return (
        `<div class="tf ${dir ? "is-dir" : ""}" style="--d:${Math.min(depth, 6)}" title="${esc(e.path)}">` +
        `<i>${dir ? "▾" : "·"}</i><span>${esc(name)}</span>` +
        `</div>`
      );
    })
    .join("");
  // 仓库真实条目数由后端给（目录列表本身有上限，用 list.length 会说小）
  const all = total || list.length;
  const more =
    all > LIMIT
      ? `<div class="tf more">共 ${all} 个文件，只显示前 ${LIMIT} 个</div>`
      : "";
  return `<div class="mtree">${html}${more}</div>`;
}

const ICO = {
  heart: `<svg viewBox="0 0 24 24"><path d="M12 20.3 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6A4.8 4.8 0 0 1 19.4 13z"/></svg>`,
  link: `<svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="M20 4 10.5 13.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
};

function detailHTML(r) {
  const letter = esc((r.owner || "?")[0].toUpperCase());
  const hasImg = !!r.cover_url;
  const kind = r.cover_kind || "shot";
  const dup = overlap(r.description, r.readme_head);
  const topics = (r.topics || [])
    .slice(0, 8)
    .map((t) => `<span>#${esc(t)}</span>`)
    .join("");

  // 中栏的视觉主体：有图放大图，没图就把 README 首段做成一块引文。
  // 原图和简介说的是同一件事时不再重复摆一遍。
  // 首段是从 README 里截出来的，本身就是 markdown。直接 esc 会把
  // [Rust](https://…) 这种语法原样露在界面上，所以按行内 markdown 渲染。
  const qBase = `https://raw.githubusercontent.com/${r.full_name}/HEAD/`;
  const qAbs = `https://github.com/${r.full_name}/blob/HEAD/`;
  const fig = hasImg
    ? `<div class="mfig ${kind === "logo" ? "is-logo" : ""}">
         <img src="${esc(r.cover_url)}" alt="" decoding="async" referrerpolicy="no-referrer">
       </div>`
    : r.readme_head && !dup
      ? `<div class="mquote"><p>${teaser(r.readme_head, qBase, qAbs)}</p></div>`
      : "";

  return `<div class="mleft">
  <button class="mbtn mclose" data-act="close" title="关闭">✕</button>
  <button class="mbtn ${r.saved ? "on" : ""}" data-act="save" data-id="${r.id}" title="收藏">${ICO.heart}</button>
  <button class="mbtn" data-act="open" data-full="${esc(r.full_name)}" title="在 GitHub 打开">${ICO.link}</button>
  <span class="spacer"></span>
</div>

<div class="mcenter">
  <div class="mhead">
    <span class="mava">${letter}</span>
    <div class="mwho">
      <b>${esc(r.owner)}</b>
      <span>${esc(r.language || "未标注语言")} · ${ago(r.pushed_at)}更新</span>
    </div>
    <button class="follow" data-act="open" data-full="${esc(r.full_name)}">打开仓库</button>
  </div>
  <div class="mtext">
    <h3 class="mtitle">${esc(r.name)}</h3>
    ${r.description ? `<p class="mdesc">${esc(r.description)}</p>` : ""}
    ${topics ? `<div class="mtags">${topics}</div>` : ""}
  </div>
  ${fig}
  <div class="msec" id="mdoc" data-full="${esc(r.full_name)}">
    <div class="msec-h"><span>README</span></div>
    <div class="msec-b"><div class="mload">正在拉取 README…</div></div>
  </div>
  <div class="mpad"></div>
</div>

<div class="mright">
  <div class="mrscroll">
    <div class="mrtop">
      <span class="mava">${letter}</span>
      <b>${esc(r.full_name)}</b>
    </div>
    <div class="mrline"></div>
    <div class="grid2">
      <div><b>${fmt(r.stars)}</b><span>stars</span></div>
      <div><b>${fmt(r.forks)}</b><span>forks</span></div>
      <div><b>${fmt(r.open_issues)}</b><span>issues</span></div>
      <div><b>${esc((r.created_at || "").slice(0, 4) || "—")}</b><span>创建于</span></div>
    </div>
    <dl class="facts">
      <dt>最后更新</dt><dd>${ago(r.pushed_at) || "—"}</dd>
      <dt>许可</dt><dd>${esc(r.license || "未标注")}</dd>
      ${r.homepage ? `<dt>主页</dt><dd>${esc(r.homepage)}</dd>` : ""}
      <dt>归档</dt><dd>${r.archived ? "已归档" : "活跃"}</dd>
    </dl>
    <div class="msec" id="mtree" data-full="${esc(r.full_name)}">
      <div class="msec-h"><span>文件</span></div>
      <div class="msec-b"><div class="mload">正在拉取目录…</div></div>
    </div>
  </div>
  <div class="mrfoot">
    <button class="btn" data-act="open" data-full="${esc(r.full_name)}">在 GitHub 打开</button>
    <button class="btn ghost" data-act="save" data-id="${r.id}">${r.saved ? "已收藏" : "收藏"}</button>
  </div>
</div>`;
}

function showModal() {
  $("#modal").hidden = false;
  $("#mask").hidden = false;
  $("#mask").classList.add("show");
  document.body.classList.add("dim");
}

function closeModal() {
  $("#modal").hidden = true;
  $("#mask").hidden = true;
  $("#mask").classList.remove("show");
  document.body.classList.remove("dim");
}

// README 全文和目录结构是按需现拉的，同一个仓库不重复请求。
// 上限 60 条：缓存只是为了避免来回点开同一个项目，不是长期存储。
const EXTRA = new Map();

async function openDetail(id) {
  try {
    const r = await api.detail(id);
    if (!r) return;
    $("#modal").innerHTML = detailHTML(r);
    showModal();
    $(".mrscroll")?.scrollTo(0, 0);
    fillExtra(r);
    trDetail(r);
  } catch (e) {
    console.error("打开详情失败", e);
  }
}

function paintReadme(body, text, base, abs) {
  const n = md(text, { base, abs });
  body.innerHTML =
    `<div class="md fold">${n}</div>` +
    `<div class="mfold"><button class="mexpand" data-act="expand">展开全部 README</button></div>`;
  dropBrokenImgs(body);
}

async function fillExtra(r) {
  const full = r.full_name;
  let extra = EXTRA.get(full);
  if (!extra) {
    try {
      extra = await api.repoExtra(full);
    } catch (e) {
      const why = e?.message || String(e);
      for (const [id, what] of [
        ["mdoc", "README"],
        ["mtree", "目录"],
      ]) {
        const el = document.getElementById(id);
        // 用户可能已经点开另一个项目了，别把内容写到别人的浮层里
        if (!el || el.dataset.full !== full) continue;
        el.querySelector(".msec-b").innerHTML =
          `<div class="mfail">拉不到${what}：${esc(why)}</div>`;
      }
      return;
    }
    if (extra) {
      if (EXTRA.size > 60) EXTRA.clear();
      EXTRA.set(full, extra);
    }
  }
  if (!extra) return;

  // README 里的相对路径要能点：图片回 raw，链接回 GitHub 页面
  const base = `https://raw.githubusercontent.com/${full}/${extra.branch}/`;
  const abs = `https://github.com/${full}/blob/${extra.branch}/`;

  const doc = document.getElementById("mdoc");
  if (doc && doc.dataset.full === full) {
    const body = doc.querySelector(".msec-b");
    const text = extra.readme || "";
    if (!text.trim()) {
      body.innerHTML = `<div class="mfail">这个仓库没有 README</div>`;
    } else {
      // 有的 README 长到离谱（public-apis 渲染出来 14 万像素，190 屏）。
      // 默认折一屏多，想看完再展开。
      paintReadme(body, text, base, abs);
      // 先出英文再补中文：本地词典翻一篇 6 万字符也就几十毫秒，
      // 用户基本看不到中间态；万一翻挂了，英文已经在那儿了。
      if (TR.on && TR.ready) {
        api
          .trMd(text)
          .then((zh) => {
            if (!zh || zh === text) return;
            if (doc.dataset.full !== full) return;
            paintReadme(body, zh, base, abs);
          })
          .catch(() => {});
      }
    }
  }

  const tree = document.getElementById("mtree");
  if (tree && tree.dataset.full === full) {
    const body = tree.querySelector(".msec-b");
    body.innerHTML =
      treeHTML(extra.tree, extra.total) || `<div class="mfail">目录是空的</div>`;
  }
}

/* ── 收藏 ───────────────────────────── */

async function flipSave(id) {
  const on = !S.savedIds.has(id);
  try {
    await api.toggleSave(id, on);
  } catch (e) {
    console.error("收藏失败", e);
    return;
  }
  if (on) S.savedIds.add(id);
  else S.savedIds.delete(id);

  document
    .querySelectorAll(`.card[data-id="${id}"] .save, #modal [data-act="save"][data-id="${id}"]`)
    .forEach((b) => b.classList.toggle("on", on));

  const ghost = $('#modal .mrfoot [data-act="save"]');
  if (ghost) ghost.textContent = on ? "已收藏" : "收藏";

  S.savedList = await api.saved();
  S.savedIds = new Set(S.savedList.map((r) => r.id));
  $("#savedn").textContent = S.savedList.length || "";
  if (S.view === "saved") renderView();
}

/* ── 事件 ───────────────────────────── */

// 图片加载成功才淡入；失败就把 <img> 藏掉，露出底下那层 README 摘录。
// 全程不依赖内联 onerror —— CSP 不允许内联脚本。
// 成功时要连 .cover 一起标记：文字层靠这个 class 才敢让位（见 style.css）。
document.addEventListener("load", (e) => {
  if (e.target.tagName !== "IMG") return;
  e.target.classList.add("ok");
  e.target.closest(".cover")?.classList.add("ok");
}, true);
document.addEventListener("error", (e) => {
  if (e.target.tagName !== "IMG") return;
  e.target.classList.add("broken");
  // 卡片和浮层的头部都要整体切回文字形态，光把 img 藏起来会留一块空白
  e.target.closest(".cover")?.classList.add("broken");
  e.target.closest(".dhero")?.classList.add("broken");
}, true);

document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    e.preventDefault();
    e.stopPropagation();
    const a = act.dataset.act;
    if (a === "save") return void flipSave(Number(act.dataset.id || act.closest(".card")?.dataset.id));
    if (a === "close") return closeModal();
    if (a === "expand") {
      // README 折叠：展开后按钮变成「收起」，再点折回去
      const box = act.closest(".msec-b")?.querySelector(".md");
      if (box) {
        const folded = box.classList.toggle("fold");
        act.textContent = folded ? "展开全部 README" : "收起 README";
      }
      return;
    }
    if (a === "open") return void api.openUrl(`https://github.com/${act.dataset.full}`);
    if (a === "signin") return void doSignin();
    if (a === "signout") return void doSignout();
    if (a === "open-profile") {
      const url = S.me?.html || `https://github.com/${S.me?.login || ""}`;
      if (S.me?.login) return void api.openUrl(url);
      return;
    }
  }
  if (e.target.id === "trbtn") return trToggle();
  if (e.target.id === "mask") return closeModal();
  const rc = e.target.closest(".rcard");
  if (rc) return openPeek(rc.dataset.full);
  const card = e.target.closest(".card");
  if (card) openDetail(Number(card.dataset.id));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden) closeModal();
});

document.querySelectorAll(".navitem").forEach((t) =>
  t.addEventListener("click", () => {
    S.view = t.dataset.view;
    document.querySelectorAll(".navitem").forEach((x) => x.classList.toggle("on", x === t));
    window.scrollTo(0, 0);
    renderView();
  })
);

// 分类和搜索都只重置列表，不重新拉数据
$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest(".cat");
  if (!b) return;
  S.cat = b.dataset.cat;
  document.querySelectorAll(".cat").forEach((x) => x.classList.toggle("on", x === b));
  window.scrollTo(0, 0);
  renderView();
});

let qt = 0;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qt);
  const v = e.target.value.trim();
  qt = setTimeout(() => {
    S.query = v;
    window.scrollTo(0, 0);
    renderView();
  }, 160);
});

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 900) loadMore();
}, { passive: true });

let rt = 0;
window.addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const keep = S.rendered;
    renderView();
    // 窗口变宽后列变多，原来的渲染量不够填满，补一点
    while (S.rendered < keep) loadMore();
  }, 200);
});

/* ── 启动 ───────────────────────────── */

function fatal(title, detail) {
  $("#hint").hidden = true;
  const f = $("#fatal");
  f.hidden = false;
  f.innerHTML = `<h3>${esc(title)}</h3><p>${esc(detail)}</p>`;
}

async function boot() {
  if (!api.available()) {
    return fatal("这个页面必须从 Flow 应用里打开", "浏览器直接访问时拿不到本地项目库，所以这里不会显示任何内容。请双击 flow.exe。");
  }
  try {
    const info = await api.info();
    S.total = info.total;
    S.dbPath = info.db || "";
    $("#pool").textContent = `${info.total.toLocaleString("zh-CN")} 个项目\n本地库`;
    // 全量取回来：搜索和分类都在内存里做，只取一部分的话
    // 用户搜一个明明库里有、却搜不到的项目，会以为坏了。
    S.feed = await api.feed(info.total || 3500);
    S.savedList = await api.saved();
    S.savedIds = new Set(S.savedList.map((r) => r.id));
    $("#savedn").textContent = S.savedList.length || "";
    $("#hint").hidden = true;
    buildCats();
    renderView();
    // 翻译是可选层：连不上就整页照旧，不挡任何东西。
    try {
      const st = await api.trStatus();
      TR.ready = !!st.ready;
      TR.engine = st.engine || "";
      const b = $("#trbtn");
      if (b) {
        b.hidden = !st.ready;
        b.classList.toggle("on", TR.on);
        b.title =
          st.engine === "local"
            ? "显示中文译文（本地词典，不联网）"
            : `显示中文译文（${st.model || st.engine}）`;
      }
      if (st.ready) {
        trSetup();
        // 首屏那批卡是在 trSetup 之前插进去的，补挂一次
        for (const c of document.querySelectorAll(".card")) {
          if (c.__repo) TR.obs?.observe(c);
        }
      }
    } catch {
      const b = $("#trbtn");
      if (b) b.hidden = true;
    }
  } catch (e) {
    fatal("读不到本地库", e?.message || String(e));
  }
}

boot();
