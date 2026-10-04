// 解剖 GitHub 仓库页里那段 react-app.embeddedData，回答两个问题：
// 1) 页面一次请求到底带回了多少 API 需要多次请求才拿到的东西
// 2) 解析锚点是稳定字段名还是会变的 DOM 结构
const fs = require('fs');
const s = fs.readFileSync(process.argv[2] || 'page.html', 'utf8');

const tag = 'data-target="react-app.embeddedData"';
const at = s.indexOf(tag);
if (at < 0) {
  console.log('!! 这一页里没有 react-app.embeddedData —— 该锚点在此页型不存在');
  process.exit(0);
}
const open = s.indexOf('>', at) + 1;
const close = s.indexOf('</script>', open);
const d = JSON.parse(s.slice(open, close));
console.log('embeddedData 字节 =', close - open);

const route = d.payload && d.payload.codeViewRepoRoute;
const ov = route && route.overview;
console.log('\n=== payload.codeViewRepoRoute.overview 的键 ===');
if (!ov) console.log('  (无 overview)');
else
  for (const k of Object.keys(ov)) {
    const v = ov[k];
    const t = Array.isArray(v) ? `array[${v.length}]` : v === null ? 'null' : typeof v;
    let note = '';
    if (v && typeof v === 'object' && !Array.isArray(v))
      note = ' { ' + Object.keys(v).slice(0, 9).join(', ') + ' }';
    if (typeof v === 'number' || typeof v === 'string')
      note = ' = ' + JSON.stringify(String(v).slice(0, 44));
    console.log('  ' + k.padEnd(22) + t.padEnd(10) + note);
  }

console.log('\n=== payload.sidebarAbout 的键 ===');
const sb = d.payload && d.payload.sidebarAbout;
if (sb) console.log('  ' + Object.keys(sb).join(', '));

console.log('\n=== appPayload ===');
console.log('  ' + (d.appPayload ? Object.keys(d.appPayload).slice(0, 30).join(', ') : '(空)'));

const hits = [];
(function walk(o, p) {
  if (!o || typeof o !== 'object') return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (k === 'richText' && typeof v === 'string') hits.push([p + '.' + k, v.length]);
    else if (v && typeof v === 'object') walk(v, p + '.' + k);
  }
})(d.payload, 'payload');
console.log('\n=== README/正文 richText 位置与体量 ===');
if (!hits.length) console.log('  (无)');
hits.forEach(([p, n]) => console.log('  ' + p + '  html字符=' + n));

const domClassCount = (s.match(/class="/g) || []).length;
console.log('\n=== 对比：DOM 路径的规模 ===');
console.log('  整页字节 =', s.length, '| class 属性出现 =', domClassCount, '| JSON 字段路径 =', hits.length + Object.keys(d.payload || {}).length);
