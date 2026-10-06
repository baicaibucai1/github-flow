import { useEffect, useState } from "react";
import { Badge, Button, Skeleton } from "@soda/ui";
import { actionsRuns, log, openInside, relTime, type RunsResult } from "../lib/bridge";
import { Box, BoxEmpty, BoxRow } from "../components/gh";

/**
 * Actions 的运行列表。
 *
 * ⚠️ 边界：**只能读到列表**。日志下载要仓库权限（别人的仓库拿不到），所以点一条 run 是走
 * 应用内 WebView，不是系统浏览器（他 2026-10-06 的要求：能读的在应用内读，读不了的也留在应用内）。
 */

const CONC: Record<string, { label: string; cls: string }> = {
  success: { label: "成功", cls: "bg-[#1a7f37] text-white" },
  failure: { label: "失败", cls: "bg-[#cf222e] text-white" },
  skipped: { label: "跳过", cls: "" },
  cancelled: { label: "取消", cls: "" },
  neutral: { label: "中立", cls: "" },
  timed_out: { label: "超时", cls: "bg-[#bf8700] text-white" },
  action_required: { label: "待处理", cls: "bg-[#bf8700] text-white" },
};

export function ActionsPanel({ repoId, fullName, onNotice }: { repoId: number; fullName: string; onNotice: (m: string) => void }) {
  const [r, setR] = useState<RunsResult | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setR(null);
    setErr("");
    actionsRuns(repoId)
      .then((x) => {
        if (!alive) return;
        if (x.error) setErr(x.error);
        else setR(x);
        log(`actions ${fullName} 共 ${x.total} 次运行`);
      })
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [repoId, fullName]);

  const openRun = (url: string) => {
    if (!url) return;
    openInside(url, repoId).catch((e) => onNotice("打不开：" + String(e)));
  };

  return (
    <Box
      title="Actions"
      aside={
        <span className="flex items-center gap-xs">
          {r ? `${r.total.toLocaleString()} 次运行 · 最近 ${r.count} 条` : ""}
          <Button size="xs" variant="ghost" onClick={() => openInside(`https://github.com/${fullName}/actions`, repoId)}>
            完整记录
          </Button>
        </span>
      }
    >
      {err ? (
        <BoxEmpty>{err}</BoxEmpty>
      ) : !r ? (
        [0, 1, 2, 3].map((i) => (
          <BoxRow key={i} className="py-sm">
            <Skeleton className="h-4 w-2/3" />
          </BoxRow>
        ))
      ) : !r.items.length ? (
        <BoxEmpty>这个仓库没有 Actions 运行（或者没开 Actions）</BoxEmpty>
      ) : (
        r.items.map((run) => {
          const c = CONC[run.conclusion] ?? { label: run.status, cls: "" };
          return (
            <BoxRow key={run.id}>
              <button className="flex w-full flex-col gap-2xs text-start hover:underline" onClick={() => openRun(run.url)}>
                <span className="flex flex-wrap items-center gap-xs">
                  <Badge className={`rounded-full ${c.cls}`} variant={c.cls ? undefined : "secondary"}>
                    {c.label}
                  </Badge>
                  <b className="text-label">{run.name}</b>
                  <span className="truncate text-caption text-muted-foreground">#{run.run_number}</span>
                </span>
                <span className="truncate text-caption text-muted-foreground">{run.title}</span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {run.event} · {run.branch} · {relTime(run.created_at)}
                </span>
              </button>
            </BoxRow>
          );
        })
      )}
    </Box>
  );
}
