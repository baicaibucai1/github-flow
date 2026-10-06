import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, Badge, Button, Progress } from "@soda/ui";
import { SparklesIcon } from "lucide-react";
import { ago, call, log, openExternal, type GhProfile, type MeReport, type Repo } from "../lib/bridge";
import { notice, refreshAuth, reloadAll, useApp } from "../lib/store";
import { Box, BoxEmpty, BoxRow, Calendar, LangDot, isoDay } from "../components/gh";

const KIND_LABEL: Record<string, string> = {
  open: "在应用里点开",
  open_in_browser: "跳去浏览器",
  star_in_app: "收藏",
  copy_clone: "复制 clone",
  dwell: "停留（每 5 秒一条心跳）",
  hide: "不感兴趣",
  search: "搜索",
  webview_open: "应用内浏览",
  webview_close: "应用内浏览结束",
};

/** 「我的」= GitHub 主页的形状：左栏身份，右栏一节一节带表头的盒子。 */
export function MeView() {
  const { auth, stats } = useApp();
  const [gh, setGh] = useState<GhProfile | null>(null);
  const [ghErr, setGhErr] = useState("");
  const [me, setMe] = useState<MeReport | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    setGhErr("");
    void call<GhProfile>("my_profile")
      .then(setGh)
      .catch((e) => setGhErr(String(e)));
    void call<MeReport>("me_report")
      .then(setMe)
      .catch((e) => log("me_report FAIL " + e));
  }, []);

  useEffect(load, [load]);

  const act = (label: string, p: Promise<unknown>, done: string) => {
    setBusy(label);
    void p
      .then(() => Promise.all([refreshAuth(), reloadAll()]))
      .then(load)
      .then(() => notice(done))
      .catch((e) => notice(label + "失败：" + String(e)))
      .finally(() => setBusy(""));
  };

  const maxTerm = Math.max(0.001, ...(me?.terms.map((t) => t.weight) ?? [1]));
  const maxLang = Math.max(0.001, ...(me?.langs.map((l) => l.weight) ?? [1]));
  const live = me?.buckets.filter((b) => b.live).length ?? 0;

  return (
    <div className="p-md">
      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-6 lg:grid-cols-[296px_minmax(0,1fr)]">
        {/* ---------- 左栏：身份 ---------- */}
        <div className="flex min-w-0 flex-col gap-md">
          {gh ? (
            <>
              <img
                src={gh.avatar ?? ""}
                alt={gh.login}
                className="aspect-square w-full rounded-md border bg-secondary object-cover"
              />
              <div className="-mt-sm flex flex-col gap-2xs">
                <h1 className="text-title">{gh.name || gh.login}</h1>
                <p className="text-muted-foreground text-lead">{gh.login}</p>
                {gh.bio ? <p className="whitespace-pre-line text-body">{gh.bio}</p> : null}
                <Button
                  className="mt-xs w-full"
                  onClick={() => openExternal(gh.url ?? "https://github.com").catch((e) => notice(String(e)))}
                >
                  在 GitHub 打开
                </Button>
                <p className="mt-xs text-body text-muted-foreground">📍 {gh.location || "—"}</p>
                <p className="text-body text-muted-foreground">🕒 {isoDay(gh.created_at)} 加入</p>
                <p className="text-body text-muted-foreground">
                  <b className="text-foreground">{gh.following}</b> following ·{" "}
                  <b className="text-foreground">{gh.followers}</b> followers
                </p>
              </div>
            </>
          ) : (
            <Alert variant={ghErr ? "destructive" : "default"}>
              <AlertDescription>
                {ghErr ? `读不到 GitHub 上的资料：${ghErr}` : "正在读 GitHub 上的资料…"}
              </AlertDescription>
            </Alert>
          )}

          <Box title="身份与凭据">
            <BoxRow className="flex flex-col gap-xs py-sm">
              {auth?.authed ? (
                <>
                  <p className="flex flex-wrap items-center gap-2xs text-label">
                    @{auth.login}
                    <Badge variant="outline">{auth.mode === "pat" ? "粘贴的 token" : "设备码"}</Badge>
                    {auth.invalid ? <Badge variant="destructive">已失效</Badge> : null}
                    {auth.missing_scope?.length ? (
                      <Badge variant="destructive">缺 {auth.missing_scope.join("、")}</Badge>
                    ) : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    core {auth.core?.remaining ?? "?"}/{auth.core?.limit ?? "?"} · search{" "}
                    {auth.search?.remaining ?? "?"}/{auth.search?.limit ?? "?"}
                    {auth.core?.resets_at
                      ? ` · 约 ${Math.max(0, Math.round((auth.core.resets_at * 1000 - Date.now()) / 60000))} 分钟后重置`
                      : ""}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    scope：{auth.scopes || "GitHub 没回报"}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    凭据只写在本机 <code>{auth.cred_file}</code>，不进数据库。
                  </p>
                </>
              ) : (
                <p className="text-caption text-muted-foreground">
                  本机没有凭据，现在是匿名态：core {auth?.core?.remaining ?? "?"}/
                  {auth?.core?.limit ?? "60"} 次/小时。「画像」要读你自己的收藏，所以是空的。
                </p>
              )}
              <div className="mt-xs flex flex-wrap gap-2xs">
                <Button
                  size="xs"
                  className="gh-go"
                  disabled={!!busy}
                  onClick={() =>
                    act("建画像", call<string>("build_my_profile", { pages: 5 }), "画像已重建")
                  }
                >
                  <SparklesIcon data-icon="inline-start" />
                  {busy === "建画像" ? "建画像中…" : "重建画像"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => act("校准", call<string>("calibrate_now"), "已重新校准")}
                >
                  {busy === "校准" ? "校准中…" : "重新校准"}
                </Button>
                <Button size="xs" variant="ghost" onClick={load}>
                  刷新
                </Button>
              </div>
            </BoxRow>
          </Box>
        </div>

        {/* ---------- 右栏：仓库、活跃，然后是本机学到的东西 ---------- */}
        <div className="flex min-w-0 flex-col gap-md">
          <Box
            title="Popular repositories"
            aside={<span>{gh ? `${gh.repo_count} 个非 fork 仓库 · 按 star 排` : "载入中…"}</span>}
          >
            {gh?.popular.length ? (
              gh.popular.map((r, i) => <RepoRow key={r.full_name} r={r} first={i === 0} />)
            ) : (
              <BoxEmpty>{gh ? "没有公开仓库，或取不到。" : "载入中…"}</BoxEmpty>
            )}
          </Box>

          <Box
            title="Contribution activity"
            aside={gh ? <span>{gh.event_count} events in the last 90 days</span> : undefined}
          >
            <BoxRow className="flex flex-col gap-sm py-md">
              <Calendar days={gh?.activity ?? []} />
              <p className="text-caption text-muted-foreground">
                口径说明：这是 REST 的 events/public（近 90 天、最多 300 条公开事件），与 GitHub
                页面上那个 contributions 数不是同一个统计（那个走 GraphQL、含私有仓库）。
              </p>
            </BoxRow>
          </Box>

          <Box
            title="它以为你喜欢什么"
            aside={<span>TF-IDF 词表前 16 个 · 泛词已按 df&gt;15% 剔除</span>}
          >
            {me && me.terms.length ? (
              <BoxRow className="flex flex-col gap-xs py-sm">
                {me.terms.map((t) => (
                  <Bar key={t.term} name={t.term} v={t.weight} max={maxTerm} suffix={t.weight.toFixed(2)} />
                ))}
              </BoxRow>
            ) : (
              <BoxEmpty>
                词表是空的 —— 点左栏「重建画像」，它会读你的 starred 与公开仓库算出词表，
                再按词表去抓取（约 1 分钟）。
              </BoxEmpty>
            )}
          </Box>

          <Box title="语言权重">
            {me && me.langs.length ? (
              <BoxRow className="flex flex-col gap-xs py-sm">
                {me.langs.map((l) => (
                  <Bar key={l.language} name={l.language} v={l.weight} max={maxLang} suffix={l.weight.toFixed(2)} />
                ))}
              </BoxRow>
            ) : (
              <BoxEmpty>还没有语言权重。</BoxEmpty>
            )}
          </Box>

          <Box title="你做过什么" aside={<span>曝光按 (项目, 会话) 去重</span>}>
            <BoxRow className="flex flex-col gap-xs py-sm">
              {me?.kinds.length ? (
                me.kinds.map(([k, n]) => (
                  <span key={k} className="flex items-center justify-between gap-md text-label">
                    <span className="truncate">
                      {KIND_LABEL[k] ?? k}
                      <span className="ms-xs text-caption text-muted-foreground">{k}</span>
                    </span>
                    <span className="tabular-nums">{n}</span>
                  </span>
                ))
              ) : (
                <span className="text-caption text-muted-foreground">还没有事件。</span>
              )}
              {stats ? (
                <span className="mt-xs text-caption text-muted-foreground">
                  曝光 {stats.impressions} 次 / 触达 {stats.reach} 个不同项目 / {stats.sessions} 个会话；
                  点开率 {((stats.opens / Math.max(stats.impressions, 1)) * 100).toFixed(1)}%
                </span>
              ) : null}
            </BoxRow>
          </Box>

          <Box
            title="哪些桶已经在动排序"
            aside={me ? <span>{live}/${me.buckets.length} 个桶够到 n≥{me.min_n}</span> : undefined}
          >
            {me && me.buckets.length ? (
              me.buckets.map((b) => (
                <BoxRow key={b.feat + b.bucket} className="flex items-center justify-between gap-sm py-sm">
                  <span className="truncate font-mono text-caption">
                    {b.feat}={b.bucket}
                  </span>
                  <span className="flex shrink-0 items-center gap-2xs text-caption tabular-nums">
                    <span className="text-muted-foreground">
                      n={b.n} · {b.ctr}%
                    </span>
                    <Badge variant={b.live ? "default" : "outline"}>
                      ×{b.w.toFixed(2)}
                      {b.live ? "" : " 样本不足"}
                    </Badge>
                  </span>
                </BoxRow>
              ))
            ) : (
              <BoxEmpty>
                还没有分桶数据。攒够曝光后点「重新校准」，够不到 n≥{me?.min_n ?? 20} 的桶不会生效。
              </BoxEmpty>
            )}
            {me?.fitted_at ? (
              <BoxRow className="py-sm text-caption text-muted-foreground">
                上次校准：{ago(me.fitted_at)}
              </BoxRow>
            ) : null}
          </Box>
        </div>
      </div>
    </div>
  );
}

function RepoRow({ r, first }: { r: Repo; first: boolean }) {
  return (
    <BoxRow className={first ? "" : undefined}>
      <div className="flex flex-col gap-2xs">
        <div className="flex flex-wrap items-center gap-xs">
          <button
            className="text-lead font-semibold text-primary hover:underline"
            onClick={() => openExternal(r.url).catch((e) => notice(String(e)))}
          >
            {r.name}
          </button>
          <Badge variant="outline">Public</Badge>
          {r.archived ? <Badge variant="secondary">已归档</Badge> : null}
        </div>
        <p className="max-w-prose text-body text-muted-foreground">{r.description || "（无简介）"}</p>
        <div className="flex flex-wrap items-center gap-md text-caption text-muted-foreground tabular-nums">
          {r.language ? <LangDot name={r.language} /> : null}
          <span>★ {r.stars}</span>
          <span>⑂ {r.forks}</span>
          <span>更新于 {isoDay(r.pushed_at)}</span>
        </div>
      </div>
    </BoxRow>
  );
}

function Bar({ name, v, max, suffix }: { name: string; v: number; max: number; suffix: string }) {
  return (
    <div className="flex items-center gap-sm">
      <span className="w-32 shrink-0 truncate text-label">{name}</span>
      <Progress value={(v / max) * 100} className="h-1.5 grow" />
      <span className="w-12 shrink-0 text-right text-caption tabular-nums text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}
