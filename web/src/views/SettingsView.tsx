import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { bumpFeed, notice, persist, reloadAll, useApp } from "../lib/store";

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
  tab: string;
  onTab: (t: string) => void;
  onJump: (channel: string) => void;
};

export function SettingsView({ tab, onTab, onJump }: SettingsViewProps) {
  return (
    <div className="p-md">
      <SettingsPage
        nav={SECTIONS}
        value={tab}
        onValueChange={onTab}
        header={{
          title: "设置",
          description:
            "全部存本机：设置与行为在 SQLite，凭据单独存 accounts.json、不进数据库。改完不需要重启，除了代理。",
        }}
      >
        {tab === "look" ? <Look /> : null}
        {tab === "acct" ? <Accounts onJump={onJump} /> : null}
        {tab === "net" ? <Net /> : null}
        {tab === "tr" ? <Translate /> : null}
        {tab === "data" ? <Data /> : null}
      </SettingsPage>
    </div>
  );
}

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

function Look() {
  const { settings } = useApp();
  return (
    <SettingsSection title="外观" description="配色只换语义色的值，不换名字（@soda/theme）。">
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
            onPick={(v) => persist("theme", v)}
          />
        }
      />
      <SettingsRow
        label="主题集"
        description="四套预置选一整套，不做运行时混搭。"
        control={
          <Seg
            value={settings.set ?? "ink"}
            options={SETS}
            onPick={(v) => persist("set", v)}
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
            onPick={(v) => persist("lang", v)}
          />
        }
      />
    </SettingsSection>
  );
}

function TextRow({
  label,
  description,
  keyName,
  placeholder,
  password,
}: {
  label: React.ReactNode;
  description: React.ReactNode;
  keyName: string;
  placeholder?: string;
  password?: boolean;
}) {
  const { settings } = useApp();
  const [v, setV] = useState(settings[keyName] ?? "");
  // 设置从 Rust 读回来后要把输入框对齐，否则用户看到的是上一次的空值
  useEffect(() => setV(settings[keyName] ?? ""), [settings, keyName]);
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <div className="flex items-center gap-2xs">
          <Input
            type={password ? "password" : "text"}
            value={v}
            placeholder={placeholder}
            className="w-64"
            onChange={(e) => setV(e.target.value)}
            onBlur={() => {
              if (v !== (settings[keyName] ?? "")) persist(keyName, v.trim());
            }}
          />
          <Button size="xs" variant="outline" onClick={() => persist(keyName, v.trim())}>
            保存
          </Button>
        </div>
      }
    />
  );
}

function Net() {
  return (
    <SettingsSection title="网络">
      <TextRow
        label="HTTP 代理"
        description={
          <>
            留空＝直连。这台机器上 <code>api.github.com</code> 实测可直连；{" "}
            <code>github.com</code>（设备码端点、部分徽章图）有时会被重置，那时才需要代理。格式如{" "}
            <code>http://127.0.0.1:7890</code>。
            <b>改完要重启应用才生效</b> —— 连接池在进程启动时建好。
            <br />
            注意：代理没开着时这里填着地址，会让所有联网功能静默失败（界面还是照常显示本地数据）。
          </>
        }
        keyName="proxy_url"
        placeholder="留空即直连"
      />
    </SettingsSection>
  );
}

function Translate() {
  const { settings } = useApp();
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
            checked={settings.translate_on === "1"}
            onCheckedChange={(v) => {
              persist("translate_on", v ? "1" : "0");
              if (v) bumpFeed();
            }}
          />
        }
      />
      <TextRow
        label="翻译端点"
        description={
          <>
            当前用 MyMemory（免密钥、按字符限额）。已翻过的内容存进本地 <code>translation</code>{" "}
            表，同一段话不会重复请求。
          </>
        }
        keyName="translate_url"
      />
    </SettingsSection>
  );
}

function Data() {
  const { stats, auth } = useApp();
  const [busy, setBusy] = useState("");

  const run = (label: string, p: Promise<unknown>, done: string) => {
    setBusy(label);
    void p
      .then(() => reloadAll().then(bumpFeed))
      .then(() => notice(done))
      .catch((e) => notice(`${label}失败：` + String(e)))
      .finally(() => setBusy(""));
  };

  return (
    <SettingsSection
      title="数据"
      description="一次完整采集约 60~90 次请求。认证态配额 5000 次/小时，匿名 60 次/小时。"
    >
      <SettingsRow
        label="立即采集"
        description="热度榜（7/30/90 天出生）＋对粗排后的候选补测 star 曲线。"
        control={
          <Button
            size="xs"
            disabled={!!busy}
            onClick={() =>
              run("采集", Promise.all([call("run_collect", { pages: 1, curveN: 12 }), call("do_explore", { perLang: 2 })]), "采集完成，榜已更新")
            }
          >
            {busy === "采集" ? "采集中…" : "开始采集"}
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
            onClick={() => run("校准", call<string>("calibrate_now"), "已重新校准")}
          >
            {busy === "校准" ? "校准中…" : "重新校准"}
          </Button>
        }
      />
      <SettingsRow
        label="数据库"
        description="全部数据都在这台机器上，没有任何一条离开本机（翻译是唯一例外）。"
        control={
          <div className="flex flex-col items-end gap-2xs">
            <code className="text-caption">{stats?.db ?? "—"}</code>
            <Button size="xs" variant="ghost" onClick={() => reloadAll().then(bumpFeed)}>
              重新读取
            </Button>
          </div>
        }
      />
      <p className="text-caption text-muted-foreground">
        凭据文件：{auth?.cred_file ?? "accounts.json（本机）"}
      </p>
    </SettingsSection>
  );
}

function Accounts({ onJump }: { onJump: (c: string) => void }) {
  const { settings, auth } = useApp();
  const [list, setList] = useState<Account[]>([]);
  const [tok, setTok] = useState("");
  const [busy, setBusy] = useState("");
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
        void refresh();
        void reloadAll();
        notice(`登录成功：@${r.login} —— 现在点「用我自己的口味建画像」`);
      })
      .catch((e) => stopPoll("轮询出错：" + String(e)));
  };

  const invalid = !!auth?.invalid;
  const missing = auth?.missing_scope ?? [];

  return (
    <SettingsSection
      title="账号"
      description="不登录也能用：走匿名配额，只是没有你的画像。登录只为本机记账，不上传任何东西。"
    >
      {auth && auth.authed ? (
        <Alert variant={invalid || missing.length ? "destructive" : "default"}>
          <AlertTitle>
            已登录 @{auth.login}（{auth.mode === "pat" ? "粘贴的 token" : "设备码"}）
          </AlertTitle>
          <AlertDescription>
            配额 core {auth.core?.remaining ?? "?"}/{auth.core?.limit ?? "?"} · search{" "}
            {auth.search?.remaining ?? "?"}/{auth.search?.limit ?? "?"} · GraphQL{" "}
            {auth.graphql?.remaining ?? "?"}
            <br />
            scope：{auth.scopes || "GitHub 没回报（fine-grained token 不返回 scope）"}
            {missing.length ? ` —— 缺 ${missing.join("、")}，画像可能抓不全` : ""}
            {invalid ? " —— 这个凭据已被撤销或过期，删掉重新登录" : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTitle>本机没有凭据，现在是匿名态</AlertTitle>
          <AlertDescription>
            配额 core {auth?.core?.remaining ?? "?"}/{auth?.core?.limit ?? "60"} 次/小时 · search{" "}
            {auth?.search?.remaining ?? "?"}。
            热度与探索照常跑，「画像」通道需要读你自己的收藏，所以是空的。
            {auth?.error ? ` （读配额失败：${auth.error}）` : ""}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2xs">
        {list.length === 0 ? (
          <Badge variant="outline">账号列表是空的</Badge>
        ) : (
          list.map((a) => {
            const active = a.login === settings.active_login || list.length === 1;
            return (
              <Badge key={a.login} variant={active ? "default" : "outline"}>
                {active ? "●" : "○"} {a.login} · {a.mode === "pat" ? "PAT" : "OAuth"} ·{" "}
                {a.scopes || "scope 未知"}
                {!active ? (
                  <button
                    className="underline"
                    onClick={() =>
                      void call("account_activate", { login: a.login })
                        .then(reloadAll)
                        .then(refresh)
                        .catch((e) => notice("切换失败：" + String(e)))
                    }
                  >
                    切换
                  </button>
                ) : null}
                <button
                  className="inline-flex items-center gap-2xs underline"
                  title="从本机移除这个凭据"
                  onClick={() =>
                    void call("account_remove", { login: a.login })
                      .then(() => {
                        log("remove " + a.login);
                        notice(`已移除 @${a.login} 的凭据`);
                        return Promise.all([refresh(), reloadAll()]);
                      })
                      .catch((e) => notice("删除失败：" + String(e)))
                  }
                >
                  <Trash2Icon />
                  删除
                </button>
              </Badge>
            );
          })
        )}
      </div>

      <Separator />

      <SettingsRow
        label={
          <span className="flex items-center gap-2xs">
            <KeyRoundIcon /> ① 粘贴 token 登录（约 30 秒）
          </span>
        }
        description={
          <>
            到 <code>github.com/settings/tokens</code> 建一个 classic token，只勾{" "}
            <code>read:user</code> 和 <code>public_repo</code>（不要勾 repo，就不碰你的私有代码），
            粘贴进来。验证通过后 token 只写进本机 accounts.json，<b>不进数据库、不会出现在界面上</b>。
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
                if (!val) {
                  notice("先粘贴 token。要移除已存的凭据，请在上方点「删除」。");
                  return;
                }
                setBusy("tok");
                void call<{
                  login?: string;
                  scopes?: string;
                  missing_scope?: string[];
                  quota_limit?: number;
                  quota_remaining?: number;
                  error?: string;
                }>("add_pat", { token: val })
                  .then(async (r) => {
                    if (r.error) {
                      notice("token 验证失败：" + r.error + "（界面仍可用匿名额度）");
                      return;
                    }
                    setTok("");
                    log("pat ok login=" + r.login);
                    notice(
                      `已验证 @${r.login}：配额 ${r.quota_remaining ?? "?"}/${
                        r.quota_limit ?? "?"
                      } 次/小时${
                        r.missing_scope?.length
                          ? ` —— 但缺 ${r.missing_scope.join("、")}，回 GitHub 重新勾上`
                          : ""
                      }`
                    );
                    await Promise.all([refresh(), reloadAll()]);
                  })
                  .catch((e) => notice("保存失败：" + String(e)))
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
        description={
          <>
            要先发一个 OAuth App：<code>github.com/settings/developers</code> → New OAuth App →
            建好后在页面底部勾上 <b>Allow device flow</b>（默认关），把 Client ID 填到下面。
            不需要回调地址，也不把密钥打进应用里。
          </>
        }
        control={
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              if (dev) {
                setDev(null);
                stopPoll("已收起");
              } else setDevState(devState);
            }}
          >
            {dev ? "收起" : "用设备码登录"}
          </Button>
        }
      />
      {dev || devState ? (
        <div className="flex flex-col gap-sm rounded-lg border p-md">
          <TextRow
            label="OAuth App client_id"
            description="填一次即可，存本机设置表。"
            keyName="client_id"
            placeholder="Iv1.xxxx 或 40 位十六进制"
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
              申请一次性代码
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
                  href={dev.verification_uri_complete || dev.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                >
                  {dev.verification_uri}
                </a>
                ，输入这个一次性代码（{Math.round((dev.expires_in || 900) / 60)} 分钟内有效）：
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
                  log("mine ok");
                  notice("画像已按你自己的账号重建");
                  return reloadAll().then(bumpFeed);
                })
                .then(() => onJump("profile"))
                .catch((e) => notice("建画像失败：" + String(e)))
                .finally(() => setBusy(""));
            }}
          >
            {busy === "mine" ? "建画像中…" : "建我的画像"}
          </Button>
        }
      />
      <p className="text-caption text-muted-foreground">
        {auth?.authed
          ? `当前生效：@${auth.login}（${auth.mode}）`
          : "匿名态：所有请求不带 token，也不会读你的私有数据"}
      </p>
    </SettingsSection>
  );
}
