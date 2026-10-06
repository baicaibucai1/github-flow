import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, Badge, Button, Progress, Separator } from "@soda/ui";
import { DashboardPage, PanelCard } from "@soda/patterns";
import { CalendarClockIcon, ExternalLinkIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import {
  ago,
  call,
  log,
  openExternal,
  type AuthStatus,
  type MeReport,
  type Stats,
} from "../lib/bridge";
import { notice, refreshAuth, reloadAll, useApp } from "../lib/store";

const KIND_LABEL: Record<string, string> = {
  open: "在应用里点开",
  open_in_browser: "跳去浏览器",
  star_in_app: "收藏",
  copy_clone: "复制 clone",
  dwell: "停留",
  hide: "不感兴趣",
  search: "搜索",
  webview_open: "应用内浏览",
  webview_close: "应用内浏览结束",
};

export function MeView() {
  const { auth, stats } = useApp();
  const [me, setMe] = useState<MeReport | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    void call<MeReport>("me_report")
      .then(setMe)
      .catch((e) => log("me_report FAIL " + e));
  }, []);

  useEffect(load, [load]);

  const act = (label: string, p: Promise<unknown>, done: string, jump?: string) => {
    setBusy(label);
    void p
      .then(() => Promise.all([refreshAuth(), reloadAll()]))
      .then(() => {
        load();
        notice(done);
        if (jump) notice(jump);
      })
      .catch((e) => notice(label + "失败：" + String(e)))
      .finally(() => setBusy(""));
  };

  const maxTerm = Math.max(0.001, ...(me?.terms.map((t) => t.weight) ?? [1]));
  const maxLang = Math.max(0.001, ...(me?.langs.map((l) => l.weight) ?? [1]));
  const liveBuckets = me?.buckets.filter((b) => b.live).length ?? 0;

  return (
    <div className="p-md">
      <DashboardPage
        header={{
          title: "我的",
          description:
            "这页除了配额，全部是本机数据：配额是现场问 GitHub 的（那个请求不计配额）。",
          actions: (
            <>
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  act("建画像", call<string>("build_my_profile", { pages: 5 }), "画像已重建")
                }
              >
                <SparklesIcon data-icon="inline-start" />
                {busy === "建画像" ? "建画像中…" : "重建画像"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => act("校准", call<string>("calibrate_now"), "已重新校准")}
              >
                {busy === "校准" ? "校准中…" : "重新校准"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void refreshAuth().then(load);
                }}
              >
                刷新
              </Button>
              {auth?.login ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    openExternal("https://github.com/" + auth.login).catch((e) =>
                      notice(String(e))
                    )
                  }
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  在 GitHub 打开我
                </Button>
              ) : null}
            </>
          ),
        }}
        metrics={[
          {
            label: "剩余配额",
            value: auth?.core ? `${auth.core.remaining}` : "—",
            delta: auth?.core ? `共 ${auth.core.limit} 次/小时` : undefined,
            trend: auth?.authed ? "up" : "flat",
          },
          { label: "画像词数", value: me?.terms.length ?? 0 },
          { label: "画像候选", value: me?.profile_hits ?? 0 },
          { label: "本机收藏", value: me?.saved ?? 0 },
        ]}
      >
        <PanelCard
          title="它以为你喜欢什么"
          description="TF-IDF 词表前 16 个。权重 1.0 是你收藏过的东西里提出来的词；泛词（df 超过 15%）已被剔除。"
          span={8}
        >
          {me && me.terms.length ? (
            <div className="flex flex-col gap-xs">
              {me.terms.map((t) => (
                <Bar key={t.term} name={t.term} v={t.weight} max={maxTerm} suffix={t.weight.toFixed(2)} />
              ))}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                词表是空的 —— 你刚登录，还没让它读过你的收藏。点右上角「重建画像」，
                它会读你的 starred 与公开仓库，算出词表后按词表去抓取（约 1 分钟）。
              </AlertDescription>
            </Alert>
          )}
        </PanelCard>

        <PanelCard title="语言权重" description="画像里按语言加的那一层。" span={4}>
          {me && me.langs.length ? (
            <div className="flex flex-col gap-xs">
              {me.langs.map((l) => (
                <Bar key={l.language} name={l.language} v={l.weight} max={maxLang} suffix={l.weight.toFixed(2)} />
              ))}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground">还没有语言权重。</p>
          )}
        </PanelCard>

        <PanelCard
          title="你做过什么"
          description="曝光按 (项目, 会话) 去重；停留是每 5 秒一条心跳，不是独立行为。"
          span={6}
        >
          <div className="flex flex-col gap-xs text-label">
            {me?.kinds.length ? (
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
            曝光 {stats.impressions} 次 / 触达 {stats.reach} 个不同项目 / {stats.sessions} 个会话；
            点开率 {Math.round((stats.opens / Math.max(stats.impressions, 1)) * 1000) / 10}%。
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
                <span
                  key={b.feat + b.bucket}
                  className="flex items-center justify-between gap-sm"
                >
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
              还没有分桶数据。攒够曝光后点「重新校准」，够不到 n≥{me?.min_n ?? 20} 的桶不会生效
              —— 几十条数据就改排序等于把噪声当信号。
            </p>
          )}
        </PanelCard>

        <PanelCard title="身份与凭据" span={12}>
          <Identity auth={auth} busy={busy} onRemove={() =>
            act("移除凭据", call("account_remove", { login: auth?.login ?? "" }), "已移除本机凭据")
          } />
        </PanelCard>
      </DashboardPage>
    </div>
  );
}

function Identity({
  auth,
  busy,
  onRemove,
}: {
  auth: AuthStatus | null;
  busy: string;
  onRemove: () => void;
}) {
  if (!auth) {
    return <p className="text-caption text-muted-foreground">读不到认证态（网络或代理问题）。</p>;
  }
  if (!auth.authed) {
    return (
      <Alert>
        <AlertDescription>
          本机没有凭据，现在是匿名态：core {auth.core?.remaining ?? "?"}/{auth.core?.limit ?? "60"}{" "}
          次/小时。去「设置 → 账号」登录。
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
      <div>
        <Button
          size="xs"
          variant="destructive"
          disabled={!!busy}
          onClick={onRemove}
        >
          <Trash2Icon data-icon="inline-start" />
          移除这个凭据
        </Button>
      </div>
    </div>
  );
}

function Bar({
  name,
  v,
  max,
  suffix,
}: {
  name: string;
  v: number;
  max: number;
  suffix: string;
}) {
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
