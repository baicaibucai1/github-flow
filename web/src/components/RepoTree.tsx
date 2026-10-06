import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Badge, Button, Skeleton } from "@soda/ui";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { cn } from "cn";
import { log, openExternal, repoFile, repoTree, type FileResult, type TreeEntry } from "../lib/bridge";
import { Box, BoxEmpty, BoxRow } from "./gh";

/**
 * 仓库文件视图：左边一棵树，右边选中文件的预览。
 *
 * 为什么树在前端拼而不是逐层问 API：git/trees?recursive=1 一次就拿全（4000 条封顶），
 * 逐层展开要每个目录发一次请求，点开三层就烧掉三次配额，而树本身根本没变。
 * 前端拼树的代价只是几百次字符串比较。
 *
 * 这一层只读。blame、CI 日志、Discussions 仍然走「应用内浏览 GitHub」，
 * 不在应用里重造那半个前端（技术手册 9.6 的边界）。
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

export function RepoTree({
  repoId,
  fullName,
  onNotice,
}: {
  repoId: number;
  fullName: string;
  onNotice: (m: string) => void;
}) {
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
    let alive = true;
    setBusy(true);
    setErr("");
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
  }, [repoId]);

  const tree = useMemo(() => buildTree(entries), [entries]);

  const open = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
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

  const toggle = (n: Node) => (n.dir ? open(n.path) : pick(n.path));

  const renderNodes = (ns: Node[], depth: number): ReactElement[] =>
    ns.flatMap((n) => {
      const row = (
        <button
          key={n.path}
          onClick={() => toggle(n)}
          className={cn(
            "flex w-full items-center gap-2xs border-b py-2xs text-start text-caption hover:bg-secondary",
            !n.dir && n.path === sel && "bg-secondary font-semibold"
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {n.dir ? (
            <>
              <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", expanded.has(n.path) && "rotate-90")} />
              <FolderIcon className="size-3.5 shrink-0 text-primary" />
              <span className="truncate font-semibold">{n.name}</span>
            </>
          ) : (
            <>
              <span className="w-3.5 shrink-0" />
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{n.name}</span>
              <span className="ms-auto shrink-0 pe-sm text-muted-foreground tabular-nums">{fmtSize(n.size)}</span>
            </>
          )}
        </button>
      );
      return n.dir && expanded.has(n.path) ? [row, ...renderNodes(n.children, depth + 1)] : [row];
    });

  const lines = (file?.text ?? "").split("\n");
  const shown = lines.slice(0, MAX_LINES);

  return (
    <div className="grid items-start gap-md lg:grid-cols-[300px_minmax(0,1fr)]">
      <Box
        title="文件"
        aside={<Badge variant="outline">{branch}</Badge>}
        className="max-h-[70vh] overflow-auto"
      >
        {busy ? (
          [0, 1, 2, 3, 4].map((i) => (
            <BoxRow key={i} className="py-sm">
              <Skeleton className="h-3.5 w-2/3" />
            </BoxRow>
          ))
        ) : err ? (
          <BoxEmpty>{err}</BoxEmpty>
        ) : !tree.length ? (
          <BoxEmpty>这个仓库没有可读的文件</BoxEmpty>
        ) : (
          <>
            {renderNodes(tree, 0)}
            {truncated ? (
              <div className="border-t px-md py-sm text-caption text-muted-foreground">
                条目过多，只拿到前 {count.toLocaleString()} 条（已截断）；完整树请看 GitHub。
              </div>
            ) : null}
          </>
        )}
      </Box>

      <Box
        title={sel || "选一个文件看内容"}
        aside={
          sel ? (
            <span className="flex items-center gap-xs">
              {file ? `${file.bytes.toLocaleString()} 字节` : ""}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  const u = `https://github.com/${fullName}/blob/${branch}/${sel
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`;
                  openExternal(u).catch((e) => onNotice("没打开：" + String(e)));
                }}
              >
                在 GitHub 打开
              </Button>
            </span>
          ) : null
        }
      >
        {!sel ? (
          <BoxEmpty>左边点一个文件即可预览。整棵树一请求拿全，切换文件不再重复取树。</BoxEmpty>
        ) : fileBusy ? (
          <BoxRow className="py-lg">
            <Skeleton className="h-4 w-1/2" />
          </BoxRow>
        ) : file?.error ? (
          <BoxEmpty>{file.error}</BoxEmpty>
        ) : file?.binary ? (
          <BoxEmpty>二进制文件，不做预览（{file.bytes.toLocaleString()} 字节）。要看不完整的内容请用「应用内浏览 GitHub」。</BoxEmpty>
        ) : (
          <div className="overflow-auto">
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
            {file?.truncated ? (
              <div className="border-t px-md py-sm text-caption text-muted-foreground">
                内容超过 200 KB，取到的正文本身也被截断了。
              </div>
            ) : null}
          </div>
        )}
      </Box>
    </div>
  );
}
