import { useCallback, useEffect, useState } from "react";
import {
  ActivityGraph,
  Alert,
  AlertDescription,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  Separator,
} from "@soda/ui";
import { DashboardPage, PanelCard } from "@soda/patterns";
import {
  CalendarClockIcon,
  ExternalLinkIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import {
  ago,
  call,
  log,
  openExternal,
  type AuthStatus,
  type GhProfile,
  type MeReport,
  type Repo,
} from "../lib/bridge";
import { notice, refreshAuth, reloadAll, useApp } from "../lib/store";

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

export function MeView() {
  const { auth, stats } = useApp();
  const [me, setMe] = useState<MeReport | null>(null);
  const [gh, setGh] = useState<GhProfile | null>(null);
  const [ghErr, setGhErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    void call<MeReport>("me_report")
      .then(setMe)
      .catch((e) => log("me_report FAIL " + e));
    setGhErr("");
    void call<GhProfile>("my_profile")
      .then((p) => {
        setGh(p);
        setGhErr("");
      })
      .catch((e) => setGhErr(String(e)));
  }, []);

  useEffect(load, [load]);

  const act = (label: string, p: Promise<unknown>, done: string) => {
    setBusy(label);
    void p
      .then(() => Promise.all([refreshAuth(), reloadAll()]))
      .then(() => {
        load();
        notice(done);
      })
      .catch((e) => notice(label + "失败：" + String(e)))
      .finally(() => setBusy(""));
  };

  const maxTerm = Math.max(0.001, ...(me?.terms.map((t) => t.weight) ?? [1]));
  const maxLang = Math.max(0.001, ...(me?.langs.map((l) => l.weight) ?? [1]));
  const liveBuckets = me?.buckets.filter((b) => b.live).length ?? 0;

  return (
    <div className="flex flex-col gap-md p-md">
      <ProfileCard gh={gh} err={ghErr} busy={busy} onRetry={load} />

      <DashboardPage
        metrics={[
          { label: "公开仓库", value: gh?.repo_count ?? "—" },
          { label: "Followers", value: gh?.followers ?? "—" },
          { label: "近 90 天公开事件", value: gh?.event_count ?? "—" },
          {
            label: "剩余配额",
            value: auth?.core?.remaining ?? "—",
            delta: auth?.core ? `共 ${auth.core.limit} 次/小时` : undefined,
            trend: auth?.authed ? "up" : "flat",
          },
        ]}
      >
        <PanelCard
          title="他的仓库（按 star）"
          description="不含 fork。GitHub 的 pins 只在 GraphQL 里，所以这里按 star 排前 6 个，等价于页面上的 Popular。"
          span={8}
        >
          {gh?.popular.length ? (
            <ItemGroup>
              {gh.popular.map((r) => (
                <RepoItem key={r.full_name} r={r} />
              ))}
            </ItemGroup>
          ) : (
            <p className="text-caption text-muted-foreground">
              {ghErr ? "取不到仓库列表，见上方提示。" : "载入中…"}
            </p>
          )}
        </PanelCard>

        <PanelCard
          title="近 90 天活跃"
          description="REST 的公开事件，最多 300 条；跟 GitHub 页面上那个 contributions 不是一个口径（那个走 GraphQL、含私有仓库）。"
          span={4}
        >
          {gh && gh.activity.length ? (
            <ActivityGraph days={gh.activity} />
          ) : (
            <p className="text-caption text-muted-foreground">
              {gh ? "这段时间没有公开事件。" : "载入中…"}
            </p>
          )}
          {gh ? (
            <p className="mt-sm text-caption text-muted-foreground">
              {gh.event_count} 条事件分布在 {gh.activity.length} 天里
            </p>
          ) : null}
        </PanelCard>

        <PanelCard
          title="它以为你喜欢什么"
          description="TF-IDF 词表前 16 个。权重 1.0 是你收藏过的东西里提出来的词；泛词（df 超过 15%）已被剔除。"
          span={8}
        >
          {me && me.terms.length ? (
            <div className="flex flex-col gap-xs">
              {me.terms.map((t) => (
                <Bar
                  key={t.term}
                  name={t.term}
                  v={t.weight}
                  max={maxTerm}
                  suffix={t.weight.toFixed(2)}
                />
              ))}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                词表是空的 —— 还没让它读过你的收藏。点上面的「重建画像」，它会读你的 starred
                与公开仓库算出词表，再按词表去抓取（约 1 分钟）。
              </AlertDescription>
            </Alert>
          )}
        </PanelCard>

        <PanelCard title="语言权重" description="画像里按语言加的那一层。" span={4}>
          {me && me.langs.length ? (
            <div className="flex flex-col gap-xs">
              {me.langs.map((l) => (
                <Bar
                  key={l.language}
                  name={l.language}
                  v={l.weight}
                  max={maxLang}
                  suffix={l.weight.toFixed(2)}
                />
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">还没有语言权重。</p>
          )}
        </PanelCard>

        <PanelCard
          title="你做过什么"
          description="曝光按 (项目, 会话) 去重；停留是心跳，不是独立行为。"
          span={6}
        >
          <div className="flex flex-col gap-xs text-label">
            {me && me.kinds.length ? (
              me.kinds.map(([k, n]) => (
                <span key={k} className="flex items-center justify-between gap-md">
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
          </div>
          {stats ? (
            <p className="mt-md text-caption text-muted-foreground">
              曝光 {stats.impressions} 次 / 触达 {stats.reach} 个不同项目 / {stats.sessions}{" "}
              个会话；点开率{" "}
              {Math.round((stats.opens / Math.max(stats.impressions, 1)) * 1000) / 10}%。
            </p>
          ) : null}
          {me && me.hide_reasons.length ? (
            <>
              <Separator className="my-sm" />
              <div className="flex flex-wrap gap-2xs">
                {me.hide_reasons.map(([r, n]) => (
                  <Badge key={r} variant="outline">
                    {r} × {n}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}
        </PanelCard>

        <PanelCard
          title="哪些桶已经在动排序"
          description={
            me
              ? `分桶校准：样本不足 ${me.min_n} 条的桶权重强制 1.0（不生效）。现在 ${liveBuckets}/${me.buckets.length} 个桶够到了门槛。`
              : "还没跑过校准。"
          }
          span={6}
        >
          {me && me.buckets.length ? (
            <div className="flex flex-col gap-2xs text-caption">
              {me.buckets.map((b) => (
                <span key={b.feat + b.bucket} className="flex items-center justify-between gap-sm">
                  <span className="truncate font-mono">
                    {b.feat}={b.bucket}
                  </span>
                  <span className="flex shrink-0 items-center gap-2xs tabular-nums">
                    <span className="text-muted-foreground">
                      n={b.n} · {b.ctr}%
                    </span>
                    <Badge variant={b.live ? "default" : "outline"}>
                      ×{b.w.toFixed(2)}
                      {b.live ? "" : " 样本不足"}
                    </Badge>
                  </span>
                </span>
              ))}
              <span className="mt-xs text-muted-foreground">
                上次校准：{me.fitted_at ? ago(me.fitted_at) : "从未"}
              </span>
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">
              还没有分桶数据。攒够曝光后点「重新校准」，够不到 n≥{me?.min_n ?? 20}{" "}
              的桶不会生效 —— 几十条数据就改排序等于把噪声当信号。
            </p>
          )}
        </PanelCard>

        <PanelCard title="身份与凭据" span={12}>
          <Identity
            auth={auth}
            busy={busy}
            onBuild={() =>
              act("建画像", call<string>("build_my_profile", { pages: 5 }), "画像已重建")
            }
            onCalibrate={() => act("校准", call<string>("calibrate_now"), "已重新校准")}
            onRemove={() =>
              act(
                "移除凭据",
                call("account_remove", { login: auth?.login ?? "" }),
                "已移除本机凭据"
              )
            }
          />
        </PanelCard>
      </DashboardPage>
    </div>
  );
}

function ProfileCard({
  gh,
  err,
  busy,
  onRetry,
}: {
  gh: GhProfile | null;
  err: string;
  busy: string;
  onRetry: () => void;
}) {
  if (err) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          读不到 GitHub 上的资料：{err}
        </AlertDescription>
        <Button size="xs" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </Alert>
    );
  }
  if (!gh) {
    return (
      <Card className="gap-0 py-0">
        <CardContent className="flex items-start gap-md py-md">
          <Progress value={40} className="h-1 w-full" />
        </CardContent>
      </Card>
    );
  }
  const initial = (gh.name || gh.login).slice(0, 1).toUpperCase();
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-md py-md sm:flex-row sm:items-start">
        <Avatar className="size-24 shrink-0">
          {gh.avatar ? <AvatarImage src={gh.avatar} alt={gh.login} /> : null}
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <div className="flex flex-col">
            <h1 className="truncate text-title">{gh.name || gh.login}</h1>
            <p className="text-muted-foreground text-body">
              {gh.login}
              {gh.location ? ` · ${gh.location}` : ""}
              {gh.company ? ` · ${gh.company}` : ""}
            </p>
          </div>
          {gh.bio ? (
            <p className="max-w-prose whitespace-pre-line text-body">{gh.bio}</p>
          ) : null}
          <div className="flex flex-wrap gap-md text-caption">
            <span>
              <b className="font-medium text-foreground">{gh.public_repos ?? 0}</b> 公开仓库
            </span>
            <span>
              <b className="font-medium text-foreground">{gh.followers ?? 0}</b> followers
            </span>
            <span>
              <b className="font-medium text-foreground">{gh.following ?? 0}</b> following
            </span>
            {gh.blog ? <span className="font-mono">{gh.blog}</span> : null}
            <span className="text-muted-foreground">加入于 {gh.created_at?.slice(0, 10)}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2xs sm:w-40">
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              openExternal(gh.url || "https://github.com/" + gh.login).catch((e) =>
                notice(String(e))
              )
            }
          >
            <ExternalLinkIcon data-icon="inline-start" />
            在 GitHub 打开
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={onRetry}>
            {busy === "资料" ? "载入中…" : "刷新资料"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RepoItem({ r }: { r: Repo }) {
  return (
    <Item
      variant="outline"
      className="cursor-pointer"
      onClick={() => openExternal(r.url).catch((e) => notice(String(e)))}
    >
      <ItemContent>
        <ItemTitle>
          {r.name}
          {r.archived ? <Badge variant="secondary">已归档</Badge> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-2">{r.description || "（无简介）"}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {r.language ? <Badge variant="outline">{r.language}</Badge> : null}
        <Badge variant="secondary">★ {r.stars}</Badge>
        <span className="text-caption text-muted-foreground">{agoFromIso(r.pushed_at)}</span>
      </ItemActions>
    </Item>
  );
}

function Identity({
  auth,
  busy,
  onBuild,
  onCalibrate,
  onRemove,
}: {
  auth: AuthStatus | null;
  busy: string;
  onBuild: () => void;
  onCalibrate: () => void;
  onRemove: () => void;
}) {
  if (!auth) {
    return <p className="text-caption text-muted-foreground">读不到认证态（网络或代理问题）。</p>;
  }
  if (!auth.authed) {
    return (
      <Alert>
        <AlertDescription>
          本机没有凭据，现在是匿名态：core {auth.core?.remaining ?? "?"}/
          {auth.core?.limit ?? "60"} 次/小时。去「设置 → 账号」登录。
          {auth.error ? `（读配额失败：${auth.error}）` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  const mins = auth.core?.resets_at
    ? Math.max(0, Math.round((auth.core.resets_at * 1000 - Date.now()) / 60000))
    : null;
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-xs">
        <Badge variant="default">@{auth.login}</Badge>
        <Badge variant="secondary">{auth.mode === "pat" ? "粘贴的 token" : "设备码 OAuth"}</Badge>
        <Badge variant="outline">scope: {auth.scopes || "GitHub 没回报"}</Badge>
        {auth.missing_scope?.length ? (
          <Badge variant="destructive">缺 {auth.missing_scope.join("、")}</Badge>
        ) : null}
        {auth.invalid ? <Badge variant="destructive">凭据已失效</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-md text-caption">
        <span className="flex items-center gap-2xs text-muted-foreground">
          <CalendarClockIcon />
          {auth.core?.limit
            ? `配额窗口约 ${mins} 分钟后重置（剩 ${auth.core.remaining}/${auth.core.limit}）`
            : "读不到配额窗口"}
        </span>
        <span className="text-muted-foreground">
          search 剩 {auth.search?.remaining ?? "?"}/{auth.search?.limit ?? "?"} · GraphQL{" "}
          {auth.graphql?.remaining ?? "?"}
        </span>
      </div>
      <p className="text-caption text-muted-foreground">
        凭据只写在本机 <code>{auth.cred_file}</code>，不进数据库、不出这台机器。
      </p>
      <div className="flex flex-wrap gap-2xs">
        <Button size="xs" disabled={!!busy} onClick={onBuild}>
          <SparklesIcon data-icon="inline-start" />
          {busy === "建画像" ? "建画像中…" : "重建画像"}
        </Button>
        <Button size="xs" variant="outline" disabled={!!busy} onClick={onCalibrate}>
          {busy === "校准" ? "校准中…" : "重新校准"}
        </Button>
        <Button size="xs" variant="destructive" disabled={!!busy} onClick={onRemove}>
          <Trash2Icon data-icon="inline-start" />
          移除这个凭据
        </Button>
      </div>
    </div>
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

function agoFromIso(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return ago(Math.floor(t / 1000));
}
