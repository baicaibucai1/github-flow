import { useEffect, useState } from "react";
import { Badge, Button, Skeleton } from "@soda/ui";
import { ChevronLeftIcon, MessageSquareIcon } from "lucide-react";
import { cn } from "cn";
import {
  issueComments,
  issueDetail,
  log,
  openExternal,
  openInside,
  prDetail,
  prFiles,
  relTime,
  type ChangedFile,
  type Comment,
  type CommentsResult,
  type FilesResult,
  type IssueDetail,
  type PrDetail,
} from "../lib/bridge";
import { RichHtml } from "../components/RichHtml";
import { Box, BoxEmpty, BoxRow } from "../components/gh";

/**
 * 应用内的 issue / PR 详情。
 *
 * ⚠️ 决策（2026-10-06 他的要求）：点列表里的一条**不许跳系统浏览器**，就在这里看；
 * 正文用 GitHub 官方渲染好的 `body_html`（html+json 媒体类型），跟 README 同一条路。
 * 只有 REST 真拿不到的东西（Projects/Security/Insights）才退回应用内 WebView。
 * 这一层只读：不发评论、不合并、不 resolve —— 那是 L3，明确不做。
 *
 * PR 比 issue 多两块：改动量统计，以及逐文件的 unified diff（`/pulls/{n}/files` 的 patch）。
 * diff 只按行前缀上色，没做语法高亮——高亮要引一整个 tokenizer，而这一页的用途是"判断这个 PR 值不值得看"。
 */

const MAX_PATCH_LINES = 400;

const STATE_STYLE: Record<string, string> = {
  open: "bg-[color:var(--color-ok,inherit)] text-white",
  closed: "bg-secondary text-muted-foreground",
  merged: "bg-primary text-white",
};

function stateBadge(state: string, merged?: boolean, draft?: boolean) {
  if (merged) return <Badge className="rounded-full bg-primary text-white">已合并</Badge>;
  if (state === "open") return draft
    ? <Badge variant="outline" className="rounded-full">草稿</Badge>
    : <Badge className="rounded-full bg-[#1a7f37] text-white">open</Badge>;
  return <Badge variant="secondary" className="rounded-full">closed</Badge>;
}

function LabelChips({ labels }: { labels: { name: string; color: string }[] }) {
  if (!labels.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-2xs">
      {labels.slice(0, 6).map((l) => (
        <span
          key={l.name}
          className="rounded-full px-2xs py-px text-[11px]"
          style={{ background: `#${l.color || "d0d7de"}22`, border: `1px solid #${l.color || "d0d7de"}66` }}
        >
          {l.name}
        </span>
      ))}
    </span>
  );
}

/** 一个文件的 diff：状态、增删数、按行前缀上色的正文 */
function FileDiff({ f }: { f: ChangedFile }) {
  const [open, setOpen] = useState(false);
  const lines = f.patch ? f.patch.split("\n") : [];
  const shown = lines.slice(0, MAX_PATCH_LINES);
  return (
    <div className="border-t first:border-t-0">
      <button
        className="flex h-9 w-full items-center gap-2 px-md text-start text-caption hover:bg-secondary"
        onClick={() => setOpen(!open)}
      >
        <span className="w-16 shrink-0 text-muted-foreground">{f.status}</span>
        <span className="truncate font-mono">{f.filename}</span>
        <span className="ms-auto shrink-0 tabular-nums">
          <span className="text-[#1a7f37]">+{f.additions}</span> <span className="text-[#cf222e]">−{f.deletions}</span>
        </span>
      </button>
      {open ? (
        f.binary || !f.patch ? (
          <BoxEmpty>{f.binary ? "二进制文件，GitHub 不给 patch。" : "改动太大，GitHub 没给 patch（请用应用内浏览看）。"}</BoxEmpty>
        ) : (
          <div className="max-h-[50vh] overflow-auto bg-[#f6f8fa] py-2xs dark:bg-[#161b22]">
            <pre className="font-mono text-[11.5px] leading-[1.5]">
              {shown.map((l, i) => (
                <div
                  key={i}
                  className={cn(
                    "px-md",
                    l.startsWith("+") && "bg-[#1a7f3714] text-[#1a7f37]",
                    l.startsWith("-") && "bg-[#cf222e12] text-[#cf222e]",
                    l.startsWith("@@") && "text-muted-foreground"
                  )}
                >
                  {l || " "}
                </div>
              ))}
            </pre>
            {shown.length < lines.length ? (
              <div className="px-md py-sm text-caption text-muted-foreground">
                这个文件还有 {(lines.length - shown.length).toLocaleString()} 行没渲染（已截断）。
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}

export function ItemDetail({
  repoId,
  fullName,
  number,
  kind,
  onBack,
  onNotice,
}: {
  repoId: number;
  fullName: string;
  number: number;
  kind: "issue" | "pull";
  onBack: () => void;
  onNotice: (m: string) => void;
}) {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [pr, setPr] = useState<PrDetail | null>(null);
  const [comments, setComments] = useState<CommentsResult | null>(null);
  const [files, setFiles] = useState<FilesResult | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr("");
    setIssue(null);
    setPr(null);
    setComments(null);
    setFiles(null);
    const base = kind === "pull" ? prDetail(repoId, number) : issueDetail(repoId, number);
    base
      .then((r) => {
        if (!alive) return;
        if (r.error) {
          setErr(r.error);
          return;
        }
        log(`item ${kind} #${number} 正文 ${(r.body_html || "").length} 字符`);
        if (kind === "pull") setPr(r as PrDetail);
        else setIssue(r as IssueDetail);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setBusy(false));

    // 评论两边都要；diff 只有 PR 要
    issueComments(repoId, number)
      .then((r) => alive && setComments(r))
      .catch(() => undefined);
    if (kind === "pull") {
      prFiles(repoId, number)
        .then((r) => alive && setFiles(r))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [repoId, number, kind]);

  const title = pr?.title ?? issue?.title ?? "";
  const state = pr?.state ?? issue?.state ?? "";
  const author = pr?.author ?? issue?.author ?? "";
  const createdAt = pr?.created_at ?? issue?.created_at ?? "";
  const body = pr?.body_html ?? issue?.body_html ?? "";
  const labels = pr?.labels ?? issue?.labels ?? [];
  const url = pr?.url ?? issue?.url ?? `https://github.com/${fullName}/issues/${number}`;

  // 正文里的链接一律走 RichHtml：锚点在本篇滚、指向本仓库文件的进左栏预览、其余开应用内窗口

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center gap-xs border-b pb-sm">
        <Button size="xs" variant="ghost" onClick={onBack}>
          <ChevronLeftIcon data-icon="inline-start" />
          返回列表
        </Button>
        {!busy && !err ? stateBadge(state, pr?.merged, pr?.draft) : null}
        <h2 className="min-w-0 truncate text-title">
          {title} <span className="text-muted-foreground">#{number}</span>
        </h2>
        <LabelChips labels={labels} />
        <span className="ms-auto flex shrink-0 items-center gap-xs">
          <Button size="xs" variant="ghost" onClick={() => openInside(url, repoId).catch((e) => onNotice(String(e)))}>
            应用内浏览
          </Button>
          <Button size="xs" variant="ghost" onClick={() => openExternal(url).catch((e) => onNotice(String(e)))}>
            在浏览器打开
          </Button>
        </span>
      </div>

      {err ? (
        <Box>
          <BoxEmpty>{err}</BoxEmpty>
        </Box>
      ) : busy ? (
        <Box>
          {[0, 1, 2].map((i) => (
            <BoxRow key={i}>
              <Skeleton className="h-4 w-2/3" />
            </BoxRow>
          ))}
        </Box>
      ) : (
        <>
          <div className="text-caption text-muted-foreground tabular-nums">
            {author} 开于 {relTime(createdAt)}
            {pr ? (
              <>
                {" · "}
                <span className="font-mono">{pr.head}</span> → <span className="font-mono">{pr.base}</span>
                {" · "}
                {pr.commits} 个 commit
              </>
            ) : null}
          </div>

          {pr ? (
            <Box
              title={`变更 ${pr.changed_files} 个文件`}
              aside={
                <span className="tabular-nums">
                  <span className="text-[#1a7f37]">+{pr.additions}</span> <span className="text-[#cf222e]">−{pr.deletions}</span>
                </span>
              }
            >
              {files?.error ? (
                <BoxEmpty>{files.error}</BoxEmpty>
              ) : !files ? (
                <BoxRow>
                  <Skeleton className="h-4 w-1/2" />
                </BoxRow>
              ) : !files.items.length ? (
                <BoxEmpty>这个 PR 没有可显示的文件改动</BoxEmpty>
              ) : (
                <>
                  {files.items.map((f) => (
                    <FileDiff key={f.filename} f={f} />
                  ))}
                  {files.truncated ? (
                    <div className="border-t px-md py-sm text-caption text-muted-foreground">
                      改动文件超过 100 个，只显示了前 100 个。
                    </div>
                  ) : null}
                </>
              )}
            </Box>
          ) : null}

          <Box title="描述" aside={<span>GitHub 渲染的 HTML · 与 README 同一路</span>}>
            {body ? (
              <RichHtml html={body} fullName={fullName} repoId={repoId} onNotice={onNotice} />
            ) : (
              <BoxEmpty>这条没有正文</BoxEmpty>
            )}
          </Box>

          <Box
            title={`评论 ${comments?.count ?? 0}`}
            aside={<span>{comments && comments.count > 100 ? "只取最近 100 条" : "按时间正序"}</span>}
          >
            {!comments ? (
              <BoxRow>
                <Skeleton className="h-4 w-1/3" />
              </BoxRow>
            ) : !comments.items.length ? (
              <BoxEmpty>还没有人评论</BoxEmpty>
            ) : (
              comments.items.map((c: Comment, i: number) => (
                <BoxRow key={i}>
                  <div className="mb-2xs flex items-center gap-xs text-caption text-muted-foreground tabular-nums">
                    <MessageSquareIcon className="size-3.5" />
                    <b className="text-foreground">{c.author}</b>
                    {c.association && c.association !== "NONE" ? <Badge variant="outline">{c.association}</Badge> : null}
                    {relTime(c.created_at)}
                  </div>
                  {/* 空正文的评论是真实存在的（实测 react/react#1 第 7 条 body 整个字段都没有），
                      不写这一句，界面上就是一条只有作者名的空行，看着像我们渲染坏了 */}
                  {c.body_html ? (
                    <RichHtml html={c.body_html} fullName={fullName} repoId={repoId} onNotice={onNotice} className="md" />
                  ) : (
                    <div className="text-caption text-muted-foreground">（这条评论没有正文）</div>
                  )}
                </BoxRow>
              ))
            )}
          </Box>
        </>
      )}
    </div>
  );
}
