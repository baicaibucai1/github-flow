import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Separator,
} from "@soda/ui";
import { PageHeader } from "@soda/patterns";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  MonitorIcon,
  StarIcon,
} from "lucide-react";
import { call, log, n, type Detail } from "../lib/bridge";
import { logEvent } from "../lib/exposure";
import { requestTranslate, setDbg, useApp, useDbg } from "../lib/store";

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
  }, [desc, requestTranslate]);

  // 停留计时：每 5s 落一条 dwell，附带阅读深度。退出时补最后一段。
  useEffect(() => {
    if (!d?.id) return;
    const id = d.id;
    let start = Date.now();
    const tick = window.setInterval(() => {
      const ms = Date.now() - start;
      start = Date.now();
      if (ms < 1000) return;
      void logEvent("dwell", id, JSON.stringify({ ms, readDepth: depth(rdRef.current) })).catch(
        () => {}
      );
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

  // 图片诊断：外部猜不如让页面自己报。图还在飞的时候读状态没意义，所以等 4s 读落定结果
  useEffect(() => {
    if (!d?.readme_html) return;
    const t = window.setTimeout(() => {
      const imgs = [...(rdRef.current?.querySelectorAll("img") ?? [])];
      if (!imgs.length) {
        log("imgdiag: README 里没有 img");
        return;
      }
      const rows = imgs.map((i) => ({
        src: i.currentSrc || i.src,
        ok: i.complete && i.naturalWidth > 0,
      }));
      const local = rows.filter((r) => r.src.includes("tauri.localhost")).length;
      log(
        `imgdiag settled total=${imgs.length} ok=${rows.filter((r) => r.ok).length} 指向本站=${local}`
      );
      const bad = rows.filter((r) => !r.ok).slice(0, 3).map((r) => r.src.slice(0, 70));
      if (bad.length) log("imgdiag 未出图样本: " + bad.join(" , "));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [d]);

  const data = useMemo(() => {
    const w = [...(d?.weeks ?? [])].reverse(); // SQL 给的是新→旧，画图要旧→新
    return w.map((v, i) => ({
      w: i === w.length - 1 ? "本周" : `${w.length - 1 - i} 周前`,
      stars: v,
    }));
  }, [d]);

  if (err) {
    return (
      <div className="flex flex-col gap-md p-md">
        <PageHeader title="详情打不开" onBack={onBack} backLabel="返回列表" />
        <p className="text-body text-destructive">{err}</p>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="p-md text-body text-muted-foreground">
        载入中… <Button size="xs" variant="ghost" onClick={onBack}>返回</Button>
      </div>
    );
  }

  const releases = String(d.releases || "")
    .split("\n")
    .filter(Boolean)
    .map((r) => r.split("|"));
  const url = d.url ?? "";

  return (
    <div className="flex flex-col gap-md p-md">
      <PageHeader
        title={d.full_name}
        description={`${d.language ?? "语言未知"} · ${d.window ?? ""} · 出生 ${d.age_days} 天`}
        onBack={onBack}
        backLabel="返回列表"
        actions={
          <>
            <Button
              size="sm"
              variant={d.saved ? "secondary" : "default"}
              onClick={() => {
                void logEvent("star_in_app", d.id!)
                  .then((r) =>
                    onNotice(
                      r.learned?.length
                        ? `已把 ${r.learned.join("、")} 加进兴趣画像`
                        : "已收藏（这条没带可提取的词，画像不变）"
                    )
                  )
                  .catch(() => {});
              }}
            >
              <StarIcon data-icon="inline-start" />
              {d.saved ? "已收藏" : "收藏"}
            </Button>
            <Button
              size="sm"
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
              <MonitorIcon data-icon="inline-start" />
              应用内浏览 GitHub
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void logEvent("open", d.id!).catch(() => {});
                window.open(url, "_blank");
              }}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              系统浏览器
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const cmd = `git clone ${url}.git`;
                void logEvent("copy_clone", d.id!, cmd).catch(() => {});
                navigator.clipboard.writeText(cmd).catch(() => {});
                onNotice("已复制 clone 命令");
              }}
            >
              <ClipboardCopyIcon data-icon="inline-start" />
              clone
            </Button>
            <Button
              size="sm"
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
              <EyeOffIcon data-icon="inline-start" />
              不感兴趣
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-xs text-caption tabular-nums">
        <Badge variant="outline">
          <b className="font-medium">{(d.stars ?? 0).toLocaleString()}</b> star
        </Badge>
        <Badge variant="outline">{d.forks ?? 0} fork</Badge>
        <Badge variant="outline">{d.subscribers ?? 0} watch</Badge>
        <Badge variant="outline">{d.open_issues ?? 0} issue</Badge>
        <Badge variant="secondary">日均 {n(d.slope)}</Badge>
        <Badge variant="secondary">
          曲率 {d.curvature == null ? "数据不足" : d.curvature.toFixed(2)}
        </Badge>
        <Button size="xs" variant={dbg ? "default" : "ghost"} onClick={() => setDbg(!dbg)}>
          调试
        </Button>
      </div>

      <p className="max-w-prose text-body">
        {translated.get(desc) ?? desc ?? "（无简介）"}
        {translated.get(desc) ? (
          <span className="mt-2xs block text-caption text-muted-foreground">原文：{desc}</span>
        ) : null}
      </p>

      <div className="grid gap-lg lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-lg">
          {data.length ? (
            <section className="flex flex-col gap-sm">
              <h2 className="text-heading">star 增长曲线（按周）</h2>
              <Separator />
              <ChartContainer config={chartConfig} className="h-40 w-full">
                <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis dataKey="w" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} width={38} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="stars" fill="var(--color-stars)" radius={3} />
                </BarChart>
              </ChartContainer>
            </section>
          ) : null}

          <section className="flex min-w-0 flex-col gap-sm">
            <h2 className="text-heading">README</h2>
            <Separator />
            <div
              ref={rdRef}
              className="md"
              dangerouslySetInnerHTML={{
                __html: d.readme_html
                  ? sanitize(d.readme_html)
                  : "<i>取不到 README</i>",
              }}
            />
          </section>
        </div>

        <div className="flex flex-col gap-md">
          <Card className="gap-0 py-0">
            <CardContent className="flex flex-col gap-sm py-md">
              <dl className="grid grid-cols-[auto_1fr] gap-xs text-label">
                <dt className="text-muted-foreground">语言构成</dt>
                <dd>{d.langs?.length ? d.langs.join(" · ") : "—"}</dd>
              </dl>
              <Separator />
              <div className="flex flex-col gap-xs">
                <span className="text-muted-foreground text-label">最近 release</span>
                {releases.length ? (
                  <ul className="flex flex-col gap-xs">
                    {releases.map((r, i) => (
                      <li key={i} className="flex flex-col gap-2xs text-caption">
                        <span className="flex items-center gap-2xs">
                          <b className="font-medium">{r[0]}</b>
                          <Badge variant="secondary">{r[2]}</Badge>
                        </span>
                        <span className="text-muted-foreground">{r[1]}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-caption text-muted-foreground">
                    没有 release，或取不到
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
