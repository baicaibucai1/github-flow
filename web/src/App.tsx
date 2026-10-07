import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Toaster,
  Tabs,
  TabsList,
  TabsTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@soda/ui";
import { FileManagerPage } from "@soda/patterns";
import {
  BarChart3Icon,
  BookmarkIcon,
  CompassIcon,
  FlameIcon,
  MoonIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ago, call, log } from "./lib/bridge";
import {
  bumpFeed,
  CHANNELS,
  initStore,
  notice,
  persist,
  reloadAll,
  setChannel,
  setDbg,
  setNoticeSink,
  useApp,
  useChannel,
  useDbg,
  useFeedNonce,
} from "./lib/store";
import { DetailView } from "./views/DetailView";
import { FeedView } from "./views/FeedView";
import { MeView } from "./views/MeView";
import { SettingsView } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";

const RAIL = [
  { id: "hot", label: "发现", icon: FlameIcon },
  { id: "saved", label: "收藏", icon: BookmarkIcon },
  { id: "me", label: "我的", icon: UserRoundIcon },
  { id: "stats", label: "统计", icon: BarChart3Icon },
  { id: "set", label: "设置", icon: SettingsIcon },
];

export default function App() {
  const snap = useApp();
  const nonce = useFeedNonce();
  const channel = useChannel();
  const dbg = useDbg();
  const [page, setPage] = useState<"feed" | "me" | "stats" | "set">("feed");
  const [tab, setTab] = useState("look");
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setNoticeSink((m) => toast(m));
    return () => setNoticeSink(null);
  }, []);
  useEffect(() => initStore(), []);

  const goLogin = useCallback(() => {
    setPage("set");
    setTab("acct");
    setOpenId(null);
  }, []);

  if (!snap.ready) return null;

  const auth = snap.auth;
  const anonymous = !!auth && !auth.authed;
  const isFeed = page === "feed" && openId == null;

  const collect = () => {
    setBusy("collect");
    void Promise.all([call("run_collect", { pages: 1, curveN: 12 }), call("do_explore", { perLang: 2 })])
      .then(() => {
        notice("采集完成，榜已更新");
        return reloadAll();
      })
      .then(bumpFeed)
      .catch((e) => notice("采集失败：" + String(e)))
      .finally(() => setBusy(""));
  };

  const search = () => {
    const term = q.trim();
    if (!term) return;
    void call<string>("do_search", { query: term })
      .then((m) => {
        log("search " + m);
        setPage("feed");
        setOpenId(null);
        setChannel("all");
        notice(`搜索「${term}」—— 这个词已进兴趣画像，下一轮抓取会找更多这类项目`);
        return reloadAll();
      })
      .then(bumpFeed)
      .catch((e) => notice("搜索失败：" + String(e)));
  };

  return (
    <>
      <FileManagerPage
        nav={
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>GitHub Flow</SidebarGroupLabel>
              <SidebarMenu>
                {RAIL.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={
                        id === "me"
                          ? page === "me"
                          : id === "stats"
                            ? page === "stats"
                            : id === "set"
                              ? page === "set"
                              : page === "feed" &&
                                openId == null &&
                                (id === "hot" ? channel !== "saved" : channel === "saved")
                      }
                      onClick={() => {
                        setOpenId(null);
                        if (id === "me" || id === "stats" || id === "set") setPage(id);
                        else {
                          setPage("feed");
                          setChannel(id === "saved" ? "saved" : "hot");
                        }
                      }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
            <SidebarFooter>
              <Button
                size="xs"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setPage("me");
                  setOpenId(null);
                }}
              >
                <UserRoundIcon />
                {snap.account ? "@" + snap.account : "未登录"}
              </Button>
            </SidebarFooter>
          </SidebarContent>
        }
        toolbar={
          <>
            {isFeed && channel !== "all" ? (
              <Tabs value={channel} onValueChange={(v) => setChannel(String(v))}>
                <TabsList variant="line">
                  {CHANNELS.map(([v, label]) => (
                    <TabsTrigger key={v} value={v}>
                      {label}
                      <Badge variant="secondary" className="ms-2xs">
                        {(snap.counts?.[v as keyof typeof snap.counts] as number) ?? 0}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : channel === "all" ? (
              <Badge variant="default">
                搜索结果：{q}
                <button className="ms-2xs underline" onClick={() => setChannel("hot")}>
                  返回热度榜
                </button>
              </Badge>
            ) : null}

            <div className="ms-auto flex items-center gap-2xs">
              <Input
                value={q}
                placeholder="搜你想看的（回车：这个词会进你的兴趣画像）"
                className="w-72"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") search();
                }}
              />
              <Button size="sm" variant="outline" onClick={search}>
                <SearchIcon data-icon="inline-start" />
                搜索
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={collect}>
                <RefreshCwIcon data-icon="inline-start" className={busy ? "animate-spin" : ""} />
                {busy === "collect" ? "采集中" : "采集"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="切换明暗"
                onClick={() => persist("theme", snap.theme === "dark" ? "light" : "dark")}
              >
                {snap.theme === "dark" ? <MoonIcon /> : <SunIcon />}
              </Button>
              <Button
                size="sm"
                variant={dbg ? "default" : "ghost"}
                title="在卡片上显示 score"
                onClick={() => setDbg(!dbg)}
              >
                <CompassIcon />
              </Button>
            </div>
          </>
        }
        breadcrumb={
          <>
            <span>上次采集 {ago(snap.counts?.last_collect)}</span>
            {!snap.counts?.last_collect ||
            (Date.now() / 1000 - (snap.counts?.last_collect ?? 0)) > 6 * 3600 ? (
              <Badge variant="destructive">数据已过期，热度榜会重复</Badge>
            ) : null}
            <span>· 候选池 {snap.counts?.all ?? "—"}</span>
            <span>
              · 已测增速 {snap.counts?.hot ?? "—"} 热度 / {snap.counts?.profile ?? 0} 画像 /{" "}
              {snap.counts?.explore ?? 0} 探索
            </span>
            {auth?.invalid ? (
              <Badge variant="destructive">凭据已失效</Badge>
            ) : auth?.authed ? (
              <Badge variant="default">
                @{auth.login} · {auth.core?.remaining ?? "—"}/{auth.core?.limit ?? "—"} 次
                {auth.missing_scope?.length ? ` · 缺 ${auth.missing_scope.join("/")}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline">
                匿名 · {auth?.core?.remaining ?? "—"}/{auth?.core?.limit ?? "60"} 次/小时
              </Badge>
            )}
            {openId != null ? (
              <Button size="xs" variant="ghost" onClick={() => setOpenId(null)}>
                返回列表
              </Button>
            ) : null}
          </>
        }
      >
        {isFeed && anonymous && !dismissed ? (
          <div className="px-md pt-md">
            <Alert>
              <AlertTitle>现在是匿名态</AlertTitle>
              <AlertDescription>
                热度与探索照常用，配额 {auth?.core?.remaining ?? "?"}/
                {auth?.core?.limit ?? "60"} 次/小时；但「画像」通道是空的 —— 它要读<b>你自己</b>
                的收藏，而本机上没有凭据。登录一次（粘贴 token 约 30 秒）配额变成 5000/小时，
                推荐才会按你的口味重算。
              </AlertDescription>
              <AlertAction>
                <Button size="xs" onClick={goLogin}>
                  去登录
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setDismissed(true)}>
                  这次不用
                </Button>
              </AlertAction>
            </Alert>
          </div>
        ) : null}

        {openId != null ? (
          <DetailView repoId={openId} onBack={() => setOpenId(null)} onNotice={notice} />
        ) : page === "me" ? (
          <MeView />
        ) : page === "stats" ? (
          <StatsView />
        ) : page === "set" ? (
          <SettingsView
            tab={tab}
            onTab={setTab}
            onJump={(c) => {
              setPage("feed");
              setChannel(c);
            }}
          />
        ) : (
          <FeedView
            key={`${channel}-${nonce}`}
            channel={channel}
            onNotice={notice}
            onOpen={(id) => {
              void call("log_event", { kind: "open", repoId: id }).catch(() => {});
              setOpenId(id);
            }}
          />
        )}
      </FileManagerPage>
      <Toaster position="bottom-right" richColors closeButton />
    </>
  );
}
