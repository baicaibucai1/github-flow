// 生成界面截图用的数据：全部取自本机库里**真实**的仓库，只留 hot 通道，
// 并且把带个人口味的理由行（画像命中 / @某人 收藏了它）剔掉——README 是给别人看的，
// 不该把"他关注谁、他喜欢什么词"打进一个公开仓库的 fixture 里。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const EXE = "src-tauri/target/debug/collect.exe";
const run = (a) => execFileSync(EXE, a, { encoding: "utf8", maxBuffer: 64e6, timeout: 180000 });
const raw = (a) => JSON.parse(run(a).split("\n").find((l) => l.startsWith("RAW ")).slice(4));

const personal = (w) => /画像|@|相似用户|校准时|窗口/.test(w);
// README 的配图是门面：这条是"内容策略未决"那个待办里的样本（破解工具类），
// 不是把它藏起来——手册和 README 里照旧写着这条待办，只是不用它当门面图。
const SKIP = /Relapse-Exploit/i;
const cards = raw(["top", "100"])
  .filter((c) => c.channel === "hot" && !SKIP.test(c.full_name))
  .slice(0, 8)
  .map((c) => ({ ...c, why: (c.why ?? []).filter((w) => !personal(w)) }));

// 详情用第一张卡：它有真实的 README（官方渲染的 HTML）与文件树
const id = cards[0].id;
const detail = raw(["detail", String(id), "raw"]);
const treeOut = run(["tree", String(id)]);
const treeLine = treeOut.split("\n").find((l) => l.startsWith("RAW "));
const tree = treeLine ? JSON.parse(treeLine.slice(4)) : null;
if (!tree) console.log("tree 没有 RAW，界面截图会退化成空树：", treeOut.split("\n").slice(0, 3).join(" / "));

const data = { cards, detail, tree, lists: { issue: null, pull: null } };
for (const k of ["issue", "pull"]) {
  const line = run(["list", String(id), k]).split("\n").find((l) => l.startsWith("RAW "));
  if (line) data.lists[k === "issue" ? "issue" : "pull"] = JSON.parse(line.slice(4));
}
// 直接写成 .ts：探针与出图页 import 它，省掉一次手工转换
const head =
  "// 界面截图用的数据：由 tools/mkshot.mjs 从本机库里的**真实**仓库导出，只留 hot 通道，\n" +
  "// 并把带个人口味的理由行（画像命中 / @某人 收藏了它）剔掉——README 是给别人看的，\n" +
  "// 不该把\u0022他关注谁、他喜欢什么词\u0022打进一个公开仓库的 fixture 里。重新生成：node tools/mkshot.mjs\n" +
  "/* eslint-disable */\n// @ts-nocheck\nexport const SHOT = ";
writeFileSync("web/src/shotdata.ts", head + JSON.stringify(data, null, 1) + ";\n");
console.log(
  `shotdata.ts 写好：卡片 ${cards.length} 条（全 hot，理由行已去个人化）· 详情 ${detail.full_name} readme ${(detail.readme_html ?? "").length} 字符 · 树 ${tree?.count ?? 0} 项 · issue ${data.lists.issue?.count ?? 0} / pull ${data.lists.pull?.count ?? 0}`
);
