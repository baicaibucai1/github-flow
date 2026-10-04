const fs=require('fs');
const s=fs.readFileSync('page.html','utf8');
const re=/<script type="application\/json"[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/g;
const m=re.exec(s); const d=JSON.parse(m[1]);
const shape=(o,pfx='',dep=0)=>{
  if(dep>2) return;
  for(const k of Object.keys(o)){
    const v=o[k]; const t=Array.isArray(v)?`array[${v.length}]`:(v===null?'null':typeof v);
    let extra='';
    if(typeof v==='number'||typeof v==='string') extra='= '+JSON.stringify(String(v).slice(0,46));
    if(t.startsWith('array[')&&v.length&&typeof v[0]==='object'&&v[0]) extra='  e.g. keys{'+Object.keys(v[0]).slice(0,6).join(',')+'}';
    console.log('  '.repeat(dep)+pfx+k.padEnd(26)+t.padEnd(11)+extra);
    if(v&&typeof v==='object'&&!Array.isArray(v)) shape(v,'',dep+1);
  }
};
console.log('=== top level ==='); shape(d,'',0);
