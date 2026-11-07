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
    ? `<img class="shot" src="${esc(r.cover_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
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
  feedEl.hidden = S.view !== "feed";
  savedEl.hidden = S.view !== "saved";
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
// 这里只覆盖读得懂的部分，读不懂的按普通段落走。
// 安全上只有一条铁律：**先把整行 HTML 转义，再按 markdown 结构还原标签**。
// 顺序反了的话，README 里藏一个 <script> 就能在应用里执行。
function md(src, opt = {}) {
  const base = opt.base || "";
  const abs = opt.abs || "";
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;
  let fence = null;
  let table = null;

  const inline = (s) => inlineMd(s, base, abs);
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(
        `<${list.tag}>` +
          list.items.map((t) => `<li>${inline(t)}</li>`).join("") +
          `</${list.tag}>`
      );
      list = null;
    }
  };
  const flushTable = () => {
    if (table) {
      const head = `<tr>${table.head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`;
      const body = table.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
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

  for (const raw of lines) {
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
      flushAll();
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
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const isSep = cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
      if (isSep && table) {
        table.head = table.head.length ? table.head : cells;
        continue;
      }
      if (!table) {
        flushPara();
        flushList();
        table = { head: [], rows: [] };
      }
      table.rows.push(cells);
      continue;
    }
    flushTable();

    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = /^\d/.test(li[1]) ? "ol" : "ul";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push(li[2]);
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

function inlineMd(s, base, abs) {
  let t = esc(s);

  // 行内代码先抠出来占位，别让后面的规则动它
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });

  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => {
    const u = safeUrl(url, base);
    return u ? `<img src="${u}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : esc(m);
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, txt, url) => {
    const u = safeUrl(url, abs, true);
    return u ? `<a href="${u}" target="_blank" rel="noreferrer noopener">${txt}</a>` : txt;
  });

  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");

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
  const fig = hasImg
    ? `<div class="mfig ${kind === "logo" ? "is-logo" : ""}">
         <img src="${esc(r.cover_url)}" alt="" decoding="async" referrerpolicy="no-referrer">
       </div>`
    : r.readme_head && !dup
      ? `<div class="mquote"><p>${esc(r.readme_head)}</p></div>`
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
  } catch (e) {
    console.error("打开详情失败", e);
  }
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
      const n = md(text, { base, abs });
      body.innerHTML =
        `<div class="md fold">${n}</div>` +
        `<button class="mexpand" data-act="expand">展开全部 README</button>`;
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
  }
  if (e.target.id === "mask") return closeModal();
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
  } catch (e) {
    fatal("读不到本地库", e?.message || String(e));
  }
}

boot();
