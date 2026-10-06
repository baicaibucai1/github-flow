import { useCallback, useState } from "react";
import {
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
import { ago, call, log, type Counts } from "./lib/bridge";
import { AppProvider, useStore } from "./lib/store";
import { FeedView } from "./views/FeedView";
import { DetailView } from "./views/DetailView";
import { SettingsView } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";

const CHANNELS: [string, string][] = [
  ["hot", "热度"],
  ["profile", "画像"],
  ["explore", "探索"],
  ["saved", "收藏"],
];

const RAIL = [
  { id: "hot", label: "发现", icon: FlameIcon },
  { id: "saved", label: "收藏", icon: BookmarkIcon },
  { id: "stats", label: "统计", icon: BarChart3Icon },
  { id: "set", label: "设置", icon: SettingsIcon },
];

export default function App() {
  return (
    <AppProvider>
      <Shell />
      <Toaster position="bottom-right" richColors closeButton />
    </AppProvider>
  );
}

function Shell() {
  const { settings, setSetting, theme, counts, stats, dbg, setDbg, refreshCounts, refreshStats } =
    useStore();
  const [channel, setChannel] = useState("hot");
  const [page, setPage] = useState<"feed" | "stats" | "set">("feed");
  const [openId, setOpenId] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");

  const notice = useCallback((m: string) => toast(m), []);
  const reload = () => {
    setNonce((n) => n + 1);
    void refreshCounts();
    void refreshStats();
  };

  const isFeed = page === "feed" && openId == null;

  const collect = () => {
    setBusy("collect");
    void Promise.all([call("run_collect", { pages: 1, curveN: 12 }), call("do_explore", { perLang: 2 })])
      .then(() => {
        notice("采集完成，榜已更新");
        reload();
      })
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
        reload();
      })
      .catch((e) => notice("搜索失败：" + String(e)));
  };

  return (
    <FileManagerPage
      nav={
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>GitHub 信息流</SidebarGroupLabel>
            <SidebarMenu>
              {RAIL.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    isActive={
                      id === "stats"
                        ? page === "stats"
                        : id === "set"
                          ? page === "set"
                          : page === "feed" &&
                            openId == null &&
                            (id === "hot" ? channel !== "saved" : channel === "saved")
                    }
                    onClick={() => {
                      setOpenId(null);
                      if (id === "stats" || id === "set") setPage(id);
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
                      {(counts?.[v as keyof Counts] as number) ?? 0}
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
              onClick={() => setSetting("theme", theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
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
          <span>上次采集 {ago(counts?.last_collect)}</span>
          {!counts?.last_collect ||
          (Date.now() / 1000 - (counts?.last_collect ?? 0)) > 6 * 3600 ? (
            <Badge variant="destructive">数据已过期，热度榜会重复</Badge>
          ) : null}
          <span>· 候选池 {counts?.all ?? "—"}</span>
          <span>
            · 已测增速 {counts?.hot ?? "—"} 热度 / {counts?.profile ?? 0} 画像 /{" "}
            {counts?.explore ?? 0} 探索
          </span>
          {stats?.login ? (
            <Badge variant="default">
              <UserRoundIcon />@{stats.login}
            </Badge>
          ) : (
            <Badge variant="destructive">未登录（匿名 60 次/小时）</Badge>
          )}
          {openId != null ? (
            <Button size="xs" variant="ghost" onClick={() => setOpenId(null)}>
              返回列表
            </Button>
          ) : null}
        </>
      }
    >
      {openId != null ? (
        <DetailView repoId={openId} onBack={() => setOpenId(null)} onNotice={notice} />
      ) : page === "stats" ? (
        <StatsView />
      ) : page === "set" ? (
        <SettingsView onNotice={notice} onJump={(c) => {
          setPage("feed");
          setChannel(c);
        }} onChanged={reload} />
      ) : (
        <FeedView
          key={`${channel}-${nonce}`}
          channel={channel}
          onOpen={(id) => {
            void call("log_event", { kind: "open", repoId: id }).catch(() => {});
            setOpenId(id);
          }}
          onNotice={notice}
        />
      )}
    </FileManagerPage>
  );
}
