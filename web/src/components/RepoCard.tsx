import { useEffect, useState } from "react";
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@soda/ui";
import { BookmarkIcon, ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { cn } from "cn";
import { log, n, openExternal, type Card as FeedCard } from "../lib/bridge";
import { logEvent, useExposure } from "../lib/exposure";
import { requestTranslate, useApp, useDbg } from "../lib/store";
import { LangDot } from "./gh";

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
 * 一条候选 = 一张卡：上面 GitHub 自己的 OG 预览图，下面名称 / 中文简介 / 语言 / 增速 / 推荐理由。
 *
 * ⚠️ 版式（他 2026-10-07："主页应该是信息流的卡片式，像小红书那样，而且应该直接点击卡片就可以进入"）。
 * 之前是 Box 里一行一条的连续流（候选 A 那版定下来的样子），现在发现页是双列卡片网格。
 * 卡图走 `https://opengraph.githubassets.com/1/{owner}/{repo}`：GitHub 自家的域名、不占 api.github.com 的额度，
 * 图里已经画好仓库名 / 语言 / star —— 仓库本来就没有缩略图，这是唯一像样的视觉锚。
 * 手册里"翻译是唯一离开本机的例外"按这个口径收窄：第三方服务只有翻译，GitHub 自家域名的图由 webview 直取。
 *
 * 曝光判定挂在整张卡上（可见 ≥50% 且停留 ≥1s 才算一次），点卡片的哪儿都算打开，除了卡里的真控件。
 */

/**
 * GitHub 的 OG 卡图。三件事都是他 2026-10-07 看着截图点的：
 * ① 默认居中裁会把头像切一半 —— 改成对齐**顶部**（OG 图里头像在上半部，下半那条 star/fork 我们自己写着）；
 * ② 取不到图不要留一句灰字，换成 GitHub 自己的标（octicon mark-github，路径是从 @primer/octicons 取的原件，不自己画）；
 * ③ 图在路上的时候右下角挂一个加载标志：githubassets 会限流（实测第二发 429），不标出来看着就像"这仓库没图"。
 */
function OgCover({ fullName }: { fullName: string }) {
  const [state, setState] = useState<"load" | "ok" | "bad">("load");
  return (
    <div data-og="" className="relative h-44 w-full shrink-0 overflow-hidden border-b bg-secondary">
      {state !== "bad" ? (
        <img
          src={`https://opengraph.githubassets.com/1/${fullName}`}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("bad")}
          className={cn(
            "absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300",
            state === "ok" ? "opacity-100" : "opacity-0"
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center" title="这张预览图没取到">
          {/* octicon mark-github 16px，路径原样取自 @primer/octicons */}
          <svg viewBox="0 0 16 16" className="size-12 fill-current text-muted-foreground/55" aria-label="GitHub">
            <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
          </svg>
        </div>
      )}
      {state === "load" ? (
        <span
          data-og-load=""
          aria-label="预览图加载中"
          className="absolute bottom-xs right-xs flex items-center justify-center rounded-sm border bg-background/85 p-1"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/35 border-t-current" />
        </span>
      ) : null}
    </div>
  );
}

export function RepoCard({ card, index, onOpen, onHide, onSaved }: RepoCardProps) {
  const { translated } = useApp();
  const dbg = useDbg();
  const ref = useExposure({ id: card.id, slot: index, channel: card.channel });

  const desc = card.description ?? "";
  useEffect(() => {
    if (desc) requestTranslate([desc]);
  }, [desc]);
  const zh = desc ? translated.get(desc) : undefined;
  const peak = card.weeks.length ? Math.max(...card.weeks) : null;

  /**
   * 整张卡可点（他 2026-10-07："应该是直接点击卡片就可以进入"）。
   * 之前只有标题那个 link 按钮能点，简介、图、语言、曲线、理由那一整片都是死的 ——
   * 信息流的肌肉记忆是"点条目就进去"，要人先命中一行里的一个小按钮是我们自己的锅。
   * 但卡里还有收藏 / 不感兴趣 / 浏览器打开 / clone 这些真控件：点在它们身上不该顺带把详情页打开，
   * 所以只认落在非交互元素上的点击。键盘走标题那个按钮（它本来就是 link 语义）。
   */
  const cardClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button,a,[role=menuitem],[role=menu],[data-no-open]")) return;
    onOpen(card.id);
  };

  return (
    <article
      ref={ref}
      onClick={cardClick}
      className="flex cursor-pointer flex-col overflow-hidden rounded-md border bg-card transition-shadow hover:border-primary/50 hover:shadow-md"
    >
      <OgCover fullName={card.full_name} />
      <div className="flex flex-col gap-2xs p-md">
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
        <p className="text-caption text-muted-foreground">{card.why.join(" · ")}</p>
      ) : null}
      </div>
    </article>
  );
}
