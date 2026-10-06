import { invoke } from "@tauri-apps/api/core";

// 所有取数、记账、排序都在 Rust 侧（技术手册 D2：WebView 只是显示层，不算账）。
// 这里只做一件事：把命令出入参写成类型，字段名与 feed.rs 的 json! 键一一对应。

export type Card = {
  id: number;
  full_name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  url: string;
  stars: number;
  forks: number;
  open_issues: number;
  subscribers: number;
  window: string;
  age_days: number;
  slope: number | null;
  curvature: number | null;
  score: number;
  spam: boolean;
  channel: string;
  lang_hit: boolean;
  saved: boolean;
  seen: boolean;
  weeks: number[];
  why: string[];
};

export type Detail = {
  id?: number;
  full_name?: string;
  description?: string | null;
  url?: string;
  stars?: number;
  forks?: number;
  open_issues?: number;
  subscribers?: number;
  language?: string | null;
  slope?: number | null;
  curvature?: number | null;
  window?: string;
  age_days?: number;
  weeks?: number[];
  saved?: boolean;
  readme_html?: string;
  releases?: string;
  langs?: string[];
  error?: string;
};

export type Stats = {
  pool: number;
  ranked: number;
  impressions: number;
  reach: number;
  sessions: number;
  opens: number;
  hides: number;
  saved: number;
  login: string | null;
  db: string;
};

export type Counts = {
  all: number;
  hot: number;
  profile: number;
  explore: number;
  saved: number;
  last_collect: number;
};

export type Account = {
  login: string;
  user_id: number | null;
  mode: string;
  scopes: string | null;
  added_at: number;
  token_len: number;
};

export type Settings = {
  theme?: string;
  set?: string;
  lang?: string;
  translate_on?: string;
  translate_url?: string;
  proxy_url?: string;
  client_id?: string;
  scopes?: string;
  active_login?: string;
  [k: string]: string | undefined;
};

export type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
};

export type DevicePoll = {
  state: string;
  login?: string;
  error?: string;
  hint?: string;
};

/** Rust 侧 auth_status 的返回：/rate_limit 不计配额，所以这个可以常刷 */
export type Pool = { limit: number; remaining: number; resets_at: number };
export type AuthStatus = {
  authed: boolean;
  invalid?: boolean;
  login: string;
  mode: string;
  scopes: string;
  missing_scope?: string[];
  core?: Pool;
  search?: Pool;
  graphql?: Pool;
  accounts: number;
  cred_file?: string;
  error?: string;
  hint?: string;
};

/** "我的"这一页：全部本机数据，由 me_report 一次读回 */
export type MeReport = {
  login: string;
  terms: { term: string; weight: number }[];
  langs: { language: string; weight: number }[];
  min_n: number;
  profile_hits: number;
  starred_snapshot: number;
  saved: number;
  hides: number;
  kinds: [string, number][];
  hide_reasons: [string, number][];
  buckets: {
    feat: string;
    bucket: string;
    n: number;
    n_pos: number;
    w: number;
    live: boolean;
    ctr: number;
  }[];
  fitted_at: number;
};

/** GitHub 侧的"我"：由 my_profile 现取，15 分钟缓存 */
export type Repo = {
  name: string;
  full_name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
  issues: number;
  fork: boolean;
  archived: boolean;
  pushed_at: string;
};
export type GhProfile = {
  login: string;
  name: string | null;
  bio: string | null;
  avatar: string | null;
  location: string | null;
  company: string | null;
  blog: string | null;
  followers: number | null;
  following: number | null;
  public_repos: number | null;
  created_at: string | null;
  url: string | null;
  popular: Repo[];
  recent: Repo[];
  repo_count: number;
  activity: { date: string; count: number }[];
  event_count: number;
  fetched_at: number;
};

/**
 * 仓库视图的三条出入口。字段名与 feed.rs 里 repo_tree / repo_file_read / repo_list
 * 的 json! 键一一对应 —— 对不上就是 undefined，界面上表现为"空"，最难查。
 */
export type TreeEntry = { path: string; dir: boolean; size: number };
export type TreeResult = {
  branch: string;
  entries: TreeEntry[];
  count: number;
  truncated: boolean;
  error?: string;
};
export type FileResult = {
  path: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
  text: string;
  error?: string;
};
export type ListItem = {
  number: number;
  title: string;
  author: string;
  created_at: string;
  comments: number;
  draft: boolean;
  labels: string[];
};
export type ListResult = { kind: string; items: ListItem[]; count: number; error?: string };

/** 三条都按 repo.id 取；路径是仓库内的相对路径，原样交给 Rust 做百分号编码 */
export function repoTree(id: number): Promise<TreeResult> {
  return call<TreeResult>("repo_tree", { repoId: id });
}
export function repoFile(id: number, path: string): Promise<FileResult> {
  return call<FileResult>("repo_file_read", { repoId: id, path });
}
export function repoList(id: number, kind: "issue" | "pull"): Promise<ListResult> {
  return call<ListResult>("repo_list", { repoId: id, kind });
}

/** 一次进程生命周期 = 一个 session：曝光去重按 (repo_id, session) 唯一 */export const SESSION =
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);

export const LIMIT = 40;

/** 磁盘日志：界面关掉以后还能复盘，判成败看这里而不是看退出码 */
export function log(msg: string) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(msg);
  invoke("js_log", { msg: `${stamp} ${msg}` }).catch(() => {});
}

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args ?? {});
  } catch (e) {
    log(`FAIL ${cmd} ${String(e)}`);
    throw e;
  }
}

/**
 * 用系统默认浏览器打开。必须走 Rust：Tauri 2 默认吞掉 window.open 与 target=_blank，
 * 点了没反应也不报错。Rust 侧只放行 github.com 的 https 地址。
 */
export function openExternal(url: string): Promise<string> {
  return call<string>("open_url", { url });
}

export function ago(ts: number | undefined): string {
  if (!ts) return "从未";
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}

export function n(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toLocaleString();
}

export function relTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  return ago(Math.floor(d / 1000));
}
