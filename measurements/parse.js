const fs=require('fs');
const s=fs.readFileSync('page.html','utf8');
console.log('页面字节 =', s.length);
// 1) JSON islands
const re=/<script type="application\/json"[^>]*data-target="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g;
let m, n=0;
while((m=re.exec(s))){
  n++;
  let obj=null, err='';
  try{obj=JSON.parse(m[2]);}catch(e){err=e.message.slice(0,40);}
  const keys=obj&&!Array.isArray(obj)?Object.keys(obj).slice(0,14).join(', '):'';
  console.log(`\n#${n} target="${m[1]}" bytes=${m[2].length} ${err?('PARSE_FAIL '+err):''}`);
  if(keys) console.log('   keys:', keys);
}
console.log('\nJSON island 总数 =', n);
// 2) 关键字段是否存在于 HTML
const probes=['stargazerCount','forkCount','richText','fileTree','topics','description','latestRelease','languages','contributors','subscribersCount','isStarred','watchCount','securityAndQuality','releases'];
console.log('\n字段出现次数（在 HTML 全文里）:');
for(const p of probes){
  const c=(s.match(new RegExp('"'+p+'"','g'))||[]).length;
  console.log('  ', p.padEnd(20), c);
}
// 3) class 名锚点有多少（DOM 重排的成本指标）
console.log('\nclass 属性出现次数 =', (s.match(/class="/g)||[]).length);
console.log('data- 属性出现次数 =', (s.match(/ data-[a-z-]+=/g)||[]).length);
