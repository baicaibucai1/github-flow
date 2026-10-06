import { useSyncExternalStore } from "react";
import {
  call,
  log,
  type AuthStatus,
  type Counts,
  type Settings,
  type Stats,
} from "./bridge";

/**
 * 界面级共享状态：设置（含主题）、通道、认证态、计数。
 * 取数一律在 Rust 侧，这里只持有渲染需要的快照。
 */
export type Snapshot = {
  ready: boolean;
  settings: Settings;
  theme: "light" | "dark";
  counts: Counts | null;
  stats: Stats | null;
  auth: AuthStatus | null;
  /** 认证态且有本地 token 才算"他自己的账号"：借来的公开账号只有 login 没有凭据 */
  account: string;
  /** 原文 → 译文。批量翻译回来才更新，卡片自己不发请求 */
  translated: Map<string, string>;
};

const DEFAULTS: Settings = {
  theme: "light",
  set: "ink",
  lang: "zh-CN",
  translate_on: "0",
  translate_url: "",
  proxy_url: "",
  client_id: "",
  scopes: "read:user public_repo",
  active_login: "",
};

export const CHANNELS: [string, string][] = [
  ["hot", "热度"],
  ["profile", "画像"],
  ["explore", "探索"],
  ["saved", "收藏"],
];

let snap: Snapshot = {
  ready: false,
  settings: { ...DEFAULTS },
  theme: "light",
  counts: null,
  stats: null,
  auth: null,
  account: "",
  translated: new Map(),
};
let feedNonce = 0;
const listeners = new Set<() => void>();

function emitChange() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function assign(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch };
  emitChange();
}

export function useApp(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => snap
  );
}

/** 整份重读（设置 / 计数 / 统计 / 认证）。数据流是唯一的一条：改完任何东西都走这里。 */
export async function reloadAll() {
  await Promise.all([refreshSettings(), refreshCounts(), refreshStats(), refreshAuth()]);
}

function refreshSettings() {
  return call<Settings>("settings_json")
    .then((s) => applySettings(s))
    .catch((e) => log("settings FAIL " + e));
}

export function refreshCounts() {
  return call<Counts>("get_counts")
    .then((counts) => assign({ counts }))
    .catch((e) => log("counts FAIL " + e));
}

export function refreshStats() {
  return call<Stats>("get_stats")
    .then((stats) => assign({ stats }))
    .catch(() => assign({ stats: null }));
}

/**
 * 认证态。`/rate_limit` 不计配额，所以可以随便刷；但**绝不每秒刷**——
 * 那是往第三方端点上堆无意义请求。只在真需要判断的时刻问一次：
 * 启动、登录类写操作之后、窗口重新获得焦点、配额窗口翻篇之后。
 */
export function refreshAuth(): Promise<void> {
  return call<AuthStatus>("auth_status")
    .then((auth) => {
      const account = auth.accounts === 1 || (auth.authed && auth.login) ? auth.login : "";
      assign({ auth, account });
      scheduleAuth(auth);
    })
    .catch((e) => {
      log("auth FAIL " + e);
      // 读不到就当未知：不拿这个状态去拦"采集"，避免把一次网络抖动变成"请你先登录"
      assign({ auth: null, account: snap.settings.active_login ?? "" });
    });
}

let authTimer = 0;

/** 配额窗口翻篇后重查一次，顺带让长期闲置时的"未登录"提示保持真话。一次性，不轮询。 */
function scheduleAuth(auth: AuthStatus) {
  window.clearTimeout(authTimer);
  if (!auth.authed) return;
  const reset = auth.core?.resets_at;
  if (!reset) return;
  const delay = Math.min(600_000, Math.max(15_000, reset * 1000 - Date.now() + 5_000));
  authTimer = window.setTimeout(() => void refreshAuth(), delay);
}

/** 只改界面状态。要落库的用 persist() */
function setSetting(key: string, value: string) {
  const settings = { ...snap.settings, [key]: value };
  assign({ settings });
  applyTheme(settings);
  if (key === "translate_on" && value === "1") bumpFeed();
}

function applySettings(s: Settings) {
  const settings = { ...DEFAULTS, ...s };
  assign({ settings });
  applyTheme(settings);
}

function resolveTheme(s: Settings): "light" | "dark" {
  if (s.theme === "system") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return s.theme === "dark" ? "dark" : "light";
}

function applyTheme(s: Settings) {
  const root = document.documentElement;
  const theme = resolveTheme(s);
  root.dataset.set = s.set || "ink";
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  if (snap.theme !== theme) assign({ theme });
}

export function initStore() {
  applyTheme(snap.settings);
  void reloadAll().then(() => assign({ ready: true }));
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => applyTheme(snap.settings);
  mq.addEventListener("change", onScheme);
  // 从别的窗口切回来时重查认证态：这是"需要判断的时刻"，不是定时器
  const onFocus = () => void refreshAuth();
  window.addEventListener("focus", onFocus);
  return () => {
    mq.removeEventListener("change", onScheme);
    window.removeEventListener("focus", onFocus);
    window.clearTimeout(authTimer);
  };
}

/** 让信息流整份重读（开启翻译、采集完、登录完都用它） */
export function bumpFeed() {
  feedNonce += 1;
  emitChange();
}

export function useFeedNonce() {
  return useSyncExternalStore(
    subscribe,
    () => feedNonce,
    () => feedNonce
  );
}

/**
 * 通道是"发现"页内部的浏览维度（热度 / 画像 / 探索 / 全部）。
 * 它和"这个库属于谁"是两条正交的轴：收藏列表按 saved 过滤、跟通道无关，
 * 所以切登录账号不该把通道重置掉——那会让人以为对方的收藏把自己的覆盖了。
 */
let channel = "hot";

export function useChannel() {
  return useSyncExternalStore(
    subscribe,
    () => channel,
    () => channel
  );
}

export function setChannel(c: string) {
  if (channel === c) return;
  channel = c;
  emitChange();
}

/** 显式落一条设置（输入框失焦、选择器确定时用） */
export function persist(key: string, value: string) {
  setSetting(key, value);
  void call("set_setting_cmd", { key, value }).catch((e) => log(`set FAIL ${key} ${e}`));
}

// ---------------------------------------------------------------- 翻译
// 只翻简介，且按"当前屏幕上出现的那些"批量走：一次最多 8 段，
// 已翻过的进本地 translation 表（Rust 侧），会话内再缓存一层，避免同一段话翻两次。
const TR_BATCH = 8;
const queue = new Set<string>();
let trTimer = 0;

function flushTranslate() {
  const todo = [...queue].filter((t) => t.length > 3).slice(0, TR_BATCH);
  for (const t of todo) queue.delete(t);
  if (!todo.length) return;
  void call<{ map: Record<string, string>; net: number; cached: number }>("do_translate", {
    texts: todo,
  })
    .then((r) => {
      log(`translate net=${r.net} cached=${r.cached}`);
      const next = new Map(snap.translated);
      for (const [k, v] of Object.entries(r.map)) if (v && v !== k) next.set(k, v);
      assign({ translated: next });
    })
    .catch((e) => log("translate FAIL " + e));
}

export function requestTranslate(texts: string[]) {
  if (snap.settings.translate_on !== "1") return;
  let queued = false;
  for (const t of texts) {
    if (!t || t.length <= 3 || snap.translated.has(t) || queue.has(t)) continue;
    queue.add(t);
    queued = true;
  }
  if (!queued) return;
  window.clearTimeout(trTimer);
  trTimer = window.setTimeout(flushTranslate, 250);
}

// ---------------------------------------------------------------- 调试位
let dbg = false;

export function useDbg() {
  return useSyncExternalStore(
    subscribe,
    () => dbg,
    () => dbg
  );
}

export function setDbg(v: boolean) {
  dbg = v;
  emitChange();
}

let noticeSink: ((m: string) => void) | null = null;

export function setNoticeSink(fn: ((m: string) => void) | null) {
  noticeSink = fn;
}

/** 一次性反馈走 toast；需要保留的判断走界面自己的灰字，别塞同一个队列 */
export function notice(msg: string) {
  log("notice " + msg);
  if (noticeSink) noticeSink(msg);
}
