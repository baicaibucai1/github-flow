import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@soda/ui";
import { EmptyPage } from "@soda/patterns";
import { InboxIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { call, LIMIT, log, type Card } from "../lib/bridge";
import { RepoCard } from "../components/RepoCard";

export type FeedViewProps = {
  channel: string;
  onOpen: (id: number) => void;
  onNotice: (msg: string) => void;
};

const EMPTY_TEXT: Record<string, { title: string; desc: string }> = {
  saved: { title: "还没有收藏", desc: "发现页点「收藏」就进这里。" },
  explore: {
    title: "探索池是空的",
    desc: "点上方「取一批新生项目」或「采集新数据」，它会去拉最近 7/30/90 天出生、已有苗头的项目。",
  },
  profile: {
    title: "画像通道还没有内容",
    desc: "先登录并点「用我自己的口味建画像」，画像词表建好后这一栏才会按你的口味抓取。",
  },
  hot: { title: "热度榜是空的", desc: "点上方「采集新数据」跑一轮，约 60~90 次请求。" },
};

export function FeedView({ channel, onOpen, onNotice }: FeedViewProps) {
  const [items, setItems] = useState<Card[]>([]);
  const [offset, setOffset] = useState(0);
  const [phase, setPhase] = useState<"idle" | "loading" | "more" | "done">("loading");

  const fetchPage = useCallback(
    async (from: number) => {
      setPhase(from === 0 ? "loading" : "more");
      try {
        const list = await call<Card[]>("get_channel", {
          channel,
          limit: LIMIT,
          offset: from,
        });
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
    return (
      <div className="grid items-start gap-md p-md sm:grid-cols-2 2xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col gap-sm rounded-xl border p-md">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    const t = EMPTY_TEXT[channel] ?? EMPTY_TEXT.hot;
    return (
      <div className="p-lg">
        <EmptyPage
          icon={<InboxIcon />}
          title={t.title}
          description={t.desc}
          action={
            <Button size="sm" onClick={() => void fetchPage(0)}>
              重新读取
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md p-md">
      <div className="grid items-start gap-md sm:grid-cols-2 2xl:grid-cols-3">
        {items.map((c, i) => (
          <RepoCard
            key={c.id}
            card={c}
            index={i}
            hero={i === 0}
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
              setItems((prev) =>
                prev.map((x) => (x.id === id ? { ...x, saved: true } : x))
              );
              onNotice(
                learned.length
                  ? `已把 ${learned.join("、")} 加进兴趣画像 —— 下一轮抓取会找更多这类项目`
                  : "已收藏（这条没带可提取的词，画像不变）"
              );
            }}
          />
        ))}
      </div>

      {phase === "done" ? (
        <div className="flex items-center justify-center gap-xs text-caption text-muted-foreground">
          {items.length >= LIMIT ? (
            <span>这一页到底了 —— 候选池里已经没有更多「{channel}」内容</span>
          ) : (
            <span>共 {items.length} 条</span>
          )}
          <Button size="xs" variant="outline" onClick={() => void fetchPage(0)}>
            重新读取
          </Button>
        </div>
      ) : (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            disabled={phase === "more"}
            onClick={() => void fetchPage(offset)}
          >
            {phase === "more" ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            加载更多（已显示 {items.length}）
          </Button>
        </div>
      )}
    </div>
  );
}
