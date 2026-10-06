import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Separator,
  Switch,
} from "@soda/ui";
import { SettingsPage, SettingsRow, SettingsSection } from "@soda/patterns";
import { KeyRoundIcon, LogInIcon, Trash2Icon } from "lucide-react";
import {
  call,
  log,
  type Account,
  type DevicePoll,
  type DeviceStart,
} from "../lib/bridge";
import { useStore } from "../lib/store";

const SECTIONS = [
  { value: "look", label: "外观" },
  { value: "acct", label: "账号" },
  { value: "net", label: "网络" },
  { value: "tr", label: "翻译" },
  { value: "data", label: "数据" },
];

const SETS: [string, string][] = [
  ["ink", "冷蓝"],
  ["soda", "石墨"],
  ["sandbox", "暖砂"],
  ["marine", "青蓝"],
];

export type SettingsViewProps = {
  onNotice: (msg: string) => void;
  onJump: (channel: string) => void;
  onChanged: () => void;
};

export function SettingsView({ onNotice, onJump, onChanged }: SettingsViewProps) {
  const { settings, setSetting } = useStore();
  const [tab, setTab] = useState("look");

  return (
    <div className="p-md">
      <SettingsPage
        nav={SECTIONS}
        value={tab}
        onValueChange={setTab}
        header={{
          title: "设置",
          description: "全部存在本机：设置写在 SQLite 的 setting 表，token 单独存 accounts.json，不进数据库。",
        }}
      >
        {tab === "look" ? <Look settings={settings} setSetting={setSetting} /> : null}
        {tab === "acct" ? (
          <Accounts onNotice={onNotice} onJump={onJump} onChanged={onChanged} />
        ) : null}
        {tab === "net" ? <Net settings={settings} setSetting={setSetting} /> : null}
        {tab === "tr" ? (
          <Translate settings={settings} setSetting={setSetting} onChanged={onChanged} />
        ) : null}
        {tab === "data" ? <Data onNotice={onNotice} onChanged={onChanged} /> : null}
      </SettingsPage>
    </div>
  );
}

type SubProps = {
  settings: ReturnType<typeof useStore>["settings"];
  setSetting: (k: string, v: string) => void;
};

function Seg({
  value,
  options,
  onPick,
}: {
  value: string;
  options: [string, string][];
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2xs">
      {options.map(([v, label]) => (
        <Button
          key={v}
          size="xs"
          variant={value === v ? "default" : "outline"}
          onClick={() => onPick(v)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function Look({ settings, setSetting }: SubProps) {
  return (
    <SettingsSection title="外观" description="配色只换语义色的值，不换名字。">
      <SettingsRow
        label="明暗"
        description="浅色为默认；深色是同一套变量的一层覆盖。"
        control={
          <Seg
            value={settings.theme ?? "light"}
            options={[
              ["light", "白"],
              ["dark", "黑"],
              ["system", "跟随系统"],
            ]}
            onPick={(v) => setSetting("theme", v)}
          />
        }
      />
      <SettingsRow
        label="主题集"
        description="@soda/theme 的四套预置。选一套即定死，不做运行时混搭。"
        control={
          <Seg
            value={settings.set ?? "ink"}
            options={SETS}
            onPick={(v) => setSetting("set", v)}
          />
        }
      />
      <SettingsRow
        label="界面语言"
        description="影响翻译的目标语言。"
        control={
          <Seg
            value={settings.lang ?? "zh-CN"}
            options={[
              ["zh-CN", "简体中文"],
              ["en", "English"],
            ]}
            onPick={(v) => setSetting("lang", v)}
          />
        }
      />
    </SettingsSection>
  );
}

function Net({ settings, setSetting }: SubProps) {
  const [proxy, setProxy] = useState(settings.proxy_url ?? "");
  useEffect(() => setProxy(settings.proxy_url ?? ""), [settings.proxy_url]);
  return (
    <SettingsSection title="网络">
      <SettingsRow
        label="HTTP 代理"
        description={
          <>
            留空＝直连。实测这台机器 <code>api.github.com</code> 可直连，但{" "}
            <code>github.com</code>（设备码端点、部分徽章图）直连会被重置，必须走代理。格式如{" "}
            <code>http://127.0.0.1:7890</code>。
            <b>改完要重启应用才生效</b> —— 连接池在进程启动时建好。
          </>
        }
        control={
          <div className="flex items-center gap-2xs">
            <Input
              value={proxy}
              placeholder="留空即直连"
              className="w-56"
              onChange={(e) => setProxy(e.target.value)}
              onBlur={() => setSetting("proxy_url", proxy.trim())}
            />
            <Button size="xs" variant="outline" onClick={() => setSetting("proxy_url", proxy.trim())}>
              保存
            </Button>
          </div>
        }
      />
    </SettingsSection>
  );
}

function Translate({ settings, setSetting, onChanged }: SubProps & { onChanged: () => void }) {
  const [url, setUrl] = useState(settings.translate_url ?? "");
  useEffect(() => setUrl(settings.translate_url ?? ""), [settings.translate_url]);
  const on = settings.translate_on === "1";
  return (
    <SettingsSection title="翻译">
      <SettingsRow
        label="翻译项目简介"
        description={
          <>
            项目名是专有名词，不翻译，只翻简介。
            <b>开启后简介会发送给第三方翻译服务</b> —— 这是本应用唯一会把内容送出本机的功能，默认关闭。
          </>
        }
        control={
          <Switch
            checked={on}
            onCheckedChange={(v) => {
              setSetting("translate_on", v ? "1" : "0");
              if (v) onChanged();
            }}
          />
        }
      />
      <SettingsRow
        label="翻译端点"
        description={
          <>
            当前用 MyMemory（免密钥、按字符限额）。已翻过的内容会存进本地{" "}
            <code>translation</code> 表，同一段话不会重复请求。
          </>
        }
        control={
          <Input
            value={url}
            className="w-72"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setSetting("translate_url", url.trim())}
          />
        }
      />
    </SettingsSection>
  );
}

function Data({ onNotice, onChanged }: { onNotice: (m: string) => void; onChanged: () => void }) {
  const { stats } = useStore();
  const [busy, setBusy] = useState("");

  return (
    <SettingsSection
      title="数据"
      description="一次完整采集约 60~90 次请求，认证态配额 5000 次/小时，匿名只有 60 次/小时。"
    >
      <SettingsRow
        label="立即采集"
        description="热度榜（7/30/90 天出生）＋对粗排后的候选补测 star 曲线。"
        control={
          <Button
            size="xs"
            disabled={!!busy}
            onClick={() => {
              setBusy("collect");
              void call("run_collect", { pages: 1, curveN: 12 })
                .then(() => {
                  onNotice("采集完成");
                  onChanged();
                })
                .catch((e) => onNotice("采集失败：" + String(e)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "collect" ? "采集中…" : "开始采集"}
          </Button>
        }
      />
      <SettingsRow
        label="取一批新生项目"
        description="探索通道：给推送掺入你还没见过的方向（ε-greedy）。"
        control={
          <Button
            size="xs"
            disabled={!!busy}
            onClick={() => {
              setBusy("explore");
              void call("do_explore", { perLang: 2 })
                .then((m) => {
                  onNotice(String(m));
                  onChanged();
                })
                .catch((e) => onNotice("探索池失败：" + String(e)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "explore" ? "抓取中…" : "取一批"}
          </Button>
        }
      />
      <SettingsRow
        label="重新校准"
        description="按通道/窗口/语言/降权分桶统计命中率；样本不足 20 的桶不生效。"
        control={
          <Button
            size="xs"
            disabled={!!busy}
            onClick={() => {
              setBusy("calib");
              void call<string>("calibrate_now")
                .then((m) => {
                  onNotice(m);
                  onChanged();
                })
                .catch((e) => onNotice("校准失败：" + String(e)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "calib" ? "校准中…" : "重新校准"}
          </Button>
        }
      />
      <SettingsRow
        label="数据库"
        description="全部数据都在这台机器上的这个文件里，没有任何一条离开本机（翻译是唯一例外）。"
        control={<code className="text-caption">{stats?.db ?? "—"}</code>}
      />
    </SettingsSection>
  );
}

function Accounts({
  onNotice,
  onJump,
  onChanged,
}: {
  onNotice: (m: string) => void;
  onJump: (c: string) => void;
  onChanged: () => void;
}) {
  const { settings, setSetting } = useStore();
  const [list, setList] = useState<Account[]>([]);
  const [tok, setTok] = useState("");
  const [busy, setBusy] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const [dev, setDev] = useState<DeviceStart | null>(null);
  const [devState, setDevState] = useState("");
  const poll = useRef<{ code: string; interval: number; deadline: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = () =>
    call<Account[]>("accounts_list")
      .then(setList)
      .catch((e) => log("accounts FAIL " + e));

  useEffect(() => {
    void refresh();
    return () => window.clearTimeout(timer.current);
  }, []);

  const stopPoll = (msg?: string) => {
    window.clearTimeout(timer.current);
    poll.current = null;
    if (msg) setDevState(msg);
  };

  const doPoll = () => {
    const p = poll.current;
    if (!p) return;
    if (Date.now() > p.deadline) {
      stopPoll("代码已过期，重新点开始登录");
      return;
    }
    void call<DevicePoll>("login_poll", {
      clientId: (settings.client_id ?? "").trim(),
      deviceCode: p.code,
    })
      .then((r) => {
        if (r.state === "pending") {
          setDevState("还在等你在浏览器里授权…");
          timer.current = window.setTimeout(doPoll, p.interval * 1000);
          return;
        }
        if (r.state === "slow_down") {
          p.interval += 5;
          timer.current = window.setTimeout(doPoll, p.interval * 1000);
          return;
        }
        if (r.state !== "ok") {
          stopPoll("登录未完成：" + (r.state || r.error || "?"));
          return;
        }
        stopPoll("已登录 @" + r.login);
        log("login ok " + r.login);
        onNotice(`登录成功：@${r.login} —— 现在点「用我自己的口味建画像」`);
        void refresh();
        onChanged();
      })
      .catch((e) => stopPoll("轮询出错：" + String(e)));
  };

  return (
    <SettingsSection
      title="账号"
      description="不登录也能用：走匿名配额（60 次/小时），只是没有你的画像。"
    >
      <div className="flex flex-wrap gap-2xs">
        {list.length === 0 ? (
          <Badge variant="outline">当前没有登录任何账号</Badge>
        ) : (
          list.map((a) => {
            const active = a.login === settings.active_login;
            return (
              <Badge key={a.login} variant={active ? "default" : "outline"}>
                {active ? "●" : "○"} {a.login} · {a.mode === "pat" ? "PAT" : "OAuth"} ·{" "}
                {a.scopes || "scope 未知"}
                {!active ? (
                  <button
                    className="underline"
                    onClick={() =>
                      void call("account_activate", { login: a.login })
                        .then(() => {
                          void refresh();
                          onChanged();
                        })
                        .catch((e) => onNotice("切换失败：" + String(e)))
                    }
                  >
                    切换
                  </button>
                ) : null}
                {list.length > 1 ? (
                  <button
                    className="inline-flex items-center gap-2xs underline"
                    onClick={() =>
                      void call("account_remove", { login: a.login })
                        .then(() => {
                          log("remove " + a.login);
                          void refresh();
                          onChanged();
                        })
                        .catch((e) => onNotice("删除失败：" + String(e)))
                    }
                  >
                    <Trash2Icon />
                    删除
                  </button>
                ) : null}
              </Badge>
            );
          })
        )}
      </div>

      <Separator />

      <SettingsRow
        label={
          <span className="flex items-center gap-2xs">
            <KeyRoundIcon /> ① 粘贴 token 登录（推荐，约 30 秒）
          </span>
        }
        description={
          <>
            到 <code>github.com/settings/tokens</code> 建一个 classic token，只勾{" "}
            <code>read:user</code> 和 <code>public_repo</code>（不要勾 repo，就不碰你的私有代码），
            复制粘贴进来。配额立刻从匿名 60 次/小时变成 5000 次/小时。
          </>
        }
        control={
          <div className="flex items-center gap-2xs">
            <Input
              type="password"
              value={tok}
              placeholder="ghp_…"
              className="w-52"
              onChange={(e) => setTok(e.target.value)}
            />
            <Button
              size="xs"
              disabled={!!busy}
              onClick={() => {
                const val = tok.trim();
                setBusy("tok");
                if (!val) {
                  void call("set_token_cmd", { token: "" })
                    .then(() => {
                      onNotice("输入框已清空。要真正移除凭据，请在上方账号列表里点「删除」。");
                      void refresh();
                    })
                    .finally(() => setBusy(""));
                  return;
                }
                void call<{
                  login?: string;
                  quota_limit?: number;
                  quota_remaining?: number;
                  error?: string;
                }>("add_pat", { token: val })
                  .then((r) => {
                    if (r.error) {
                      onNotice("token 验证失败：" + r.error + "（界面仍可用匿名额度）");
                      return;
                    }
                    setTok("");
                    log("pat ok login=" + r.login);
                    onNotice(
                      `已验证 @${r.login}，配额 ${r.quota_limit ?? "?"} 次/小时（剩余 ${
                        r.quota_remaining ?? "?"
                      }）`
                    );
                    void refresh();
                    onChanged();
                  })
                  .catch((e) => onNotice("保存失败：" + String(e)))
                  .finally(() => setBusy(""));
              }}
            >
              {busy === "tok" ? "验证中…" : "保存并验证"}
            </Button>
          </div>
        }
      />

      <SettingsRow
        label={
          <span className="flex items-center gap-2xs">
            <LogInIcon /> ② 设备码登录
          </span>
        }
        description="只在要发布给别人用时才需要（先注册 OAuth App 并打开 Device Flow）。不需要回调地址、不把密钥打进应用里。"
        control={<Button size="xs" variant="outline" onClick={() => setDevOpen((v) => !v)}>
          {devOpen ? "收起" : "展开"}
        </Button>}
      />
      {devOpen ? (
        <div className="flex flex-col gap-sm rounded-lg border p-md">
          <SettingsRow
            label="OAuth App client_id"
            description="填一次即可，存本机设置表。"
            control={
              <Input
                defaultValue={settings.client_id ?? ""}
                placeholder="Iv1.xxxx 或 40 位十六进制"
                className="w-72"
                onBlur={(e) => setSetting("client_id", e.target.value.trim())}
              />
            }
          />
          <div className="flex flex-wrap items-center gap-xs">
            <Button
              size="xs"
              disabled={!!poll.current}
              onClick={() => {
                const cid = (settings.client_id ?? "").trim();
                if (!cid) {
                  setDevState("先填 client_id");
                  return;
                }
                void call<DeviceStart>("login_start", {
                  clientId: cid,
                  scopes: settings.scopes || "read:user public_repo",
                })
                  .then((v) => {
                    setDev(v);
                    setDevState("等待授权…");
                    poll.current = {
                      code: v.device_code,
                      interval: v.interval || 5,
                      deadline: Date.now() + (v.expires_in || 900) * 1000,
                    };
                    log("device_start ok interval=" + poll.current.interval);
                    doPoll();
                  })
                  .catch((e) => setDevState("失败：" + String(e)));
              }}
            >
              开始登录
            </Button>
            {poll.current ? (
              <Button size="xs" variant="ghost" onClick={() => stopPoll("已取消")}>
                取消
              </Button>
            ) : null}
            <span className="text-caption text-muted-foreground">{devState}</span>
          </div>
          {dev ? (
            <div className="flex flex-col gap-2xs text-body">
              <span>
                在浏览器里打开{" "}
                <a
                  className="text-primary underline"
                  href={dev.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dev.verification_uri}
                </a>
                ，输入这个一次性代码：
              </span>
              <span className="font-mono text-title tracking-widest">{dev.user_code}</span>
              <button
                className="w-fit text-caption underline"
                onClick={() => navigator.clipboard.writeText(dev.user_code).catch(() => {})}
              >
                复制代码
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Separator />

      <SettingsRow
        label="用我自己的口味建画像"
        description="读你的收藏和你自己的仓库，算出兴趣词表，再按词表去抓取，并对粗排后的候选补测增速曲线。约 1 分钟。"
        control={
          <Button
            size="xs"
            disabled={!!busy}
            onClick={() => {
              setBusy("mine");
              void call<string>("build_my_profile", { pages: 5 })
                .then((m) => {
                  onNotice("画像已按你自己的账号重建");
                  log("mine ok");
                  onJump("profile");
                })
                .catch((e) => onNotice("建画像失败：" + String(e)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "mine" ? "建画像中…" : "建我的画像"}
          </Button>
        }
      />
      <p className="text-caption text-muted-foreground">
        {list.length ? `当前生效：@${settings.active_login || "未选"}` : "匿名态：所有请求不带 token"}
      </p>
    </SettingsSection>
  );
}
