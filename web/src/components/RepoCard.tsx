import { useEffect } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@soda/ui";
import {
  BookmarkIcon,
  ChevronDownIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  EyeOffIcon,
} from "lucide-react";
import { cn } from "cn";
import { log, n, openExternal, type Card as FeedCard } from "../lib/bridge";
import { logEvent, useExposure } from "../lib/exposure";
import { requestTranslate, useApp, useDbg } from "../lib/store";

const HIDE_REASONS: [string, string][] = [
  ["too_old", "太老 / 不活跃"],
  ["wrong_lang", "不是我要的语言"],
  ["promo", "看着像营销号"],
  ["known", "我已经知道了"],
];

export type RepoCardProps = {
  card: FeedCard;
  index: number;
  hero?: boolean;
  onOpen: (id: number) => void;
  onHide: (id: number, reason: string, label: string) => void;
  onSaved: (id: number, learned: string[]) => void;
};

/** 一张卡片 = 一个候选项目。曝光判定挂在外层 div 上，卡片本身保持组件箱原样。 */
export function RepoCard({ card, index, hero, onOpen, onHide, onSaved }: RepoCardProps) {
  const { translated } = useApp();
  const dbg = useDbg();
  const ref = useExposure({ id: card.id, slot: index, channel: card.channel });

  const desc = card.description ?? "";
  useEffect(() => {
    if (desc) requestTranslate([desc]);
  }, [desc, requestTranslate]);
  const zh = desc ? translated.get(desc) : undefined;

  return (
    <div ref={ref} className={cn("min-w-0", hero && "sm:col-span-2 2xl:col-span-3")}>
      <Card className="h-full items-stretch gap-0 py-0">
        <CardHeader className="gap-2xs py-sm">
          <CardTitle className={cn("truncate", hero ? "text-heading" : "text-lead")}>
            <Button
              variant="link"
              size="xs"
              className="h-auto max-w-full justify-start p-0"
              onClick={() => onOpen(card.id)}
            >
              <span className="truncate">{card.full_name}</span>
            </Button>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2xs">
            {card.channel === "profile" ? <Badge>画像</Badge> : null}
            {card.window === "explore" ? <Badge variant="secondary">探索</Badge> : null}
            <Badge variant="outline">出生 {card.age_days} 天</Badge>
            {card.seen ? (
              <Badge variant="ghost">看过了</Badge>
            ) : (
              <Badge variant="outline">未看过</Badge>
            )}
            {card.spam ? <Badge variant="destructive">降权</Badge> : null}
            {card.slope == null ? <Badge variant="destructive">斜率未知</Badge> : null}
            {dbg ? <Badge variant="ghost">score {card.score.toFixed(3)}</Badge> : null}
          </div>
        </CardHeader>

        <CardContent className="flex min-w-0 flex-1 flex-col gap-xs py-sm">
          <p className="text-body">
            {desc ? (
              <>
                {zh ?? desc}
                {zh ? (
                  <span className="mt-2xs block text-caption text-muted-foreground">
                    原文：{desc}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">（无简介）</span>
            )}
          </p>

          {card.topics.length ? (
            <div className="flex flex-wrap gap-2xs">
              {card.topics.slice(0, 5).map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-xs text-caption tabular-nums">
            <Stat k="star" v={card.stars} />
            <Stat k="fork" v={card.forks} />
            <Stat k="watch" v={card.subscribers} />
            <Stat k="issue" v={card.open_issues} />
            <span className="text-muted-foreground">
              日均 <span className="font-medium text-foreground">{n(card.slope)}</span>
            </span>
            {card.weeks.length ? (
              <span className="text-muted-foreground">
                周峰值 <span className="font-medium text-foreground">
                  +{Math.max(...card.weeks).toLocaleString()}
                </span>{" "}
                · {card.weeks.length} 周
              </span>
            ) : null}
          </div>

          {card.why.length ? (
            <ul className="flex flex-col gap-2xs text-caption">
              {card.why.map((w, i) => (
                <li
                  key={i}
                  className={cn(
                    /降权|不成比例/.test(w)
                      ? "text-destructive"
                      : /不足|尚未/.test(w)
                        ? "text-muted-foreground/70"
                        : "text-muted-foreground"
                  )}
                >
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>

        <CardFooter className="flex-wrap gap-2xs border-t py-xs">
          <Button
            size="xs"
            variant={card.saved ? "secondary" : "default"}
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
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>选一个理由，只影响这一条</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {HIDE_REASONS.map(([reason, label]) => (
                <DropdownMenuItem
                  key={reason}
                  onClick={() => onHide(card.id, reason, label)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              // 跳出去是一种独立信号（手册 9.1）：它跟"在应用里点开"不是一回事，
              // 混成同一个 kind 就没法算"多少内容其实是在 GitHub 上看完的"
              void logEvent("open_in_browser", card.id, card.url).catch(() => {});
              openExternal(card.url).catch((e) => log("open FAIL " + e));
            }}
          >
            <ExternalLinkIcon data-icon="inline-start" />
            浏览器打开
          </Button>

          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              const cmd = `git clone ${card.url}.git`;
              void logEvent("copy_clone", card.id, cmd).catch(() => {});
              navigator.clipboard.writeText(cmd).catch(() => {});
            }}
          >
            <ClipboardCopyIcon data-icon="inline-start" />
            clone
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number }) {
  return (
    <span className="text-muted-foreground">
      <span className="font-medium text-foreground">{v.toLocaleString()}</span> {k}
    </span>
  );
}
