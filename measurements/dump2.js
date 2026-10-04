const fs=require('fs');
const s=fs.readFileSync('page.html','utf8');
const m=/<script type="application\/json"[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/.exec(s);
const d=JSON.parse(m[1]);
const ov=d.payload.codeViewRepoRoute.overview;
console.log('=== overview keys ===');
for(const k of Object.keys(ov)){
  const v=ov[k];
  const t=Array.isArray(v)?`array[${v.length}]`:(v===null?'null':typeof v);
  let note='';
  if(typeof v==='object'&&v&&!Array.isArray(v)) note=' { '+Object.keys(v).slice(0,8).join(', ')+' }';
  if(typeof v==='number'||typeof v==='string') note=' = '+JSON.stringify(String(v).slice(0,40));
  console.log('  '+k.padEnd(24)+t.padEnd(10)+note);
}
console.log('\n=== appPayload keys ===');
console.log('  '+(d.appPayload?Object.keys(d.appPayload).slice(0,25).join(', '):'(empty)'));
console.log('\n=== README 体量 ===');
const rt=JSON.stringify(ov).match(/"richText":"((?:[^"\]|\.)*)"/);
if(rt){ const html=JSON.parse('"'+rt[1]+'"'); console.log('  README 渲染后 HTML 字符数 =', html.length); console.log('  前 120 字符:', html.slice(0,120).replace(/\n/g,' ')); }
else console.log('  未在 overview 里找到 richText');
