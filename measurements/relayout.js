// 实验：抓 GitHub 网页 -> 解析 embeddedData -> 由我们自己重排版
// 同时抓 API 数据做对照，并在输出里标清每个字段来自哪条路。
const fs = require('fs');
const { execFileSync } = require('child_process');

const PROXY = 'http://127.0.0.1:7890';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36';

function curl(url, asJson) {
  const args = ['-sS', '-m', '40', '-x', PROXY, '-H', `User-Agent: ${UA}`, url];
  if (asJson) args.splice(1, 0, '-H', 'Accept: application/vnd.github+json');
  const out = execFileSync('curl', args, { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  return asJson ? JSON.parse(out) : out;
}

// 从仓库页里挖出 GitHub 自己写的那份结构化数据
function parsePage(html) {
  const tag = 'data-target="react-app.embeddedData"';
  const at = html.indexOf(tag);
  if (at < 0) return { ok: false, why: 'no embeddedData' };
  const open = html.indexOf('>', at) + 1;
  const close = html.indexOf('</script>', open);
  try {
    const d = JSON.parse(html.slice(open, close));
    const sb = d.payload && d.payload.sidebarAbout;
    const ov = d.payload && d.payload.codeViewRepoRoute && d.payload.codeViewRepoRoute.overview;
    let readme = '';
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (k === 'richText' && typeof v === 'string' && v.length > readme.length) readme = v;
        else if (v && typeof v === 'object') walk(v);
      }
    })(ov || {});
    return {
      ok: true,
      bytes: close - open,
      desc: sb && sb.description,
      website: sb && sb.website,
      topics: (sb && sb.topics ? sb.topics.map(t => t.name) : []),
      stars: sb && sb.stargazerCount,
      forks: sb && sb.forksCount,
      watchers: sb && sb.watcherCount,
      commits: ov && ov.commitCount,
      readmeHtml: readme,
    };
  } catch (e) {
    return { ok: false, why: 'json parse: ' + e.message };
  }
}

// 我们自己的排版：剥掉脚本与事件属性，图片/链接改绝对地址
function sanitize(html, full) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/src="\//g, 'src="https://github.com/')
    .replace(/href="\//g, 'href="https://github.com/')
    .slice(0, 4200);
}

function sparkline(weeks) {
  if (!weeks || !weeks.length) return '<span class="na">无曲线数据</span>';
  const w = weeks.slice(0, 12).reverse();
  const max = Math.max(...w.map(x => x.total), 1);
  const step = 26;
  const pts = w.map((x, i) => `${i * step + 4},${44 - (x.total / max) * 36}`).join(' ');
  const bars = w
    .map((x, i) => {
      const h = Math.max(2, (x.total / max) * 36);
      return `<rect x="${i * step}" y="${44 - h}" width="16" height="${h}" rx="2"></rect>`;
    })
    .join('');
  return `<svg width="${w.length * step}" height="48" class="spark">${bars}</svg>
    <span class="peak">周峰值 +${max.toLocaleString()}</span>`;
}

const band = JSON.parse(fs.readFileSync('samp.json', 'utf8')).items;
const picks = band.slice(0, 3);
const rows = [];

for (const r of picks) {
  const full = r.full_name;
  console.log('--- ' + full);
  let page = { ok: false, why: 'skip' };
  try {
    page = parsePage(curl('https://github.com/' + full));
  } catch (e) {
    page = { ok: false, why: 'fetch: ' + e.message.slice(0, 60) };
  }
  let hist = null;
  try {
    hist = curl('https://api.github.com/repos/' + full + '/stargazers/history', true);
  } catch (e) {}
  console.log('   页面解析:', page.ok ? `ok (embeddedData ${page.bytes}B)` : 'FAIL ' + page.why);
  console.log(`   页面给的: stars=${page.stars} forks=${page.forks} watchers=${page.watchers} commits=${page.commits} topics=${(page.topics||[]).length} readme=${(page.readmeHtml||'').length}字符`);
  console.log(`   API 给的: stars=${r.stargazers_count} forks=${r.forks_count} topics=${(r.topics||[]).length} —— 曲线 ${Array.isArray(hist)?hist.length+' 周':'无'}`);
  rows.push({ full, api: r, page, hist });
}

const cards = rows
  .map(({ full, api, page, hist }) => {
    const topics = (page.topics && page.topics.length ? page.topics : api.topics || []).slice(0, 6);
    return `
  <article class="card">
    <header>
      <h2><a href="https://github.com/${full}">${full}</a></h2>
      <span class="born">出生 ${api.created_at.slice(0, 10)}</span>
    </header>
    <p class="desc">${(page.desc || api.description || '（无简介）').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</p>
    <div class="chips">${topics.map(t => `<span>${t}</span>`).join('')}</div>
    <div class="stats">
      <b>${(page.stars ?? api.stargazers_count).toLocaleString()}</b> star
      <b>${(page.forks ?? api.forks_count).toLocaleString()}</b> fork
      <b>${page.watchers ?? '—'}</b> watch
      <b>${page.commits ?? '—'}</b> commit
    </div>
    <div class="curve">
      <span class="lbl">每周新增 star（只来自 API）</span>
      ${sparkline(hist)}
    </div>
    <details class="rd"><summary>README（页面解析出的渲染 HTML，已剥脚本）</summary>
      <div class="rdbody">${sanitize(page.readmeHtml || '(页面里没抓到 richText)', full)}</div>
    </details>
    <footer class="prov">
      <span class="p">页面解析：描述 · 语言标签 · star/fork/watch · commit 数 · README 渲染结果</span>
      <span class="a">API：star 增长曲线（页面里没有这个）</span>
    </footer>
  </article>`;
  })
  .join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>重排版实验 · 数据来自 GitHub 页面解析</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:26px;background:#0d1117;color:#e6edf3;font:15px/1.6 -apple-system,"Segoe UI",Roboto,"Microsoft YaHei",sans-serif}
 h1{font-size:17px;margin:0 0 4px;font-weight:650}
 .sub{color:#8d96a0;font-size:12.5px;margin-bottom:20px}
 .card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px 18px;margin-bottom:16px}
 header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
 h2{font-size:16px;margin:0;font-weight:650}
 h2 a{color:#4493f8;text-decoration:none}
 .born{color:#8d96a0;font-size:12px}
 .desc{margin:8px 0 10px;color:#c9d1d9}
 .chips{margin-bottom:10px}
 .chips span{display:inline-block;background:#1f2937;color:#9ecbff;border-radius:999px;padding:1px 9px;font-size:11.5px;margin:0 6px 6px 0}
 .stats{font-size:12.5px;color:#8d96a0;margin-bottom:12px}
 .stats b{color:#e6edf3;font-weight:600;margin-right:2px}
 .curve{background:#0d1117;border-radius:8px;padding:10px 12px;margin-bottom:12px}
 .curve .lbl{display:block;font-size:11.5px;color:#8d96a0;margin-bottom:4px}
 .spark rect{fill:#f78166}
 .peak{color:#f78166;font-size:12px;margin-left:8px}
 .na{color:#8d96a0;font-size:12px}
 details.rd{border-top:1px solid #21262d;padding-top:10px}
 summary{cursor:pointer;font-size:12.5px;color:#8d96a0}
 .rdbody{margin-top:10px;font-size:13.5px;color:#c9d1d9;max-height:260px;overflow:auto;border-left:2px solid #30363d;padding-left:12px}
 .rdbody img{max-width:100%}
 .rdbody pre{background:#0d1117;padding:8px;border-radius:6px;overflow:auto}
 .prov{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:11px}
 .prov .p{color:#7ee787}.prov .a{color:#d2a8ff}
</style></head><body>
<h1>重排版实验 · 卡片流由我们自己渲染，不是 GitHub 的页面</h1>
<div class="sub">候选取自"近 7 天出生、star 20..99"这一档（实测全库 526 个）。每张卡标出字段来源。</div>
${cards}
</body></html>`;

fs.writeFileSync('layout.html', html);
console.log('\n写出 layout.html，字节 =', html.length);
