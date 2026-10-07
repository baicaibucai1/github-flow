import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@soda/ui";
import { call, LIMIT, log, type Card } from "../lib/bridge";
import { RepoCard } from "../components/RepoCard";
import { Box, BoxEmpty, MoreRow } from "../components/gh";

export type FeedViewProps = {
  channel: string;
  onOpen: (id: number) => void;
  onNotice: (msg: string) => void;
};

const EMPTY_TEXT: Record<string, { title: string; desc: string }> = {
  saved: { title: "还没有收藏", desc: "发现页点「收藏」就进这里。" },
  explore: {
    title: "探索池是空的",
    desc: "点「采集新数据」或「取一批新生项目」，它会去拉最近 7/30/90 天出生、已有苗头的项目。",
  },
  profile: {
    title: "画像通道还没有内容",
    desc: "先登录再点「用我自己的口味建画像」，词表建好后这一栏才会按你的口味抓取。",
  },
  all: { title: "搜索没有带回候选", desc: "换个词试试 —— 搜索词本身会进你的兴趣画像。" },
  hot: { title: "热度榜是空的", desc: "点「采集新数据」跑一轮，约 60~90 次请求。" },
};

/** 一屏 = 双列卡片网格，一张卡一个候选；分页还是"显示更多"，不做无限滚（无限滚会把曝光判定和"看到第几屏"都冲掉）。 */
export function FeedView({ channel, onOpen, onNotice }: FeedViewProps) {
  const [items, setItems] = useState<Card[]>([]);
  const [offset, setOffset] = useState(0);
  const [phase, setPhase] = useState<"idle" | "loading" | "more" | "done">("loading");

  const fetchPage = useCallback(
    async (from: number) => {
      setPhase(from === 0 ? "loading" : "more");
      try {
        const list = await call<Card[]>("get_channel", { channel, limit: LIMIT, offset: from });
        setItems((prev) => (from === 0 ? list : [...prev, ...list]));
        setOffset(from + list.length);
        setPhase(list.length < LIMIT ? "done" : "idle");
        log(`channel=${channel} got=${list.length} offset=${from}`);
      } catch (e) {
        setPhase("done");
        onNotice("取不到：" + String(e));
      }
    },
    [channel, onNotice]
  );

  useEffect(() => {
    setItems([]);
    setOffset(0);
    void fetchPage(0);
  }, [channel, fetchPage]);

  if (phase === "loading") {
    // 骨架跟着版式走：卡片就是卡片的样子，别给人"先列表后跳成网格"的错位
    return (
      <div className="@container grid gap-md p-md @lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-md border bg-card">
            <Skeleton className="h-44 w-full rounded-none" />
            <div className="flex flex-col gap-xs p-md">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    const t = EMPTY_TEXT[channel] ?? EMPTY_TEXT.hot;
    return (
      <div className="p-md">
        <Box title={t.title}>
          <BoxEmpty>
            {t.desc}
            <div className="mt-sm">
              <MoreRow label="重新读取" onClick={() => void fetchPage(0)} />
            </div>
          </BoxEmpty>
        </Box>
      </div>
    );
  }

  return (
    <div className="@container flex flex-col gap-md p-md">
      {/* 双列卡片网格（他 2026-10-07 选的版式）。用容器查询而不是视口断点：
          决定一屏摆几张卡的是主区宽度，不是浏览器窗口宽度——侧栏收放、窗口分屏都该跟着变，
          而且这样渲染探针能在固定宽度下真的数出"两列"，而不是撞运气看视口多宽。
          排序说明从 Box 表头挪到这里，因为卡片流没有"表头"这个东西了。 */}
      <div className="flex flex-wrap items-baseline justify-between gap-xs">
        <h1 className="text-heading tabular-nums">{items.length} 个候选</h1>
        <span className="text-caption text-muted-foreground">
          通道 {channel} · 排序是线性打分（斜率 0.6 + 曲率 0.2 + 新鲜度 0.15 + 活跃 0.05），规则层做乘性降权
        </span>
      </div>

      <div className="grid gap-md @lg:grid-cols-2">
        {items.map((c, i) => (
          <RepoCard
            key={c.id}
            card={c}
            index={i}
            onOpen={onOpen}
            onHide={(id, reason, label) => {
              void call("log_event", { kind: "hide", repoId: id, payload: reason })
                .then(() => {
                  setItems((prev) => prev.filter((x) => x.id !== id));
                  onNotice(`已记为不感兴趣（${label}）—— 它不会再出现在任何榜上`);
                })
                .catch((e) => log("hide FAIL " + e));
            }}
            onSaved={(id, learned) => {
              setItems((prev) => prev.map((x) => (x.id === id ? { ...x, saved: true } : x)));
              onNotice(
                learned.length
                  ? `已把 ${learned.join("、")} 加进兴趣画像 —— 下一轮抓取会找更多这类项目`
                  : "已收藏（这条没带可提取的词，画像不变）"
              );
            }}
          />
        ))}
      </div>

      <div className="flex justify-center pt-2xs">
        <Button
          variant="outline"
          disabled={phase === "more"}
          onClick={() => void fetchPage(phase === "done" ? 0 : offset)}
        >
          {phase === "done" ? "已到底 —— 重新读取" : `显示更多（已显示 ${items.length}）`}
        </Button>
      </div>
    </div>
  );
}
