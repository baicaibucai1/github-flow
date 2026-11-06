import * as api from "./api.js";

const $ = (s) => document.querySelector(s);

// 封面兜底用的色相：按 id 取，避免相邻两张卡撞成同一个颜色
const PAL = [8, 26, 44, 92, 142, 168, 192, 214, 248, 282, 316, 340];

// GitHub 的语言色，只为让列表扫起来有辨识度
const LC = {
  Rust: "#dea584", Python: "#3572A5", TypeScript: "#3178c6", JavaScript: "#f1e05a",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", C: "#666", Zig: "#ec915c",
  Kotlin: "#A97BFF", Swift: "#F05138", Ruby: "#701516", PHP: "#4F5D95",
  "C#": "#178600", Dart: "#00B4AB", Lua: "#000080",
};

const S = {
  feed: [],
  savedList: [],
  savedIds: new Set(),
  view: "feed",
  cols: 0,
  heights: [],
  buckets: [],
  rendered: 0,
  host: null,
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
  const h = hue(r.id);
  const letter = esc((r.name || "?")[0].toUpperCase());
  const hasImg = !!r.cover_url;
  const kind = r.cover_kind || "shot";
  const cls = hasImg ? `is-img is-${kind}` : r.readme_head || r.readme_title ? "is-doc" : "is-plain";
  // README 的标题多数就是项目名，下面已经有名字了，再写一遍是噪音。
  const t = distinctTitle(r);
  const showTitle = !!t;
  const img = hasImg
    ? `<img class="shot" src="${esc(r.cover_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : "";
  const snip = `
    <div class="snip">
      ${showTitle ? `<div class="rt">${esc(t)}</div>` : ""}
      ${r.readme_head ? `<p class="rp">${esc(r.readme_head)}</p>` : ""}
      ${!showTitle && !r.readme_head ? `<span class="fb">${letter}</span>` : ""}
    </div>`;
  return `<div class="cover ${cls}" style="--h:${h}">
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

function cardHTML(r) {
  const lang = r.language
    ? `<span class="lang" style="color:${LC[r.language] || "#9a9aa1"}"><i class="d"></i>${esc(r.language)}</span>`
    : "";
  // 头部没图时展示的就是 README 首段，底部再抄一遍简介就是重复。
  // 有图的卡片头被图盖住了，简介还得留着。
  const dup = !r.cover_url && overlap(r.description, r.readme_head);
  const desc = dup ? "" : r.description || r.readme_head || "这个项目没有写描述";
  return `<article class="card" data-id="${r.id}">
  ${coverHTML(r)}
  <div class="body">
    <h3 title="${esc(r.full_name)}"><span class="own">${esc(r.owner)}<b>/</b></span>${esc(r.name)}</h3>
    ${desc ? `<p>${esc(desc)}</p>` : ""}
    <div class="meta">${lang}<span>${ago(r.pushed_at)}</span></div>
  </div>
</article>`;
}

/* ── 瀑布流 ─────────────────────────── */

function colsFor(w) {
  if (w < 560) return 2;
  if (w < 900) return 3;
  if (w < 1240) return 4;
  return 5;
}

function resetGrid(host) {
  host.innerHTML = "";
  S.host = host;
  S.cols = colsFor(document.body.clientWidth);
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
  // 头部高度：有图是固定 16:10；只有文字时按行数估；两者都没有才是旧的色块比例。
  const cover = r.cover_url
    ? colW * 0.625
    : r.readme_head
      ? 96 + Math.min(3, Math.ceil(r.readme_head.length / Math.max(12, Math.floor(colW / 7)))) * 19
      : colW * 0.62;
  return cover + 30 + lines * 19 + 26;
}

// 按估算高度投到最矮的一列。
// 不用 CSS columns 是因为它按列优先填充，阅读顺序会变成竖着走。
function append(list) {
  const gap = 14;
  const colW = (S.host.clientWidth - (S.cols - 1) * gap) / S.cols;
  for (const r of list) {
    let idx = 0;
    for (let i = 1; i < S.heights.length; i++) if (S.heights[i] < S.heights[idx]) idx = i;
    S.buckets[idx].insertAdjacentHTML("beforeend", cardHTML(r));
    S.heights[idx] += estimate(r, colW) + gap;
  }
}

function loadMore() {
  const src = S.view === "feed" ? S.feed : S.savedList;
  if (S.rendered >= src.length) return;
  const chunk = src.slice(S.rendered, S.rendered + 40);
  append(chunk);
  S.rendered += chunk.length;
}

function renderView() {
  const feedEl = $("#feed");
  const savedEl = $("#savedview");
  feedEl.hidden = S.view !== "feed";
  savedEl.hidden = S.view !== "saved";
  const host = S.view === "feed" ? feedEl : savedEl;

  const src = S.view === "feed" ? S.feed : S.savedList;
  if (!src.length) {
    host.innerHTML = `<div class="empty">${
      S.view === "feed" ? "库里还没有可展示的项目" : "还没有收藏<br><span style='font-size:12px'>点卡片右上角的心形试试</span>"
    }</div>`;
    S.host = null;
    S.rendered = 0;
    return;
  }
  resetGrid(host);
  loadMore();
}

/* ── 详情抽屉 ───────────────────────── */

function detailHTML(r) {
  const h = hue(r.id);
  const topics = (r.topics || [])
    .slice(0, 10)
    .map((t) => `<span class="chip">${esc(t)}</span>`)
    .join("");
  const letter = esc((r.name || "?")[0].toUpperCase());
  // 抽屉里正文区已经有「README」区块了，头部再放一遍摘录就是同一段话说两遍。
  // 所以没图的时候头部退回色带 + 首字母，只负责给关闭按钮一个落脚处。
  const hasImg = !!r.cover_url;
  const hero = hasImg
    ? `<img class="shot" src="${esc(r.cover_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="fb">${letter}</span>`;

  // 描述和 README 首段经常是同一句话，重复摆两遍显得很傻
  const dup = overlap(r.description, r.readme_head);
  const t = distinctTitle(r);
  const excerpt = r.readme_head && !dup
    ? `<div class="excerpt"><span class="rlabel">README</span><p>${esc(r.readme_head)}</p></div>`
    : t
      ? `<div class="excerpt"><span class="rlabel">README</span><h4>${esc(t)}</h4></div>`
      : "";

  return `<div class="dhero ${hasImg ? "is-img is-" + (r.cover_kind || "shot") : "is-plain"}" style="--h:${h}">
  ${hero}
  <button class="dclose" data-act="close" title="关闭">✕</button>
</div>
<div class="dbody">
  <div class="dhead">
    <div style="min-width:0;flex:1">
      <h2>${esc(r.name)}</h2>
      <div class="sub">${esc(r.owner)}${r.language ? " · " + esc(r.language) : ""}</div>
    </div>
    <button class="save ${r.saved ? "on" : ""}" data-act="save" data-id="${r.id}" title="收藏">♥</button>
  </div>
  <p class="desc">${esc(r.description || "这个项目没有写描述。")}</p>
  ${excerpt}
  <div class="stats">
    <div><b>${fmt(r.stars)}</b><span>stars</span></div>
    <div><b>${fmt(r.forks)}</b><span>forks</span></div>
    <div><b>${fmt(r.open_issues)}</b><span>issues</span></div>
    <div><b>${ago(r.pushed_at)}</b><span>最后更新</span></div>
  </div>
  ${topics ? `<div class="chips">${topics}</div>` : ""}
  <dl class="facts">
    <dt>创建</dt><dd>${esc((r.created_at || "").slice(0, 10) || "—")}</dd>
    <dt>许可</dt><dd>${esc(r.license || "未标注")}</dd>
    <dt>仓库</dt><dd>${esc(r.full_name)}</dd>
  </dl>
</div>
<div class="dfoot">
  <button class="btn" data-act="open" data-full="${esc(r.full_name)}">在 GitHub 打开</button>
  <button class="btn ghost" data-act="save" data-id="${r.id}">${r.saved ? "取消收藏" : "收藏"}</button>
</div>`;
}

function showDrawer() {
  const d = $("#drawer");
  const m = $("#mask");
  d.hidden = false;
  m.classList.add("show");
  document.body.classList.add("dim");
  requestAnimationFrame(() => d.classList.add("on"));
}

function closeDrawer() {
  const d = $("#drawer");
  const m = $("#mask");
  d.classList.remove("on");
  m.classList.remove("show");
  document.body.classList.remove("dim");
  setTimeout(() => {
    d.hidden = true;
  }, 280);
}

async function openDetail(id) {
  try {
    const r = await api.detail(id);
    if (!r) return;
    $("#drawer").innerHTML = detailHTML(r);
    showDrawer();
    $("#drawer").scrollTop = 0;
  } catch (e) {
    console.error("打开详情失败", e);
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
    .querySelectorAll(`.card[data-id="${id}"] .save, .drawer [data-act="save"][data-id="${id}"]`)
    .forEach((b) => b.classList.toggle("on", on));

  const ghost = $('.drawer .dfoot [data-act="save"]');
  if (ghost) ghost.textContent = on ? "取消收藏" : "收藏";

  S.savedList = await api.saved();
  S.savedIds = new Set(S.savedList.map((r) => r.id));
  $("#savedn").textContent = S.savedList.length || "";
  if (S.view === "saved") renderView();
}

/* ── 事件 ───────────────────────────── */

// 图片加载成功才淡入；失败就把 <img> 藏掉，露出底下那层 README 摘录。
// 全程不依赖内联 onerror —— CSP 不允许内联脚本。
document.addEventListener("load", (e) => {
  if (e.target.tagName === "IMG") e.target.classList.add("ok");
}, true);
document.addEventListener("error", (e) => {
  if (e.target.tagName !== "IMG") return;
  e.target.classList.add("broken");
  // 卡片和抽屉的头部都要整体切回文字形态，光把 img 藏起来会留一块空白
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
    if (a === "close") return closeDrawer();
    if (a === "open") return void api.openUrl(`https://github.com/${act.dataset.full}`);
  }
  if (e.target.id === "mask") return closeDrawer();
  const card = e.target.closest(".card");
  if (card) openDetail(Number(card.dataset.id));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
});

document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    S.view = t.dataset.view;
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
    window.scrollTo(0, 0);
    renderView();
  })
);

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
    $("#pool").textContent = `${info.total.toLocaleString("zh-CN")} 个项目 · 本地库`;
    S.feed = await api.feed(800);
    S.savedList = await api.saved();
    S.savedIds = new Set(S.savedList.map((r) => r.id));
    $("#savedn").textContent = S.savedList.length || "";
    $("#hint").hidden = true;
    renderView();
  } catch (e) {
    fatal("读不到本地库", e?.message || String(e));
  }
}

boot();
