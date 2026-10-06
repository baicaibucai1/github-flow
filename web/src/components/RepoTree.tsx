import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Badge, Button, Skeleton } from "@soda/ui";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { cn } from "cn";
import { log, openExternal, repoFile, repoTree, type FileResult, type TreeEntry } from "../lib/bridge";
import { Box, BoxEmpty, BoxRow } from "./gh";

/**
 * 仓库文件视图。
 *
 * ⚠️ 摆法决策（2026-10-06 他明确要求，别再改回去）：**文件树不做成单独一页、也不是一个页签，
 * 它就在项目详情的右侧栏里**，跟 README 并排。左栏是"内容"（默认 README，从右栏点一个文件之后
 * 切成这个文件的预览，顶部给「返回 README」），右栏是"结构与元信息"（文件树 + 关于 + 曲线 + 语言 + release）。
 * 曾经做过"文件"页签那一版，被否掉了——理由是一致的：点开一个项目时，文件树是**判断它值不值得看的材料**，
 * 藏到页签后面等于逼用户凭空决定要不要点它。
 *
 * 为什么树在前端拼而不是逐层问 API：git/trees?recursive=1 一次拿全（4000 条封顶），
 * 逐层展开要每个目录发一次请求，点开三层就烧掉三次配额，而树本身根本没变。
 *
 * 这一层只读。blame、CI 日志、Discussions 仍然走「应用内浏览 GitHub」，不在应用里重造那半个前端。
 */

type Node = { name: string; path: string; dir: boolean; size: number; children: Node[] };

/** 扁平路径 → 层级树。目录排前面，同类按名字排，跟 GitHub 的列表一致。 */
export function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, size: 0, children: [] };
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const parts = e.path.split("/");
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join("/");
      let hit = parent.children.find((c) => c.dir && c.path === p);
      if (!hit) {
        hit = { name: parts[i], path: p, dir: true, size: 0, children: [] };
        parent.children.push(hit);
      }
      parent = hit;
    }
    parent.children.push({ name: parts[parts.length - 1], path: e.path, dir: e.dir, size: e.size, children: [] });
  }
  const sortRec = (ns: Node[]) => {
    ns.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    ns.forEach((n) => sortRec(n.children));
  };
  sortRec(root.children);
  return root.children;
}

function fmtSize(b: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// 一次渲染几万行会把 webview 卡住，所以只渲染前这么多行并说清楚
const MAX_LINES = 2000;

export type RepoFiles = {
  nodes: Node[];
  branch: string;
  count: number;
  truncated: boolean;
  busy: boolean;
  err: string;
  expanded: Set<string>;
  toggleDir: (p: string) => void;
  sel: string;
  file: FileResult | null;
  fileBusy: boolean;
  pick: (p: string) => void;
  backToReadme: () => void;
  collapseAll: () => void;
};

/**
 * 取数与状态都在这里，右栏的树与左栏的预览只负责画。
 * 树是进详情页就取的（它现在是概览的一部分，不再是藏起来的页签）：点开一个项目的成本
 * 从 1~4 次 core 变成 2~6 次，但分支缓存 1 天、树缓存 1 小时，来回看同一批仓库时是命中。
 */
export function useRepoFiles(repoId: number, enabled = true): RepoFiles {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [branch, setBranch] = useState("main");
  const [truncated, setTruncated] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState("");
  const [file, setFile] = useState<FileResult | null>(null);
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    // enabled 之前不取：详情本身都没拿到（库里没这个项目 / 网络挂了）时，不该先烧掉一次树请求
    if (!enabled) return;
    let alive = true;
    setBusy(true);
    setErr("");
    setEntries([]);
    setSel("");
    setFile(null);
    repoTree(repoId)
      .then((r) => {
        if (!alive) return;
        if (r.error) {
          setErr(r.error);
          return;
        }
        setEntries(r.entries ?? []);
        setBranch(r.branch ?? "main");
        setTruncated(!!r.truncated);
        setCount(r.count ?? 0);
        // 默认只铺开根目录这一层，子目录收着：GitHub 的仓库页就是这个样子，
        // 而且 react 那种根目录一点开就是几百行，全展开等于把滚动条废掉。
        setExpanded(new Set());
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [repoId, enabled]);

  const nodes = useMemo(() => buildTree(entries), [entries]);

  const toggleDir = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const pick = (p: string) => {
    setSel(p);
    setFileBusy(true);
    setFile(null);
    repoFile(repoId, p)
      .then((r) => {
        setFile(r);
        log(`file ${p} ${r.bytes}B binary=${r.binary} truncated=${r.truncated}`);
      })
      .catch((e) => setFile({ path: p, bytes: 0, truncated: false, binary: false, text: "", error: String(e) }))
      .finally(() => setFileBusy(false));
  };

  const backToReadme = () => {
    setSel("");
    setFile(null);
  };

  const collapseAll = () => setExpanded(new Set());

  return {
    nodes,
    branch,
    count,
    truncated,
    busy,
    err,
    expanded,
    toggleDir,
    sel,
    file,
    fileBusy,
    pick,
    backToReadme,
    collapseAll,
  };
}

/** 右栏那棵树：点目录展开、点文件交给上层把左栏切成预览。
 *
 * ⚠️ 视觉决策（他 2026-10-06 说"这个文件树很丑，稍微做一点布局设计"之后定的，别再退回表格摆法）：
 * 之前每行一条通栏分隔线 + 尺寸列带竖线，整体读起来是账本。现在按 IDE 侧栏那种树的规矩来：
 * ① **没有任何行线**，靠 hover 底色和缩进引导线表达结构；② 缩进 14px 一级、每级一条 1px 引导线
 * （层级靠这个看得出来，而不是靠缩进量硬猜）；③ 选中态是"底色 + 左侧 2px 主色条"，不是加粗原文；
 * ④ 行高固定 28px、图标 14px、尺寸 11px 右对齐且不带分隔线。行高与图标统一是"看起来整"的前提。
 */
export function RepoTreeBox({ f, maxH = "44vh" }: { f: RepoFiles; maxH?: string }) {
  const guides = (depth: number) =>
    Array.from({ length: depth }).map((_, i) => (
      <span key={i} className="w-3.5 shrink-0 self-stretch border-s border-border/60" aria-hidden />
    ));

  const rowBase =
    "relative flex h-7 w-full items-center gap-1.5 rounded-sm ps-1.5 pe-1 text-start text-caption hover:bg-secondary";

  const renderNodes = (ns: Node[], depth: number): ReactElement[] =>
    ns.flatMap((n) => {
      const isSel = !n.dir && n.path === f.sel;
      const row = (
        <button
          key={n.path}
          title={n.path}
          onClick={() => (n.dir ? f.toggleDir(n.path) : f.pick(n.path))}
          className={cn(
            rowBase,
            isSel && "bg-secondary font-semibold",
            n.dir && "font-medium",
            !n.dir && n.name.startsWith(".") && !isSel && "text-muted-foreground"
          )}
        >
          {isSel ? <span className="absolute inset-y-0 start-0 w-0.5 rounded-full bg-primary" aria-hidden /> : null}
          {guides(depth)}
          {n.dir ? (
            <>
              <ChevronRightIcon
                className={cn("size-3 shrink-0 text-muted-foreground transition-transform", f.expanded.has(n.path) && "rotate-90")}
              />
              <FolderIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{n.name}</span>
            </>
          ) : (
            <>
              {/* 文件不占箭头那一格会跟目录名错位，所以留同样宽的空 */}
              <span className="w-3 shrink-0" />
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
              <span className="ms-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{fmtSize(n.size)}</span>
            </>
          )}
        </button>
      );
      return n.dir && f.expanded.has(n.path) ? [row, ...renderNodes(n.children, depth + 1)] : [row];
    });

  const anyOpen = f.expanded.size > 0;
  return (
    <Box
      title="文件"
      aside={
        <span className="flex items-center gap-xs">
          {f.count ? <span className="tabular-nums">{f.count.toLocaleString()} 项</span> : null}
          <Badge variant="outline">{f.branch}</Badge>
          {anyOpen ? (
            <Button size="xs" variant="ghost" onClick={f.collapseAll}>
              全部收起
            </Button>
          ) : null}
        </span>
      }
    >
      <div className="px-1 py-1" style={{ maxHeight: maxH, overflow: "auto" }}>
        {f.busy ? (
          [0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex h-7 items-center px-1.5">
              <Skeleton className="h-3.5" style={{ width: `${72 - i * 6}%` }} />
            </div>
          ))
        ) : f.err ? (
          <BoxEmpty>{f.err}</BoxEmpty>
        ) : !f.nodes.length ? (
          <BoxEmpty>这个仓库没有可读的文件</BoxEmpty>
        ) : (
          <>
            {renderNodes(f.nodes, 0)}
            {f.truncated ? (
              <div className="px-1.5 py-sm text-caption text-muted-foreground">
                条目过多，只拿到前 {f.count.toLocaleString()} 条（已截断）；完整树请看 GitHub。
              </div>
            ) : null}
          </>
        )}
      </div>
    </Box>
  );
}

/** 左栏那个预览：选中文件的正文，带行号；二进制与大文件都有话说。 */
export function FilePreview({
  f,
  fullName,
  onNotice,
}: {
  f: RepoFiles;
  fullName: string;
  onNotice: (m: string) => void;
}) {
  const lines = (f.file?.text ?? "").split("\n");
  const shown = lines.slice(0, MAX_LINES);
  return (
    <Box
      title={f.sel}
      aside={
        <span className="flex items-center gap-xs">
          {f.file ? `${f.file.bytes.toLocaleString()} 字节` : ""}
          <Button size="xs" variant="ghost" onClick={f.backToReadme}>
            返回 README
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              const u = `https://github.com/${fullName}/blob/${f.branch}/${f.sel.split("/").map(encodeURIComponent).join("/")}`;
              openExternal(u).catch((e) => onNotice("没打开：" + String(e)));
            }}
          >
            在 GitHub 打开
          </Button>
        </span>
      }
    >
      {f.fileBusy ? (
        <BoxRow className="py-lg">
          <Skeleton className="h-4 w-1/2" />
        </BoxRow>
      ) : f.file?.error ? (
        <BoxEmpty>{f.file.error}</BoxEmpty>
      ) : f.file?.binary ? (
        <BoxEmpty>
          二进制文件，不做预览（{f.file.bytes.toLocaleString()} 字节）。要看不完整的内容请用「应用内浏览 GitHub」。
        </BoxEmpty>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-collapse font-mono text-caption">
            <tbody>
              {shown.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="w-10 select-none border-e bg-secondary px-xs py-px text-end text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  <td className="whitespace-pre px-sm py-px">{l}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length < lines.length ? (
            <div className="border-t px-md py-sm text-caption text-muted-foreground">
              后面还有 {(lines.length - shown.length).toLocaleString()} 行未渲染（行数已截断），文件大时请在 GitHub 上看。
            </div>
          ) : null}
          {f.file?.truncated ? (
            <div className="border-t px-md py-sm text-caption text-muted-foreground">
              内容超过 200 KB，取到的正文本身也被截断了。
            </div>
          ) : null}
        </div>
      )}
    </Box>
  );
}
