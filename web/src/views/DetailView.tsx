import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Skeleton } from "@soda/ui";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { ChevronLeftIcon } from "lucide-react";
import {
  call,
  log,
  n,
  openExternal,
  type Detail,
} from "../lib/bridge";
import { logEvent } from "../lib/exposure";
import { requestTranslate, setDbg, useApp, useDbg } from "../lib/store";
import { Box, BoxEmpty, BoxRow, LangDot } from "../components/gh";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@soda/ui";

const chartConfig = { stars: { label: "这一周新增 star", color: "var(--primary)" } };

/** 第三方 HTML 的兜底清洗：脚本与内联事件一律去掉，外链强制新窗口 */
function sanitize(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<a /gi, '<a target="_blank" rel="noreferrer" ');
}

export type DetailViewProps = {
  repoId: number;
  onBack: () => void;
  onNotice: (msg: string) => void;
};

/** 照 GitHub 仓库页的形状：标题行 + 左主栏（README）+ 右侧栏（关于 / 语言 / 发布）。 */
export function DetailView({ repoId, onBack, onNotice }: DetailViewProps) {
  const { translated } = useApp();
  const dbg = useDbg();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const rdRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    call<Detail>("get_detail", { repoId })
      .then((r) => {
        if (!alive) return;
        if (r.error) {
          setErr(r.error);
          return;
        }
        setD(r);
        log(`detail open id=${repoId} readme=${String(r.readme_html || "").length}B`);
      })
      .catch((e) => {
        setErr(String(e));
        log("detail FAIL " + e);
      });
    return () => {
      alive = false;
    };
  }, [repoId]);

  const desc = d?.description ?? "";
  useEffect(() => {
    if (desc) requestTranslate([desc]);
  }, [desc]);

  // 停留计时：每 5s 落一条 dwell，附带阅读深度；离开时补最后一段
  useEffect(() => {
    if (!d?.id) return;
    const id = d.id;
    let start = Date.now();
    const tick = window.setInterval(() => {
      const ms = Date.now() - start;
      start = Date.now();
      if (ms < 1000) return;
      void logEvent("dwell", id, JSON.stringify({ ms, readDepth: depth(rdRef.current) })).catch(() => {});
    }, 5000);
    return () => {
      window.clearInterval(tick);
      const ms = Date.now() - start;
      if (ms >= 1000) {
        void call("log_event", {
          kind: "dwell",
          repoId: id,
          payload: JSON.stringify({ ms, readDepth: depth(rdRef.current) }),
        }).catch(() => {});
        log(`dwell final ${id} ${ms}ms`);
      }
    };
  }, [d]);

  // 图片诊断：外部猜不如让页面自己报，但图还在飞的时候读没意义，所以等 4s 读落定结果
  useEffect(() => {
    if (!d?.readme_html) return;
    const t = window.setTimeout(() => {
      const imgs = [...(rdRef.current?.querySelectorAll("img") ?? [])];
      if (!imgs.length) {
        log("imgdiag: README 里没有 img");
        return;
      }
      const rows = imgs.map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 }));
      const local = rows.filter((r) => r.src.includes("tauri.localhost")).length;
      log(`imgdiag settled total=${imgs.length} ok=${rows.filter((r) => r.ok).length} 指向本站=${local}`);
      const bad = rows.filter((r) => !r.ok).slice(0, 3).map((r) => r.src.slice(0, 70));
      if (bad.length) log("imgdiag 未出图样本: " + bad.join(" , "));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [d]);

  const curve = useMemo(() => {
    const w = [...(d?.weeks ?? [])].reverse();
    return w.map((v, i) => ({ w: i === w.length - 1 ? "本周" : `${w.length - 1 - i} 周前`, stars: v }));
  }, [d]);

  if (err) {
    return (
      <div className="flex flex-col gap-md p-md">
        <BackLine onBack={onBack} title="详情打不开" />
        <Box>
          <BoxEmpty>{err}</BoxEmpty>
        </Box>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="flex flex-col gap-md p-md">
        <BackLine onBack={onBack} title="载入中…" />
        <Box>
          {[0, 1, 2].map((i) => (
            <BoxRow key={i}>
              <Skeleton className="h-4 w-2/3" />
            </BoxRow>
          ))}
        </Box>
      </div>
    );
  }

  const url = d.url ?? "";
  const releases = String(d.releases || "").split("\n").filter(Boolean).map((r) => r.split("|"));

  return (
    <div className="flex flex-col gap-md p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm border-b pb-sm">
        <div className="flex min-w-0 items-center gap-xs">
          <Button size="xs" variant="ghost" onClick={onBack}>
            <ChevronLeftIcon data-icon="inline-start" />
            返回
          </Button>
          <h1 className="truncate text-title">{d.full_name}</h1>
          <Badge variant="outline">{d.window}</Badge>
          {dbg ? <Badge variant="secondary">调试开</Badge> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2xs">
          <Button
            size="xs"
            variant={d.saved ? "outline" : "default"}
            className={d.saved ? "" : "gh-go"}
            onClick={() => {
              void logEvent("star_in_app", d.id!)
                .then((r) =>
                  onNotice(r.learned?.length ? `已把 ${r.learned.join("、")} 加进兴趣画像` : "已收藏")
                )
                .catch(() => {});
            }}
          >
            {d.saved ? "已收藏" : "收藏"}
            <span className="ms-2xs tabular-nums">{(d.stars ?? 0).toLocaleString()}</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void call<string>("open_in_app_window", { url, repoId: d.id })
                .then((m) => {
                  onNotice(m);
                  log("webview " + m);
                })
                .catch((e) => log("webview FAIL " + e));
            }}
          >
            应用内浏览 GitHub
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void logEvent("open_in_browser", d.id!, url).catch(() => {});
              openExternal(url).catch((e) => log("open FAIL " + e));
            }}
          >
            在 GitHub 打开
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              const cmd = `git clone ${url}.git`;
              void logEvent("copy_clone", d.id!, cmd).catch(() => {});
              navigator.clipboard.writeText(cmd).catch(() => {});
              onNotice("已复制 clone 命令");
            }}
          >
            clone
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void logEvent("hide", d.id!, "known")
                .then(() => {
                  onNotice("已记为不感兴趣，返回列表后它不会再出现");
                  onBack();
                })
                .catch(() => {});
            }}
          >
            不感兴趣
          </Button>
          <Button size="xs" variant={dbg ? "default" : "ghost"} onClick={() => setDbg(!dbg)}>
            调试
          </Button>
        </div>
      </div>

      <div className="grid gap-md lg:grid-cols-[minmax(0,1fr)_320px]">
        <Box
          title="README"
          aside={<span>{String(d.readme_html || "").length} 字节 · 官方 API 渲染的 HTML</span>}
        >
          <div
            ref={rdRef}
            className="md px-md py-md"
            onClick={(e) => {
              // README 里的链接是第三方 HTML，target=_blank 在 Tauri 里会被吞掉
              const a = (e.target as HTMLElement).closest?.("a");
              if (!a) return;
              e.preventDefault();
              openExternal(a.getAttribute("href") ?? "").catch((err) => onNotice("没打开这个链接：" + String(err)));
            }}
            dangerouslySetInnerHTML={{
              __html: d.readme_html ? sanitize(d.readme_html) : "<i>取不到 README</i>",
            }}
          />
        </Box>

        <div className="flex min-w-0 flex-col gap-md">
          <Box title="关于">
            <div className="flex flex-col gap-xs px-md py-md">
              <p className="text-body">
                {translated.get(desc) ?? desc ?? "（无简介）"}
                {translated.get(desc) ? (
                  <span className="mt-2xs block text-caption text-muted-foreground">原文：{desc}</span>
                ) : null}
              </p>
              <div className="flex flex-col gap-2xs text-caption tabular-nums">
                <span>★ {(d.stars ?? 0).toLocaleString()} · ⑂ {d.forks ?? 0} · {d.subscribers ?? 0} 关注 · {d.open_issues ?? 0} issue</span>
                <span className="text-muted-foreground">
                  出生 {d.age_days} 天 · 日均 {n(d.slope)} · 曲率{" "}
                  {d.curvature == null ? "数据不足" : d.curvature.toFixed(2)}
                </span>
              </div>
            </div>
          </Box>

          {curve.length ? (
            <Box title="star 增长曲线" aside={<span>按周 · 一次请求拿全</span>}>
              <div className="px-md py-md">
                <ChartContainer config={chartConfig} className="h-32 w-full">
                  <BarChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="w" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} width={38} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="stars" fill="var(--color-stars)" radius={3} />
                  </BarChart>
                </ChartContainer>
              </div>
            </Box>
          ) : null}

          <Box title="语言构成">
            {d.langs?.length ? (
              d.langs.map((l) => (
                <BoxRow key={l} className="flex items-center justify-between gap-sm py-sm">
                  <LangDot name={l.split(" ")[0]} />
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {l.split(" ").slice(1).join(" ")}
                  </span>
                </BoxRow>
              ))
            ) : (
              <BoxEmpty>没有语言数据（未取到或全为空）</BoxEmpty>
            )}
          </Box>

          <Box title="最近 release">
            {releases.length ? (
              releases.map((r, i) => (
                <BoxRow key={i} className="flex flex-col gap-2xs py-sm">
                  <span className="flex items-center gap-xs">
                    <b className="text-label">{r[0]}</b>
                    <Badge variant="outline">{r[2]}</Badge>
                  </span>
                  <span className="text-caption text-muted-foreground">{r[1]}</span>
                </BoxRow>
              ))
            ) : (
              <BoxEmpty>没有 release，或取不到</BoxEmpty>
            )}
          </Box>
        </div>
      </div>
    </div>
  );
}

function BackLine({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-xs border-b pb-sm">
      <Button size="xs" variant="ghost" onClick={onBack}>
        <ChevronLeftIcon data-icon="inline-start" />
        返回
      </Button>
      <h1 className="text-title">{title}</h1>
    </div>
  );
}

function depth(el: HTMLDivElement | null): number {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const h = r.bottom - r.top;
  if (h <= 0) return 0;
  return Math.min(1, Math.max(0, (innerHeight - Math.max(0, r.top)) / h));
}
