import { useEffect } from "react";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@soda/ui";
import { BookmarkIcon, ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { log, n, openExternal, type Card as FeedCard } from "../lib/bridge";
import { logEvent, useExposure } from "../lib/exposure";
import { requestTranslate, useApp, useDbg } from "../lib/store";
import { BoxRow, LangDot } from "./gh";

const HIDE_REASONS: [string, string][] = [
  ["too_old", "太老 / 不活跃"],
  ["wrong_lang", "不是我要的语言"],
  ["promo", "看着像营销号"],
  ["known", "我已经知道了"],
];

export type RepoCardProps = {
  card: FeedCard;
  index: number;
  onOpen: (id: number) => void;
  onHide: (id: number, reason: string, label: string) => void;
  onSaved: (id: number, learned: string[]) => void;
};

/**
 * 一条候选 = Box 里的一行，不是浮在网格里的卡片。
 * 曝光判定挂在这一行上（可见 ≥50% 且停留 ≥1s 才记）。
 */
export function RepoRow({ card, index, onOpen, onHide, onSaved }: RepoCardProps) {
  const { translated } = useApp();
  const dbg = useDbg();
  const ref = useExposure({ id: card.id, slot: index, channel: card.channel });

  const desc = card.description ?? "";
  useEffect(() => {
    if (desc) requestTranslate([desc]);
  }, [desc]);
  const zh = desc ? translated.get(desc) : undefined;
  const peak = card.weeks.length ? Math.max(...card.weeks) : null;

  return (
    <BoxRow ref={ref} className="flex flex-col gap-2xs">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-xs">
          <Button
            variant="link"
            size="xs"
            className="h-auto max-w-full p-0 text-lead font-semibold"
            onClick={() => onOpen(card.id)}
          >
            <span className="truncate">{card.full_name}</span>
          </Button>
          {card.channel === "profile" ? <Badge>画像</Badge> : null}
          {card.window === "explore" ? <Badge variant="secondary">探索</Badge> : null}
          {card.spam ? <Badge variant="destructive">降权</Badge> : null}
          {card.slope == null ? <Badge variant="destructive">斜率未知</Badge> : null}
          {card.seen ? <Badge variant="outline">看过了</Badge> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2xs">
          <Button
            size="xs"
            variant={card.saved ? "outline" : "default"}
            className={card.saved ? "" : "gh-go"}
            onClick={() => {
              void logEvent("star_in_app", card.id)
                .then((r) => onSaved(card.id, r.learned ?? []))
                .catch(() => {});
            }}
          >
            <BookmarkIcon data-icon="inline-start" />
            {card.saved ? "已收藏" : "收藏"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="xs" variant="outline" />}>
              <EyeOffIcon data-icon="inline-start" />
              不感兴趣
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>选一个理由，只影响这一条</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {HIDE_REASONS.map(([reason, label]) => (
                <DropdownMenuItem key={reason} onClick={() => onHide(card.id, reason, label)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="max-w-prose text-body">
        {desc ? (
          <>
            {zh ?? desc}
            {zh ? <span className="ms-xs text-caption text-muted-foreground">原文：{desc}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">（无简介）</span>
        )}
      </p>

      {card.topics.length ? (
        <div className="flex flex-wrap gap-2xs">
          {card.topics.slice(0, 5).map((t) => (
            <Badge key={t} variant="outline">
              {t}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-md text-caption text-muted-foreground tabular-nums">
        {card.language ? <LangDot name={card.language} /> : null}
        <span>★ {card.stars.toLocaleString()}</span>
        <span>⑂ {card.forks}</span>
        <span>{card.subscribers} 关注</span>
        <span>{card.open_issues} issue</span>
        <span>日均 {n(card.slope)}</span>
        {peak != null ? <span>周峰值 +{peak.toLocaleString()}</span> : null}
        <span>出生 {card.age_days} 天</span>
        {dbg ? <span>score {card.score.toFixed(3)}</span> : null}
        <button
          className="underline"
          onClick={() => {
            void logEvent("open_in_browser", card.id, card.url).catch(() => {});
            openExternal(card.url).catch((e) => log("open FAIL " + e));
          }}
        >
          浏览器打开
        </button>
        {/* clone 是三个强正样本之一（手册 9.1），行式卡片再瘦也不能把它省掉 */}
        <button
          className="underline"
          onClick={() => {
            const cmd = `git clone ${card.url}.git`;
            void logEvent("copy_clone", card.id, cmd).catch(() => {});
            navigator.clipboard.writeText(cmd).catch(() => {});
            log("clone copied");
          }}
        >
          clone
        </button>
      </div>

      {card.why.length ? (
        <p className="max-w-prose text-caption text-muted-foreground">{card.why.join(" · ")}</p>
      ) : null}
    </BoxRow>
  );
}
