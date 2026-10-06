// 推送子系统的 Rust 侧实现：HTTP、配额记账、落库、斜率、规则、排序。
// CLI（src/bin/collect.rs）与 Tauri command（src/main.rs）共用这一份，
// 保证"取数与打分只有一个出入口"（手册 2.1）。

use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const UA: &str = "gh-feed-prototype/0.1";
const API: &str = "https://api.github.com";

macro_rules! G { ($u:expr) => { agent().get($u) } }
macro_rules! P { ($u:expr) => { agent().post($u) } }

// agent() 的定义在文件后段；宏是文本展开，调用时才解析，所以可以放在后面

// ---------------------------------------------------------------- 时间
fn ymd(days_since_epoch: i64) -> String {
  let z = days_since_epoch + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let doe = z - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_095) / 365;
  let y = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = doy - (153 * mp + 2) / 5 + 1;
  let m = if mp < 10 { mp + 3 } else { mp - 9 };
  let y = if m <= 2 { y + 1 } else { y };
  format!("{:04}-{:02}-{:02}", y, m, d)
}

fn now_s() -> i64 {
  SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64
}

/// ISO 日期串 -> epoch 天。只需日粒度。
fn date_to_epoch_day(s: &str) -> i64 {
  let p: Vec<&str> = s.split('-').collect();
  if p.len() < 3 {
    return 0;
  }
  let (y, m, d) = (
    p[0].parse::<i64>().unwrap_or(1970),
    p[1].parse::<i64>().unwrap_or(1),
    p[2].parse::<i64>().unwrap_or(1),
  );
  let era = if m <= 2 { y - 1 } else { y };
  let yoe = era - if era < 0 { (era - 399) / 400 } else { era / 400 } * 400;
  let doy = if m > 2 { (153 * (m - 3) + 2) / 5 + d - 1 } else { (153 * (m + 9) + 2) / 5 + d - 1 };
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  era / 400 * 146_097 + doe - 719_468
}

fn iso_from_created(s: &str) -> i64 {
  date_to_epoch_day(&s[..10.min(s.len())]) * 86_400
}

// ---------------------------------------------------------------- JSON 形状
#[derive(Deserialize)]
struct Bucket {
  week: i64,
  total: i64,
  days: Vec<i64>,
}

#[derive(Deserialize, serde::Serialize)]
struct RepoJson {
  id: i64,
  full_name: String,
  description: Option<String>,
  html_url: String,
  stargazers_count: i64,
  forks_count: i64,
  open_issues_count: i64,
  language: Option<String>,
  topics: Option<Vec<String>>,
  created_at: String,
  pushed_at: Option<String>,
  archived: Option<bool>,
  size: Option<i64>,
  homepage: Option<String>,
  subscribers_count: Option<i64>,
}

#[derive(Deserialize)]
struct SearchJson {
  total_count: i64,
  items: Vec<RepoJson>,
}

#[derive(Serialize, Clone)]
pub struct Card {
  pub id: i64,
  pub full_name: String,
  pub description: Option<String>,
  pub language: Option<String>,
  pub topics: Vec<String>,
  pub url: String,
  pub stars: i64,
  pub forks: i64,
  pub open_issues: i64,
  pub subscribers: i64,
  pub window: String,
  pub age_days: i64,
  pub slope: Option<f64>,
  pub curvature: Option<f64>,
  pub score: f64,
  pub spam: bool,
  pub channel: String,
  pub lang_hit: bool,
  pub saved: bool,
  pub seen: bool,
  pub weeks: Vec<i64>,
  pub why: Vec<String>,
}

// ---------------------------------------------------------------- 配额记账
// 进程级请求计数：给补货器算"这一步到底发了多少次请求"用。
// 为什么不用 /rate_limit 前后相减——实测那个端点是缓存值（同一个 60 秒窗口里读两次，
// 第二次仍报 search=30，而这一轮已经跑掉 14 次），拿它做差会算出 0，等于预算没在管。
// get_json_as 是唯一的出口，所以在这里计数最省事也最准。
static HTTP_CORE_CALLS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
static HTTP_SEARCH_CALLS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn http_calls() -> (i64, i64) {
  (
    HTTP_CORE_CALLS.load(std::sync::atomic::Ordering::Relaxed),
    HTTP_SEARCH_CALLS.load(std::sync::atomic::Ordering::Relaxed),
  )
}

struct Http {
  core_left: i64,
  search_left: i64,
  tok: Option<String>,
}

impl Http {
  fn probe(&mut self, emit: &mut dyn FnMut(String)) {
    let mut preq = G!(&format!("{API}/rate_limit")).header("User-Agent", UA)
      .header("Accept", "application/vnd.github+json");
    if let Some(t) = &self.tok { preq = preq.header("Authorization", format!("Bearer {t}")); }
    let v: serde_json::Value = match preq.call()
    {
      Ok(mut r) => r.body_mut().read_json().unwrap_or(serde_json::Value::Null),
      Err(e) => {
        emit(format!("[quota] 读不到配额: {e}"));
        return;
      }
    };
    let g = |k: &str| v["resources"][k]["remaining"].as_i64().unwrap_or(-1);
    self.core_left = g("core");
    self.search_left = g("search");
    emit(format!("[quota] 起始 remaining: core={} search={}", self.core_left, self.search_left));
  }

  /// 与 get_json 同一套配额记账，只是 Accept 可换：issue / PR 的正文要靠
  /// `application/vnd.github.html+json` 才返回**官方渲染好的 HTML**（body_html），
  /// 这样应用内不用引 markdown 库，也不用抓页面（跟 README 那条路一致）。
  fn get_json_as<T: serde::de::DeserializeOwned>(
    &mut self,
    path: &str,
    q: &BTreeMap<&str, String>,
    kind: &str,
    accept: &str,
    emit: &mut dyn FnMut(String),
  ) -> Option<T> {
    let budget = if kind == "search" { self.search_left } else { self.core_left };
    if budget < 4 {
      emit(format!("[quota] {kind} 剩余 {budget} < 4，跳过 {path}"));
      return None;
    }
    let mut req = G!(&format!("{API}{path}"))
      .header("User-Agent", UA)
      .header("Accept", accept);
    // 有 token 就带上：额度从匿名 60/h 变 5000/h，并解锁 /user/starred 这类只认登录态的入口
    if let Some(t) = &self.tok {
      req = req.header("Authorization", format!("Bearer {t}"));
    }
    for (k, val) in q {
      req = req.query(k, val);
    }
    match req.call() {
      Ok(mut r) => {
        if kind == "search" {
          self.search_left -= 1;
          HTTP_SEARCH_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        } else {
          self.core_left -= 1;
          HTTP_CORE_CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        match r.body_mut().read_json::<T>() {
          Ok(v) => Some(v),
          Err(e) => {
            emit(format!("[http] {path} 解析失败: {e}"));
            None
          }
        }
      }
      Err(e) => {
        emit(format!("[http] {path} 失败: {e}"));
        None
      }
    }
  }

  fn get_json<T: serde::de::DeserializeOwned>(
    &mut self,
    path: &str,
    q: &BTreeMap<&str, String>,
    kind: &str,
    emit: &mut dyn FnMut(String),
  ) -> Option<T> {
    self.get_json_as(path, q, kind, "application/vnd.github+json", emit)
  }
}

// ---------------------------------------------------------------- 库
pub fn open_db() -> Result<Connection, String> {
  let dir = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("APPDATA")).unwrap_or_else(|_| ".".into());
  let dbdir = format!("{dir}\\gh-feed");
  std::fs::create_dir_all(&dbdir).ok();
  let path = format!("{dbdir}\\gh-feed.db");
  let conn = Connection::open(&path).map_err(|e| e.to_string())?;
  init_db(&conn);
  Ok(conn)
}

pub fn db_path() -> String {
  let dir = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("APPDATA")).unwrap_or_else(|_| ".".into());
  format!("{dir}\\gh-feed\\gh-feed.db")
}

/// 数据目录的唯一来源：界面日志以前在 main.rs 里各写一遍，改名字时就漏了一处
pub fn data_dir() -> String {
  let dir = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("APPDATA")).unwrap_or_else(|_| ".".into());
  format!("{dir}\\gh-feed")
}

pub fn log_path() -> String { format!("{}\\ui.log", data_dir()) }

fn init_db(conn: &Connection) {
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS repo(
         id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, owner TEXT, name TEXT,
         description TEXT, language TEXT, topics TEXT, url TEXT,
         stars INTEGER, forks INTEGER, open_issues INTEGER, subscribers INTEGER,
         created_at INTEGER, pushed_at INTEGER, archived INTEGER DEFAULT 0,
         size_kb INTEGER, homepage TEXT,
         first_seen_at INTEGER, last_refresh_at INTEGER, window_kind TEXT,
         slope REAL, curvature REAL, spam_flag INTEGER DEFAULT 0
       );
       CREATE TABLE IF NOT EXISTS star_week(
         repo_id INTEGER NOT NULL, week INTEGER NOT NULL, total INTEGER NOT NULL,
         days TEXT NOT NULL, fetched_at INTEGER NOT NULL,
         PRIMARY KEY(repo_id, week)
       );
       CREATE TABLE IF NOT EXISTS query_log(
         id INTEGER PRIMARY KEY AUTOINCREMENT, q TEXT, window_kind TEXT,
         total_count INTEGER, yielded INTEGER, ran_at INTEGER
       );",
    )
    .expect("建表失败");
}

fn upsert_repo(conn: &Connection, r: &RepoJson, window: &str, ts: i64) {
  conn
    .execute(
      "INSERT INTO repo(id, full_name, owner, name, description, language, topics, url,
        stars, forks, open_issues, subscribers, created_at, pushed_at, archived, size_kb,
        homepage, first_seen_at, last_refresh_at, window_kind)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18,?19)
       ON CONFLICT(id) DO UPDATE SET
         stars=excluded.stars, forks=excluded.forks, open_issues=excluded.open_issues,
         subscribers=excluded.subscribers, topics=excluded.topics,
         description=excluded.description, last_refresh_at=excluded.last_refresh_at",
      params![
        r.id, r.full_name, r.full_name.split('/').next().unwrap_or(""),
        r.full_name.split('/').last().unwrap_or(""),
        r.description, r.language,
        serde_json::to_string(&r.topics.clone().unwrap_or_default()).unwrap(),
        r.html_url, r.stargazers_count, r.forks_count, r.open_issues_count,
        r.subscribers_count.unwrap_or(0),
        iso_from_created(&r.created_at),
        r.pushed_at.as_deref().map(iso_from_created).unwrap_or(0),
        if r.archived.unwrap_or(false) { 1 } else { 0 },
        r.size.unwrap_or(0), r.homepage, ts, window
      ],
    )
    .ok();
}

// ---------------------------------------------------------------- 斜率（手册 5.3 纠正版）
fn slope_of(buckets: &[Bucket], ts: i64) -> (Option<f64>, Option<f64>) {
  let newest = match buckets.iter().max_by_key(|b| b.week) {
    Some(b) => b,
    None => return (None, None),
  };
  let mut days: Vec<i64> = newest.days.iter().copied().collect();
  while days.last() == Some(&0) {
    days.pop();
  }
  if days.is_empty() {
    return (None, None);
  }
  let sum: i64 = days.iter().sum();
  let slope = sum as f64 / days.len() as f64;
  let older: Vec<&Bucket> = buckets.iter().filter(|b| b.week < newest.week).collect();
  let curvature = if older.is_empty() {
    None
  } else {
    let prev = older.iter().max_by_key(|b| b.week).unwrap();
    if (ts - newest.week) / 86_400 < 14 {
      None
    } else {
      Some((slope + 1.0) / (prev.total as f64 / 7.0 + 1.0))
    }
  };
  (Some(slope), curvature)
}

// ---------------------------------------------------------------- 采集
pub fn run_collect(conn: &Connection, pages: i64, curve_n: i64, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);

  let windows = [("born7", 7i64), ("born30", 30), ("born90", 90)];
  let bands = ["20..99", "100..499", "500..1999"];
  for (kind, back) in windows {
    let since = ymd(ts / 86_400 - back);
    for band in bands {
      for page in 1..=pages {
        let mut q = BTreeMap::new();
        q.insert("q", format!("created:>{since} stars:{band} archived:false"));
        q.insert("sort", "stars".into());
        q.insert("order", "desc".into());
        q.insert("per_page", "100".into());
        q.insert("page", page.to_string());
        let res: Option<SearchJson> = http.get_json("/search/repositories", &q, "search", emit);
        match res {
          Some(s) => {
            let mut n = 0;
            for r in &s.items {
              upsert_repo(conn, r, kind, ts);
              n += 1;
            }
            conn.execute(
              "INSERT INTO query_log(q, window_kind, total_count, yielded, ran_at) VALUES(?1,?2,?3,?4,?5)",
              params![format!("created:>{since} stars:{band}"), kind, s.total_count, n, ts],
            )
            .ok();
            emit(format!("[fetch] {kind} {band:<11} 命中总数={:<7} 入库={:<4}", s.total_count, n));
            if n == 0 {
              break;
            }
          }
          None => break,
        }
        std::thread::sleep(std::time::Duration::from_millis(600));
      }
    }
  }

  // 曲线：按窗口分层挑，避免"全局按 stars 排"把 born7 全挤掉
  let per = (curve_n / 3).max(1);
  let mut got = 0;
  let mut want = 0;
  for (kind, _) in windows {
    let targets: Vec<(i64, String)> = {
      let mut st = conn
        .prepare("SELECT id, full_name FROM repo WHERE window_kind=?1 ORDER BY stars DESC LIMIT ?2")
        .map_err(|e| e.to_string())?;
      let v = st
        .query_map(params![kind, per], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|x| x.ok())
        .collect();
      drop(st);
      v
    };
    want += targets.len();
    for (id, full) in targets {
      let q = BTreeMap::new();
      let res: Option<Vec<Bucket>> = http.get_json(&format!("/repos/{full}/stargazers/history"), &q, "core", emit);
      if let Some(b) = res {
        for x in &b {
          conn.execute(
            "INSERT OR REPLACE INTO star_week(repo_id, week, total, days, fetched_at) VALUES(?1,?2,?3,?4,?5)",
            params![id, x.week, x.total, serde_json::to_string(&x.days).unwrap(), ts],
          )
          .ok();
        }
        let (slope, curv) = slope_of(&b, ts);
        conn.execute("UPDATE repo SET slope=?1, curvature=?2 WHERE id=?3", params![slope, curv, id]).ok();
        got += 1;
      }
      std::thread::sleep(std::time::Duration::from_millis(120));
    }
  }
  apply_rules(conn);
  let msg = format!("[done] 曲线 {got}/{want}，剩余 core={} search={}", http.core_left, http.search_left);
  emit(msg.clone());
  Ok(msg)
}

/// 规则层（手册第 8 节）。乘性降权在打分时做，这里只打标记。
pub fn apply_rules(conn: &Connection) {
  conn
    .execute_batch(
      "UPDATE repo SET spam_flag = 1 WHERE stars > 5000 AND open_issues = 0;
       UPDATE repo SET spam_flag = 1 WHERE stars > 5000 AND subscribers * 1.0 / stars < 0.005;
       UPDATE repo SET spam_flag = 1 WHERE archived = 1;
       UPDATE repo SET spam_flag = 1 WHERE stars > 300 AND forks * 1.0 / stars < 0.005;
       UPDATE repo SET spam_flag = 1 WHERE stars > 300 AND size_kb < 60 AND forks < 5;",
    )
    .ok();
}

// ---------------------------------------------------------------- 排序
pub fn current_login(conn: &Connection) -> String {
  conn.query_row("SELECT login FROM profile_term GROUP BY login ORDER BY MAX(rowid) DESC LIMIT 1", [], |r| r.get(0)).unwrap_or_default()
}

pub fn load_feed(conn: &Connection, login: &str, limit: i64, offset: i64) -> Vec<Card> {
  let ts = now_s();
  // 用块作用域把 stmt 的借用收干净，后面才能再对 conn 做只读查询
  let mut cards: Vec<Card> = {
  let mut stmt = match conn.prepare(
    "SELECT id, full_name, description, language, topics, url, stars, forks, open_issues,
            subscribers, created_at, window_kind, slope, curvature, spam_flag
     FROM repo WHERE id NOT IN (SELECT repo_id FROM event WHERE kind='hide')
       AND (window_kind NOT IN ('explore','search') OR slope IS NOT NULL)",
  ) {
    Ok(s) => s,
    Err(_) => return Vec::new(),
  };

  let mapped = stmt
    .query_map([], |r| {
      let topics: String = r.get(4)?;
      let created: i64 = r.get(10)?;
      let slope: Option<f64> = r.get(12)?;
      let curv: Option<f64> = r.get(13)?;
      let spam: i64 = r.get(14)?;
      let mut why = Vec::new();
      let mut score = match slope {
        Some(v) => {
          why.push(format!("日均新增 star {v:.0}"));
          0.60 * (v + 1.0).log10() / 4.0
        }
        None => {
          why.push("尚未测增速曲线，按未知处理".into());
          0.0
        }
      };
      match curv {
        Some(c) if c > 1.2 => {
          score += 0.20;
          why.push("还在加速".into());
        }
        Some(c) if c < 0.7 => {
          score -= 0.15;
          why.push("已在降温".into());
        }
        Some(_) => {}
        None => why.push("数据不足 14 天，无曲率".into()),
      }
      let age = (ts - created) / 86_400;
      score += 0.15 * (1.0 - (age.min(90) as f64 / 90.0));
      let issues: i64 = r.get(8)?;
      if issues > 0 {
        score += 0.05;
        why.push(format!("{issues} 个未关闭 issue，有人在用"));
      }
      if slope.is_none() {
        score *= 0.75; // 未知不等于零分，但也不给热度分
      }
      if spam == 1 {
        score *= 0.4;
        why.push("被规则降权（star 与 fork/watch/体积 不成比例）".into());
      }
      Ok(Card {
        id: r.get(0)?,
        full_name: r.get(1)?,
        description: r.get(2)?,
        language: r.get(3)?,
        topics: serde_json::from_str(&topics).unwrap_or_default(),
        url: r.get(5)?,
        stars: r.get(6)?,
        forks: r.get(7)?,
        open_issues: issues,
        subscribers: r.get(9)?,
        window: r.get(11)?,
        age_days: age,
        slope,
        curvature: curv,
        score,
        spam: spam == 1,
        channel: "hot".into(),
        lang_hit: false,
        saved: false,
        seen: false,
        weeks: Vec::new(),
        why,
      })
    });
  match mapped {
    Ok(rows) => rows.filter_map(|x| x.ok()).collect(),
    Err(_) => Vec::new(),
  }
  };

  {
    let mut wstmt = conn
      .prepare("SELECT total FROM star_week WHERE repo_id=?1 ORDER BY week DESC LIMIT 8")
      .unwrap();
    let ids: Vec<i64> = cards.iter().map(|c| c.id).collect();
    for (i, id) in ids.iter().enumerate() {
      let w = wstmt
        .query_map(params![id], |r| r.get::<_, i64>(0))
        .map(|rows| rows.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
      cards[i].weeks = w;
    }
  }

  if !login.is_empty() {
    // profile 与 social 都走 feed_hit：前者是"词表命中"，后者是"我信任的人收藏了它"
    let hits: Vec<(i64, String, f64, String)> = {
      let mut st = conn.prepare(
        "SELECT repo_id, channel, rrf, terms FROM feed_hit WHERE login=?1 AND channel IN ('profile','social')").unwrap();
      let v = st.query_map(params![login], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().flatten().collect();
      drop(st); v
    };
    // 同一个仓库可能两条通道都命中；social 的权重更高（"人"比"词"可信），所以按通道取大而不是相加
    let mut hm: std::collections::HashMap<i64,(String,f64,String)> = std::collections::HashMap::new();
    for (id, ch, rrf, terms) in hits {
      let w = if ch == "social" { rrf * 1.4 } else { rrf };
      match hm.get(&id) {
        Some((_, prev, _)) if *prev >= w => {}
        _ => { hm.insert(id, (ch, w, terms)); }
      }
    }
    for c in cards.iter_mut() {
      if let Some((ch, rrf, terms)) = hm.get(&c.id) {
        let bonus = (rrf * 0.5).min(0.35);
        c.score += bonus;
        let shown: Vec<String> = serde_json::from_str(terms).unwrap_or_default();
        if ch == "social" {
          c.channel = "social".into();
          c.why.insert(0, format!("{} 收藏了它", shown.join("、")));
        } else {
          c.channel = "profile".into();
          c.why.insert(0, format!("画像命中：{}", shown.join("/")));
        }
      }
    }
  }
  // 回路 B：分桶校准。步长限死在 ±0.08，样本不足的桶权重是 1.0（等于不生效）
  {
    let w = weights(conn);
    let prefs: Vec<String> = if let Ok(mut st) = conn.prepare(
      "SELECT language FROM profile_language WHERE login=?1 AND weight >= 0.15") {
      st.query_map(params![login], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
    } else { Vec::new() };
    for c in cards.iter_mut() {
      c.lang_hit = c.language.as_ref().map(|l| prefs.iter().any(|p| p == l)).unwrap_or(false);
    }
    let hit = |k: &str| -> (f64, bool) { w.get(k).map(|v| (*v, true)).unwrap_or((1.0, false)) };
    for c in cards.iter_mut() {
      for (key, label) in [
        (format!("channel={}", c.channel), "通道"),
        (format!("window={}", c.window), "窗口"),
        (format!("lang={}", if c.lang_hit { "hit" } else { "no" }), "语言偏好"),
        (format!("spam={}", if c.spam { 1 } else { 0 }), "降权标记"),
      ] {
        let (v, used) = hit(&key);
        if used && (v - 1.0).abs() > 0.01 {
          let d = (0.08 * (v - 1.0)).clamp(-0.08, 0.08);
          c.score += d;
          c.why.push(format!("校准[{label}] {:+.3}", d));
        }
      }
    }
  }
  // 收藏状态要带出去：收藏页的徽标和"这条已经收过"都靠它
  {
    let ids: Vec<i64> = if let Ok(mut st) = conn.prepare("SELECT repo_id FROM saved") {
      st.query_map([], |r| r.get::<_, i64>(0)).map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default()
    } else { Vec::new() };
    let set: std::collections::HashSet<i64> = ids.into_iter().collect();
    let seen: std::collections::HashSet<i64> = if let Ok(mut st2) = conn.prepare("SELECT DISTINCT repo_id FROM impression") {
      st2.query_map([], |r| r.get::<_, i64>(0))
        .map(|x| x.filter_map(|y| y.ok()).collect())
        .unwrap_or_default()
    } else { Default::default() };
    for c in cards.iter_mut() { c.saved = set.contains(&c.id); c.seen = seen.contains(&c.id); }
  }
  // ---------------------------------------------------------------- 通道槽位（2026-10-06）
  //
  // 为什么不能只按总分排：hot 的候选有斜率，基础分天然 0.4~0.6；而画像与相似用户的候选
  // 大多没有斜率（基础分 0），只有 `min(rrf*0.5, 0.35)` 那一档加成。混排的结果是
  // **新通道一条都进不了前 50**——实测：1923 条 social + 587 条 profile 全被 hot 压在下面，
  // 前 6 名清一色 通道=hot。这不是打分错了，是"能算分的"和"算不出分的"不该放同一个尺子量。
  // 手册 §5.4 对探索层早就写过这条（"必须按槽位插入，否则被系统性压死"），现在推广到全部四条通道。
  //
  // 配比：热 11 / 画像 4 / 相似 3 / 探索 2（每 20 个槽位一组）。某条通道没货时让位给 hot，
  // 全都没货就让位给任意还有货的通道——不能因为配额没填满就少给用户内容。
  // 配比：热 11 / 画像 4 / 相似 3 / 探索 2（每 20 个槽位一组）
  const PATTERN: [&str; 20] = [
    "hot", "hot", "profile", "hot", "social", "hot", "hot", "profile", "hot", "explore",
    "hot", "hot", "profile", "social", "hot", "hot", "explore", "hot", "profile", "social",
  ];

  // 四条通道各自排好，再按固定配比交替取。用数组装桶是为了取用时只有下标、没有借用纠缠
  // （第一版写成"累计取用数 vs 递减长度"比较，结果从空桶里 remove 直接 panic）。
  let mut buckets: [Vec<Card>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()]; // hot / profile / social / explore
  for c in cards {
    let i = match c.channel.as_str() {
      // 被规则降权的项**不许占用画像/相似/探索的推荐位**：实测它们总是分数最高的一批
      // （因为有斜率），一插就把这三个通道全占了，用户看到的是垃圾坐推荐位。
      // 它们仍然留在池子里，靠 hot 桶按分数自然排（那儿有 0.4 的乘性降权）。
      "profile" if !c.spam => 1,
      "social" if !c.spam => 2,
      _ if c.window == "explore" && !c.spam => 3,
      _ => 0,
    };
    buckets[i].push(c);
  }
  for b in buckets.iter_mut() {
    b.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
  }
  let total: usize = buckets.iter().map(|b| b.len()).sum();
  let slot_of = |name: &str| match name {
    "profile" => 1,
    "social" => 2,
    "explore" => 3,
    _ => 0,
  };
  let mut interleaved: Vec<Card> = Vec::with_capacity(total);
  let mut k = 0usize;
  while interleaved.len() < total {
    let mut want = slot_of(PATTERN[k % PATTERN.len()]);
    if buckets[want].is_empty() {
      // 该通道没货就让位：先让给热榜，热榜也空了就让给任意还有货的
      want = if !buckets[0].is_empty() {
        0
      } else {
        match (0..4).find(|i| !buckets[*i].is_empty()) {
          Some(i) => i,
          None => break,
        }
      };
    }
    interleaved.push(buckets[want].remove(0));
    k += 1;
  }
  // 打散：同一 owner 不连续出现两次
  let mut out: Vec<Card> = Vec::with_capacity(interleaved.len());
  let mut buf = interleaved;
  while !buf.is_empty() {
    let pos = buf
      .iter()
      .position(|c| {
        out.iter().rev().take(2).all(|o| o.full_name.split('/').next() != c.full_name.split('/').next())
      })
      .unwrap_or(0);
    out.push(buf.remove(pos));
  }
  let end = (offset + limit).max(0) as usize;
  out.into_iter().skip(offset.max(0) as usize).take(end.saturating_sub(offset.max(0) as usize)).collect()
}

pub fn pool_size(conn: &Connection) -> i64 {
  conn.query_row("SELECT COUNT(1) FROM repo", [], |r| r.get(0)).unwrap_or(0)
}

// ================================================================ 画像通道（P4）
// 关键前提：/users/{login}/starred 匿名可读（已实测），所以画像算法本身不需要 token；
// token 只用来把 login 换成"当前登录用户自己"。
const STOP: &str = " the and for with you your are our from this that have will its can get use used using new all more most also into out about over under between being was were will be i ii iii v vs etc via per app apps one two three";

pub fn tokenize(s: &str) -> Vec<String> {
  let mut out = Vec::new();
  for raw in s.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
    if raw.len() < 3 || raw.len() > 24 {
      continue;
    }
    if raw.chars().all(|c| c.is_ascii_digit()) {
      continue;
    }
    if STOP.split(' ').any(|w| w == raw) {
      continue;
    }
    out.push(raw.to_string());
  }
  out
}

fn ensure_profile_tables(conn: &Connection) {
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS starred_snapshot(
         login TEXT NOT NULL, repo_id INTEGER NOT NULL, full_name TEXT,
         starred_at INTEGER, language TEXT, description TEXT,
         PRIMARY KEY(login, repo_id));
       CREATE TABLE IF NOT EXISTS profile_term(
         login TEXT NOT NULL, term TEXT NOT NULL, weight REAL NOT NULL,
         PRIMARY KEY(login, term));
       CREATE TABLE IF NOT EXISTS profile_language(
         login TEXT NOT NULL, language TEXT NOT NULL, weight REAL NOT NULL,
         PRIMARY KEY(login, language));
       CREATE TABLE IF NOT EXISTS feed_hit(
         repo_id INTEGER NOT NULL, login TEXT NOT NULL, channel TEXT NOT NULL,
         rrf REAL NOT NULL DEFAULT 0, terms TEXT NOT NULL DEFAULT '[]',
         PRIMARY KEY(repo_id, login, channel));",
    )
    .ok();
}

#[derive(Deserialize, serde::Serialize)]
struct StarredItem {
  #[serde(flatten)]
  repo: RepoJson,
  starred_at: Option<String>,
}

/// 读某人的收藏 + 他自己的仓库，算出加权词表。
pub fn build_profile(conn: &Connection, login: &str, pages: i64, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_profile_tables(conn);
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);

  let mut docs: Vec<(f64, String)> = Vec::new(); // (权重, 文本)
  let mut langs: BTreeMap<String, f64> = BTreeMap::new();
  let mut n_stars = 0;

  for page in 1..=pages {
    let mut q = BTreeMap::new();
    q.insert("per_page", "100".into());
    q.insert("page", page.to_string());
    let path = format!("/users/{login}/starred");
    let res: Option<Vec<StarredItem>> = http.get_json(&path, &q, "core", emit);
    let Some(items) = res else { break };
    if items.is_empty() {
      break;
    }
    for it in &items {
      let when = it.starred_at.as_deref().map(|s| iso_from_created(s)).unwrap_or(ts);
      let age_days = ((ts - when) / 86_400).max(0) as f64;
      let w = (-age_days / 90.0).exp(); // τ = 90 天的时间衰减
      let text = format!("{} {}", it.repo.full_name.replace('/', " "), it.repo.description.clone().unwrap_or_default());
      docs.push((w, text));
      if let Some(l) = &it.repo.language {
        *langs.entry(l.clone()).or_insert(0.0) += w;
      }
      conn.execute(
        "INSERT OR REPLACE INTO starred_snapshot(login, repo_id, full_name, starred_at, language, description)
         VALUES(?1,?2,?3,?4,?5,?6)",
        params![login, it.repo.id, it.repo.full_name, when, it.repo.language, it.repo.description],
      )
      .ok();
      n_stars += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
  }

  // 除收藏之外的两个原料（2026-10-06 补）。原因很实在：他 starred 0 条、关注 3 人，
  // 只靠收藏建画像的话词表永远是空的——而个性化通道全靠这张表。
  // ① 他自己的仓库：最直白的口味声明（topics + 描述 + 语言）
  let mut n_own = 0;
  {
    let mut q = BTreeMap::new();
    q.insert("per_page", "100".into());
    q.insert("sort", "updated".into());
    let res: Option<Vec<RepoJson>> = http.get_json(&format!("/users/{login}/repos"), &q, "core", emit);
    if let Some(list) = res {
      for r in &list {
        let text = format!(
          "{} {} {}",
          r.full_name.replace('/', " "),
          r.description.clone().unwrap_or_default(),
          r.topics.clone().unwrap_or_default().join(" ")
        );
        docs.push((1.2, text));
        if let Some(l) = &r.language {
          *langs.entry(l.clone()).or_insert(0.0) += 1.2;
        }
        n_own += 1;
      }
    }
  }
  // ② 本机行为：点开过 / 停留过 / 在应用内收藏过的仓库。不需要任何请求——库里就有它们的名字、
  //    描述与 topics（入库时抓过），所以这条原料是"零成本"的，而且它比收藏更能反映当下在看什么。
  let mut n_behavior = 0;
  {
    let rows: Vec<(String, String, Option<String>, i64)> = {
      let mut st = match conn.prepare(
        "SELECT r.full_name, COALESCE(r.topics,'[]'), r.description, MAX(e.ts) AS last_ts
         FROM event e JOIN repo r ON r.id = e.repo_id
         WHERE e.repo_id IS NOT NULL AND e.kind IN ('star_in_app','open','dwell')
         GROUP BY e.repo_id ORDER BY last_ts DESC LIMIT 60",
      ) {
        Ok(s) => s,
        Err(_) => return Err("读行为日志失败（表可能还没建）".into()),
      };
      st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map(|rows| rows.filter_map(|x| x.ok()).collect())
        .unwrap_or_default()
    };
    for (full, topics, desc, last_ts) in rows {
      let age_days = ((ts - last_ts) / 86_400).max(0) as f64;
      let decay = (-age_days / 30.0).exp(); // 行为比收藏衰减快：上看过的≠现在还想看
      let text = format!("{} {} {}", full.replace('/', " "), desc.unwrap_or_default(), topics.replace(['[', ']', '"'], " "));
      docs.push((1.0 * decay, text));
      n_behavior += 1;
    }
  }
  if n_own == 0 && n_behavior == 0 && n_stars == 0 {
    emit("[profile] 收藏 0、自己的仓库 0、行为 0——没有原料可建画像".into());
  }

  // idf 用本地候选池统计（手册 6 节：没有全网词频，而本地池恰好就是我们要从中推荐的东西）
  let mut df: BTreeMap<String, usize> = BTreeMap::new();
  let mut n_docs_pool = 0usize;
  {
    let mut st = conn.prepare("SELECT full_name, description FROM repo").map_err(|e| e.to_string())?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).map_err(|e| e.to_string())?;
    for row in rows.flatten() {
      n_docs_pool += 1;
      let mut seen: BTreeMap<String, ()> = BTreeMap::new();
      for t in tokenize(&format!("{} {}", row.0.replace('/', " "), row.1.unwrap_or_default())) {
        seen.insert(t, ());
      }
      for t in seen.keys() {
        *df.entry(t.clone()).or_insert(0) += 1;
      }
    }
  }
  let nd = n_docs_pool.max(1) as f64;

  let mut tf: BTreeMap<String, f64> = BTreeMap::new();
  for (w, text) in &docs {
    let mut local: BTreeMap<String, usize> = BTreeMap::new();
    for t in tokenize(text) {
      *local.entry(t).or_insert(0) += 1;
    }
    for (t, c) in local {
      let d = *df.get(&t).unwrap_or(&0) as f64;
      // 通用词淘汰：在候选池里出现率超过 15% 的词没有区分力
      // （实测挖出来过 plugin / web 这种"谁都在写"的词，它匹配的是"这是个软件"而不是口味）
      if nd > 0.0 && d / nd > 0.15 {
        continue;
      }
      let idf = (1.0 + nd / (1.0 + d)).ln();
      *tf.entry(t).or_insert(0.0) += (1.0 + (c as f64).ln()) * w * idf;
    }
  }
  conn.execute("DELETE FROM profile_term WHERE login=?1", params![login]).ok();
  let mut top: Vec<(&String, f64)> = tf.iter().map(|(k, v)| (k, *v)).collect();
  top.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
  let maxw = top.first().map(|x| x.1).unwrap_or(1.0).max(0.001);
  for (t, w) in top.iter().take(60) {
    conn.execute("INSERT OR REPLACE INTO profile_term(login, term, weight) VALUES(?1,?2,?3)", params![login, t, w / maxw]).ok();
  }
  conn.execute("DELETE FROM profile_language WHERE login=?1", params![login]).ok();
  let lsum: f64 = langs.values().sum();
  for (l, v) in &langs {
    conn.execute("INSERT OR REPLACE INTO profile_language(login, language, weight) VALUES(?1,?2,?3)",
      params![login, l, v / lsum.max(0.001)]).ok();
  }
  let msg = format!(
    "[profile] @{login} 收藏 {n_stars} + 自己的仓库 {n_own} + 行为 {n_behavior} → 词表 {} 个，语言偏好 {:?}",
    top.len(),
    langs.iter().take(3).map(|(k, v)| (k.clone(), v.round() as i64)).collect::<Vec<_>>()
  );
  emit(msg.clone());
  Ok(msg)
}

/// 用词表生成查询、跑 search、按 RRF 融合进 feed_hit
pub fn run_profile_search(conn: &Connection, login: &str, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_profile_tables(conn);
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);

  let terms: Vec<(String, f64)> = {
    let mut st = conn
      .prepare("SELECT term, weight FROM profile_term WHERE login=?1 ORDER BY weight DESC LIMIT 14")
      .map_err(|e| e.to_string())?;
    let v = st.query_map(params![login], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
    v.flatten().collect()
  };
  conn.execute("DELETE FROM feed_hit WHERE login=?1 AND channel='profile'", params![login]).ok();

  let mut used = 0;
  for (term, w) in &terms {
    let mut q = BTreeMap::new();
    q.insert("q", format!("{term} stars:>20 archived:false"));
    q.insert("sort", "stars".into());
    q.insert("order", "desc".into());
    q.insert("per_page", "50".into());
    let res: Option<SearchJson> = http.get_json("/search/repositories", &q, "search", emit);
    let Some(s) = res else { continue };
    used += 1;
    for (rank, r) in s.items.iter().enumerate() {
      let add = w / (60.0 + rank as f64); // RRF，措辞重叠近乎零，融合是正确性要求
      conn.execute(
        "INSERT INTO feed_hit(repo_id, login, channel, rrf, terms) VALUES(?1,?2,'profile',?3,?4)
         ON CONFLICT(repo_id, login, channel) DO UPDATE SET rrf = rrf + excluded.rrf, terms = excluded.terms",
        params![r.id, login, add, format!("[\"{term}\"]")],
      )
      .ok();
      upsert_repo(conn, r, "profile", ts);
    }
    std::thread::sleep(std::time::Duration::from_millis(600));
  }
  let n: i64 = conn
    .query_row("SELECT COUNT(1) FROM feed_hit WHERE login=?1 AND channel='profile'", params![login], |r| r.get(0))
    .unwrap_or(0);
  let msg = format!("[profile-search] 跑了 {used} 条查询，命中 {n} 个候选（search 剩余 {}）", http.search_left);
  emit(msg.clone());
  Ok(msg)
}

// ================================================================ 通道三：相似用户（我的人际圈）
//
// 先说清为什么不是"行为共现"（他 2026-10-06 选的正是那条）：实测发现 **GitHub 已经把
// `/repos/{o}/{r}/stargazers` 锁给仓库管理员**——匿名 401、带 token 看别人的仓库 404、
// 只有自己的仓库 200（同批实测：`/repos/react/react/subscribers` 也是 404，
// 而 `/repos/react/react/forks` 和 `/users/{任何人}/starred` 都是 200）。
// 也就是说"谁 star 了我喜欢的仓库"这个查询在他们那边不存在了，共现路线无从下手。
//
// 能走通的是**我的人际圈**：我关注的人 + 关注我的人 + star 过我仓库的人 → 看他们最近收藏了什么。
// 这仍然是单机、只读、1 跳，没有服务端，也没有跨用户数据库——D5 否掉的那个 CF 依然没回来。
//
// 他关注只有 3 人、followers 7 人，所以第三类源（star 过我项目的人）是主力补充：
// 那批人是"对我的东西感兴趣的人"，他们的收藏清单是这条通道里最有信息量的一档。
//
// 三处近似：
// ① 每类源最多取一页 100 人，不翻页；
// ② 判"这个源还活着"只看他收藏列表最新一条的时间（>45 天视为休眠，对齐手册 §5.5 的护栏）；
// ③ 一个人的收藏只取第一页 100 条（按收藏时间倒序），一年前的条目直接丢。

#[derive(Deserialize)]
struct LoginOnly {
  login: String,
}
#[derive(Deserialize)]
struct StarGazer {
  starred_at: Option<String>,
  user: LoginOnly,
}

fn ensure_social_tables(conn: &Connection) {
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS social_cache(
         login TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, newest_at INTEGER NOT NULL,
         weight REAL NOT NULL DEFAULT 0, items TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS refill_log(
         id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, step INTEGER NOT NULL,
         channel TEXT NOT NULL, core_used INTEGER NOT NULL, search_used INTEGER NOT NULL,
         inserted INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');",
    )
    .ok();
}

/// 源列表，按"离我多近"分四档（2026-10-06 他指定：**以我关注的人为主要参考**）：
///   ① 我关注的人（1.0）——主参考
///   ② 他们 follow 的人（0.6）——"我关注的人 follow 的人"，顺着信任链再走一跳
///   ③ 关注我的人（0.5）
///   ④ star 过我仓库的人（0.3）
/// 去重（取最高档）、按权重排序、取前 max 个。②的扩张只取每个主源的第一页，避免一个人关注 5000 就把源撑爆。
pub fn social_sources(conn: &Connection, my_login: &str, max: i64, emit: &mut dyn FnMut(String)) -> Vec<(String, f64)> {
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  let mut score: BTreeMap<String, f64> = BTreeMap::new();
  let mut add = |who: &str, w: f64| {
    if who.is_empty() || who == my_login {
      return;
    }
    let e = score.entry(who.to_string()).or_insert(0.0);
    if w > *e {
      *e = w;
    }
  };
  let mut q = BTreeMap::new();
  q.insert("per_page", "100".to_string());

  // ① 我关注的人（主参考）
  let following: Option<Vec<LoginOnly>> = http.get_json(&format!("/users/{my_login}/following"), &q, "core", emit);
  let hops: Vec<String> = following.unwrap_or_default().iter().map(|u| u.login.clone()).collect();
  for who in &hops {
    add(who, 1.0);
  }
  // ② 他们 follow 的人（只取前 3 个主源，一人一页）
  let mut n_hop2 = 0;
  for who in hops.iter().take(3) {
    let res: Option<Vec<LoginOnly>> = http.get_json(&format!("/users/{who}/following"), &q, "core", emit);
    for u in res.unwrap_or_default() {
      add(&u.login, 0.6);
      n_hop2 += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(120));
  }
  // ③ 关注我的人
  let followers: Option<Vec<LoginOnly>> = http.get_json(&format!("/users/{my_login}/followers"), &q, "core", emit);
  let mut n_followers = 0;
  for u in followers.unwrap_or_default() {
    add(&u.login, 0.5);
    n_followers += 1;
  }
  // ④ star 过我仓库的人（这些仓库我确实有权限看名单，实测 200）
  let mine: Vec<(String, i64)> = {
    let mut st = match conn.prepare("SELECT full_name, stars FROM repo WHERE owner=?1 ORDER BY stars DESC LIMIT 5") {
      Ok(s) => s,
      Err(_) => return Vec::new(),
    };
    st.query_map(params![my_login], |r| Ok((r.get(0)?, r.get(1)?)))
      .map(|rows| rows.filter_map(|x| x.ok()).collect())
      .unwrap_or_default()
  };
  let mut n_starred_me = 0;
  for (full, _) in &mine {
    let res: Option<Vec<LoginOnly>> = http.get_json(&format!("/repos/{full}/stargazers"), &q, "core", emit);
    for u in res.unwrap_or_default() {
      add(&u.login, 0.3);
      n_starred_me += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(120));
  }

  let mut v: Vec<(String, f64)> = score.into_iter().collect();
  v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
  emit(format!(
    "[social] 源：我关注 {}（主）+ 他们 follow 的 {} + 关注我 {} + star 过我仓库 {} → 去重 {} 人，取前 {}",
    hops.len(),
    n_hop2,
    n_followers,
    n_starred_me,
    v.len(),
    max
  ));
  v.truncate(max.max(0) as usize);
  v
}

/// 抓这些人最近收藏了什么并入库（channel='social'）。休眠源（最新一条收藏超过 45 天）直接跳过。
pub fn run_social(conn: &Connection, login: &str, source_n: i64, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_social_tables(conn);
  let ts = now_s();
  let sources = social_sources(conn, login, source_n, emit);
  if sources.is_empty() {
    let m = "[social] 没有可用的源（关注 0、followers 0、自己仓库没被 star）——这条通道暂时没料".to_string();
    emit(m.clone());
    return Ok(m);
  }

  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  let mut inserted = 0usize;
  let mut skipped_dormant = 0usize;
  let mut used_cache = 0usize;
  for (who, base_w) in &sources {
    // 缓存 24 小时：同一个人的收藏一天看一次就够，重复拉等于白烧配额
    let cached: Option<(i64, i64, f64, String)> = conn
      .query_row("SELECT fetched_at, newest_at, weight, items FROM social_cache WHERE login=?1", params![who], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
      })
      .ok();
    let (weight, items_json) = match cached {
      Some((at, newest, w, items)) if at > ts - 86_400 => {
        used_cache += 1;
        if newest > 0 && (ts - newest) / 86_400 > 45 {
          skipped_dormant += 1;
          continue;
        }
        (w * base_w / 0.8_f64.max(w), items)
      }
      _ => {
        let mut q = BTreeMap::new();
        q.insert("per_page", "100".to_string());
        q.insert("sort", "created".to_string());
        let res: Option<Vec<StarredItem>> =
          http.get_json_as(&format!("/users/{who}/starred"), &q, "core", "application/vnd.github+json", emit);
        let Some(list) = res else { continue };
        let newest = list.iter().filter_map(|x| x.starred_at.as_deref().map(iso_from_created)).max().unwrap_or(0);
        // 手册 §5.5 的护栏：源自己都不怎么活跃了，就别拿他的收藏当推荐理由
        if newest > 0 && (ts - newest) / 86_400 > 45 {
          conn.execute(
            "INSERT OR REPLACE INTO social_cache(login, fetched_at, newest_at, weight, items) VALUES(?1,?2,?3,?4,?5)",
            params![who, ts, newest, 0.8, serde_json::to_string(&list).unwrap()],
          )
          .ok();
          skipped_dormant += 1;
          emit(format!("[social] @{who} 最近一条收藏是 {} 天前，按休眠跳过", (ts - newest) / 86_400));
          continue;
        }
        // 活跃度权重：最近 90 天收藏了多少条（满 100 条记 1.0）
        let recent = list
          .iter()
          .filter(|x| x.starred_at.as_deref().map(|s| (ts - iso_from_created(s)) / 86_400 <= 90).unwrap_or(false))
          .count();
        let w = (recent as f64 / 100.0).min(1.0).max(0.05);
        conn.execute(
          "INSERT OR REPLACE INTO social_cache(login, fetched_at, newest_at, weight, items) VALUES(?1,?2,?3,?4,?5)",
          params![who, ts, newest, w, serde_json::to_string(&list).unwrap()],
        )
        .ok();
        (w, serde_json::to_string(&list).unwrap())
      }
    };

    let list: Vec<StarredItem> = serde_json::from_str(&items_json).unwrap_or_default();
    for (rank, it) in list.iter().enumerate() {
      let when = it.starred_at.as_deref().map(iso_from_created).unwrap_or(ts);
      let age_days = ((ts - when) / 86_400).max(0) as f64;
      if age_days > 365.0 {
        continue; // 一年前的收藏不代表他现在的口味
      }
      upsert_repo(conn, &it.repo, "social", ts);
      // rrf 里带上"这个人离我多近"和"这条有多新"：load_feed 会把它折算成 ≤0.35 的加分
      let rrf = (0.12 * base_w * weight) * (-age_days / 180.0).exp() / (1.0 + rank as f64 / 60.0);
      conn
        .execute(
          "INSERT INTO feed_hit(repo_id, login, channel, rrf, terms) VALUES(?1,?2,'social',?3,?4)
           ON CONFLICT(repo_id, login, channel) DO UPDATE SET rrf = MAX(rrf, excluded.rrf), terms = excluded.terms",
          params![it.repo.id, login, rrf, format!("[\"@{who}\"]")],
        )
        .ok();
      inserted += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(120));
  }
  let m = format!(
    "[social] 源 {} 人（缓存命中 {}、休眠跳过 {}）→ 入库 {} 条候选，core 剩余 {}",
    sources.len(),
    used_cache,
    skipped_dormant,
    inserted,
    http.core_left
  );
  emit(m.clone());
  Ok(m)
}

/// 静默补货一步。预算靠两件事保证：①各通道的步长参数把请求量钉死（最坏一轮 ≈ 20~30 次）
/// ②跑前探一次余额（免费端点），低于 200 直接跳过。
/// 返回结构化结果（通道 / 新增 / 这一轮真实请求数 / 池子前后），给界面与断言用。
pub fn refill(conn: &Connection, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  ensure_social_tables(conn);
  ensure_profile_tables(conn);
  let ts = now_s();
  let mut probe = Http { core_left: 999, search_left: 999, tok: None }.authed();
  probe.probe(emit);
  if probe.core_left >= 0 && probe.core_left < 200 {
    emit(format!("[refill] core 只剩 {}，本轮跳过（不冒险把配额用完）", probe.core_left));
    return Ok(serde_json::json!({
      "channel": "skip", "inserted": 0, "core_used": 0, "search_used": 0,
      "note": format!("配额不足（core {}）", probe.core_left), "pool_before": 0, "pool_after": 0,
    }));
  }
  let login = active_login(conn);
  let before: i64 = conn.query_row("SELECT COUNT(1) FROM repo", [], |r| r.get(0)).unwrap_or(0);
  let (calls0, search0) = http_calls();
  let step: i64 = get_settings(conn)["refill_step"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
  let channel = match step % 4 {
    0 => "profile",
    1 => "hot",
    2 => "explore",
    _ => "social",
  };
  emit(format!("[refill] 第 {} 步，通道 {channel}，@{}", step + 1, if login.is_empty() { "(未登录)" } else { &login }));
  match channel {
    "profile" => {
      // 画像：原料先重建（含行为种子），再跑一轮多措辞检索
      let _ = build_profile(conn, &login, 1, emit);
      let _ = run_profile_search(conn, &login, emit);
    }
    "hot" => {
      let _ = run_collect(conn, 1, 6, emit);
    }
    "explore" => {
      let _ = run_explore(conn, 1, emit);
    }
    _ => {
      let _ = run_social(conn, &login, 20, emit);
    }
  }
  apply_rules(conn);
  // 顺手补几条曲线：没有斜率的热度候选排序时会被 ×0.75，长期没人测就等于永远不上榜
  let _ = measure_top(conn, 6, emit);
  let after: i64 = conn.query_row("SELECT COUNT(1) FROM repo", [], |r| r.get(0)).unwrap_or(0);
  let (calls1, search1) = http_calls();
  let core_used = calls1 - calls0;
  let search_used = search1 - search0;
  let inserted = (after - before).max(0);
  conn
    .execute(
      "INSERT INTO refill_log(at, step, channel, core_used, search_used, inserted, note) VALUES(?1,?2,?3,?4,?5,?6,?7)",
      params![ts, step, channel, core_used, search_used, inserted, format!("池子 {before} → {after}")],
    )
    .ok();
  set_setting(conn, "refill_step", &(step + 1).to_string()).ok();
  let note = format!("{channel}：请求 core {core_used} / search {search_used}，池子 {before} → {after}");
  emit(format!("[refill] {note}"));
  Ok(serde_json::json!({
    "channel": channel, "inserted": inserted, "core_used": core_used, "search_used": search_used,
    "note": note, "pool_before": before, "pool_after": after,
  }))
}

/// 补货状态：给界面看的（池子多大、上次什么时候补的、各通道多少）
pub fn refill_status(conn: &Connection) -> serde_json::Value {
  ensure_social_tables(conn);
  let pool: i64 = conn.query_row("SELECT COUNT(1) FROM repo", [], |r| r.get(0)).unwrap_or(0);
  let last: Vec<serde_json::Value> = {
    let mut st = match conn.prepare("SELECT at, step, channel, core_used, search_used, inserted FROM refill_log ORDER BY id DESC LIMIT 5") {
      Ok(s) => s,
      Err(_) => return serde_json::json!({ "pool": pool, "last": [], "enabled": false }),
    };
    let v: Vec<serde_json::Value> = st
      .query_map([], |r| {
        Ok(serde_json::json!({
          "at": r.get::<_, i64>(0)?, "step": r.get::<_, i64>(1)?, "channel": r.get::<_, String>(2)?,
          "core_used": r.get::<_, i64>(3)?, "search_used": r.get::<_, i64>(4)?, "inserted": r.get::<_, i64>(5)?,
        }))
      })
      .map(|rows| rows.filter_map(|x| x.ok()).collect())
      .unwrap_or_default();
    v
  };
  let s = get_settings(conn);
  serde_json::json!({
    "pool": pool,
    "last": last,
    "enabled": s["refill_on"].as_str().unwrap_or("1") == "1",
    "next_step": s["refill_step"].as_str().and_then(|x| x.parse::<i64>().ok()).unwrap_or(0),
    "social_sources": conn.query_row("SELECT COUNT(1) FROM social_cache WHERE weight > 0", [], |r| r.get::<_, i64>(0)).unwrap_or(0),
    "profile_terms": conn.query_row("SELECT COUNT(1) FROM profile_term", [], |r| r.get::<_, i64>(0)).unwrap_or(0),
  })
}

/// 两级漏斗的完整版：先粗排，再对跨通道的前 n 名补测 star 曲线。
/// 之前是"先测曲线再排序"，导致画像候选永远没有斜率、被排序门槛静默滤掉。
pub fn measure_top(conn: &Connection, n: i64, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_profile_tables(conn);
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);
  let list: Vec<(i64, String)> = {
    let mut st = conn.prepare("SELECT id, full_name FROM repo WHERE slope IS NULL ORDER BY stars DESC LIMIT ?1").map_err(|e| e.to_string())?;
    let v = st.query_map(params![n], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.flatten().collect();
    drop(st); v
  };
  let mut got = 0;
  for (id, full) in &list {
    let q = BTreeMap::new();
    let res: Option<Vec<Bucket>> = http.get_json(&format!("/repos/{full}/stargazers/history"), &q, "core", emit);
    if let Some(b) = res {
      for x in &b {
        conn.execute("INSERT OR REPLACE INTO star_week(repo_id, week, total, days, fetched_at) VALUES(?1,?2,?3,?4,?5)",
          params![id, x.week, x.total, serde_json::to_string(&x.days).unwrap(), ts]).ok();
      }
      let (slope, curv) = slope_of(&b, ts);
      conn.execute("UPDATE repo SET slope=?1, curvature=?2 WHERE id=?3", params![slope, curv, id]).ok();
      got += 1;
    }
    std::thread::sleep(std::time::Duration::from_millis(120));
  }
  let msg = format!("[measure] 补测 {got}/{} 条曲线，core 剩余 {}", list.len(), http.core_left);
  emit(msg.clone());
  Ok(msg)
}

pub fn profile_terms(conn: &Connection, login: &str) -> Vec<(String, f64)> {
  let Ok(mut st) = conn.prepare("SELECT term, weight FROM profile_term WHERE login=?1 ORDER BY weight DESC LIMIT 8") else {
    return Vec::new();
  };
  let Ok(rows) = st.query_map(params![login], |r| Ok((r.get(0)?, r.get(1)?))) else {
    return Vec::new();
  };
  rows.flatten().collect()
}

// ================================================================ 事件回写（P5）
// 日志只本机（D2）：这些表没有任何一条会离开这台机器。
pub fn ensure_event_tables(conn: &Connection) {
  // CREATE TABLE IF NOT EXISTS 不会改已存在的表，所以旧结构缺列时先丢掉重建。
  // 原型阶段曝光数据不值钱；真发布前要换成正式的 ALTER 迁移。
  let has_session: i64 = conn
    .query_row("SELECT COUNT(1) FROM pragma_table_info('impression') WHERE name='session'", [], |r| r.get(0))
    .unwrap_or(0);
  if has_session == 0 {
    conn.execute("DROP TABLE IF EXISTS impression", []).ok();
  }
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS impression(
         id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER NOT NULL,
         slot INTEGER NOT NULL, channel TEXT NOT NULL, ts INTEGER NOT NULL,
         session TEXT NOT NULL DEFAULT '',
         UNIQUE(repo_id, session));
       CREATE TABLE IF NOT EXISTS event(
         id INTEGER PRIMARY KEY AUTOINCREMENT, repo_id INTEGER,
         kind TEXT NOT NULL, payload TEXT, impression_id INTEGER, ts INTEGER NOT NULL);
       CREATE TABLE IF NOT EXISTS saved(
         repo_id INTEGER PRIMARY KEY, note TEXT, created_at INTEGER NOT NULL);",
    )
    .ok();
}

/// 同一次会话里同一个项目只记一次曝光（UNIQUE(repo_id, session)）。
/// 跨会话重复曝光照记，但统计里要能分开看，否则点击率会被重复展示稀释。
pub fn log_impression(conn: &Connection, repo_id: i64, slot: i64, channel: &str, session: &str) -> Result<i64, String> {
  ensure_event_tables(conn);
  let ts = now_s();
  match conn.execute("INSERT OR IGNORE INTO impression(repo_id, slot, channel, ts, session) VALUES(?1,?2,?3,?4,?5)",
    params![repo_id, slot, channel, ts, session]) {
    Ok(_) => Ok(conn.last_insert_rowid()),
    Err(e) => Err(e.to_string()),
  }
}

/// 曝光去重后的真实触达数
pub fn reach(conn: &Connection) -> i64 {
  conn.query_row("SELECT COUNT(DISTINCT repo_id) FROM impression", [], |r| r.get(0)).unwrap_or(0)
}

pub fn log_event(conn: &Connection, kind: &str, repo_id: i64, payload: Option<String>, imp: Option<i64>) -> Result<String, String> {
  ensure_event_tables(conn);
  conn
    .execute("INSERT INTO event(repo_id, kind, payload, impression_id, ts) VALUES(?1,?2,?3,?4,?5)",
      params![repo_id, kind, payload, imp, now_s()])
    .map_err(|e| e.to_string())?;
  if kind == "star_in_app" {
    conn.execute("INSERT OR IGNORE INTO saved(repo_id, created_at) VALUES(?1,?2)", params![repo_id, now_s()]).ok();
  }
  Ok(format!("{kind} logged"))
}

/// 界面顶部那条统计：D2 之下用户只能看见自己的数据，那就把这块补给他
pub fn stats(conn: &Connection) -> serde_json::Value {
  ensure_event_tables(conn);
  let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
  serde_json::json!({
    "pool": q("SELECT COUNT(1) FROM repo"),
    "ranked": q("SELECT COUNT(1) FROM repo WHERE slope IS NOT NULL"),
    "impressions": q("SELECT COUNT(1) FROM impression"),
    "reach": reach(conn),
    "sessions": q("SELECT COUNT(DISTINCT session) FROM impression"),
    "opens": q("SELECT COUNT(1) FROM event WHERE kind='open'"),
    "hides": q("SELECT COUNT(1) FROM event WHERE kind='hide'"),
    "saved": q("SELECT COUNT(1) FROM saved"),
    "login": current_login(conn),
    "db": db_path()
  })
}

// ================================================================ 两条回路（手册 7.4）
// 回路 A：强信号 → 回写画像词表 → 改变"去 GitHub 捞什么"
// 回路 B：曝光/点开/跳过 → 分桶校准 → 只改变"捞回来的怎么排"
// 混用的失败模式：用户只是没滚到第 15 位，系统却以为他讨厌这个领域，
// 于是把词从画像里删掉、从此不再去搜 —— 兴趣面自我收窄，而且事后从数据上看不出来。

/// 只有这三种事件有资格动画像词表
pub const STRONG_KINDS: &[&str] = &["star_in_app", "copy_clone", "search"];

pub fn apply_feedback(conn: &Connection, login: &str, repo_id: i64, kind: &str, reason: Option<&str>) -> Vec<String> {
  ensure_profile_tables(conn);
  let mut touched = Vec::new();
  if !STRONG_KINDS.contains(&kind) {
    return touched; // 曝光未点、open、hide 都不改词表（hide 走下面的负向）
  }
  let row: Option<(String, Option<String>)> = conn
    .query_row("SELECT full_name, description FROM repo WHERE id=?1", params![repo_id], |r| Ok((r.get(0)?, r.get(1)?)))
    .ok();
  let Some((full, desc)) = row else { return touched };
  let mut seen: BTreeMap<String, usize> = BTreeMap::new();
  for t in tokenize(&format!("{} {}", full.replace('/', " "), desc.unwrap_or_default())) {
    *seen.entry(t).or_insert(0) += 1;
  }
  let mut terms: Vec<String> = seen.keys().cloned().collect();
  terms.sort();
  terms.truncate(6);
  for t in &terms {
    // 收藏过的东西里的词，直接顶到满权重 —— 这是用户主动说"我要更多这类"
    conn.execute(
      "INSERT INTO profile_term(login, term, weight) VALUES(?1,?2,1.0)
       ON CONFLICT(login, term) DO UPDATE SET weight = MAX(profile_term.weight, 1.0)",
      params![login, t],
    )
    .ok();
  }
  touched = terms;
  let _ = reason;
  touched
}

/// 分桶校准：样本不足 MIN_N 的桶一律返回权重 1.0（不生效）。
/// 这条门槛比校准本身重要 —— 几十条数据就敢改排序，等于把噪声当信号。
pub const MIN_N: i64 = 20;

pub fn calibrate(conn: &Connection) -> Result<String, String> {
  ensure_event_tables(conn);
  ensure_profile_tables(conn);
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS feature_stat(feat TEXT NOT NULL, bucket TEXT NOT NULL,
        n INTEGER NOT NULL, n_pos INTEGER NOT NULL, PRIMARY KEY(feat,bucket));
     CREATE TABLE IF NOT EXISTS model_weight(feat TEXT NOT NULL, bucket TEXT NOT NULL,
        w REAL NOT NULL, n INTEGER NOT NULL, fitted_at INTEGER NOT NULL, PRIMARY KEY(feat,bucket));",
  ).map_err(|e| e.to_string())?;

  let sql = "
    WITH b AS (
      SELECT CASE WHEN i.slot < 5 THEN 'slot:top' WHEN i.slot < 20 THEN 'slot:mid' ELSE 'slot:low' END AS slotb,
             i.channel AS chan,
             COALESCE(r.window_kind,'?') AS win,
             CASE WHEN r.spam_flag=1 THEN 'spam:1' ELSE 'spam:0' END AS sp,
             CASE WHEN pl.language IS NOT NULL THEN 'lang:hit' ELSE 'lang:no' END AS lh,
             EXISTS(SELECT 1 FROM event e WHERE e.repo_id=i.repo_id
                    AND e.kind IN ('open','star_in_app','copy_clone','open_in_browser','webview_open')) AS pos
      FROM impression i LEFT JOIN repo r ON r.id=i.repo_id
      LEFT JOIN profile_language pl ON pl.language = r.language
    )
    SELECT 'channel', chan, COUNT(1), SUM(pos) FROM b GROUP BY chan
    UNION ALL SELECT 'window', win, COUNT(1), SUM(pos) FROM b GROUP BY win
    UNION ALL SELECT 'spam',   sp,  COUNT(1), SUM(pos) FROM b GROUP BY sp
    UNION ALL SELECT 'lang',   lh,  COUNT(1), SUM(pos) FROM b GROUP BY lh
    UNION ALL SELECT 'slot',   slotb, COUNT(1), SUM(pos) FROM b GROUP BY slotb";

  let mut rows: Vec<(String, String, i64, i64)> = Vec::new();
  {
    let mut st = conn.prepare(sql).map_err(|e| e.to_string())?;
    let got = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| e.to_string())?;
    for x in got.flatten() { rows.push(x); }
  }
  let tot_n: i64 = rows.iter().map(|x| x.2).sum();
  let tot_p: i64 = rows.iter().map(|x| x.3).sum();
  let global = (tot_p as f64 + 0.05) / (tot_n as f64 + 0.05);
  let ts = now_s();
  let mut live = 0;
  conn.execute("DELETE FROM feature_stat", []).ok();
  conn.execute("DELETE FROM model_weight", []).ok();
  for (feat, bucket, n, pos) in &rows {
    let rate = (*pos as f64 + 0.05) / (*n as f64 + 0.05);
    let w = if *n < MIN_N { 1.0 } else { (rate / global).clamp(0.5, 2.0) };
    if *n >= MIN_N { live += 1; }
    conn.execute("INSERT OR REPLACE INTO feature_stat(feat,bucket,n,n_pos) VALUES(?1,?2,?3,?4)",
      params![feat, bucket, n, pos]).ok();
    conn.execute("INSERT OR REPLACE INTO model_weight(feat,bucket,w,n,fitted_at) VALUES(?1,?2,?3,?4,?5)",
      params![feat, bucket, w, n, ts]).ok();
  }
  let msg = format!("[calibrate] 曝光 {tot_n} 条、正样本 {tot_p}，全局命中率 {:.1}%；桶 {} 个，达到 n>={MIN_N} 的 {live} 个",
    global * 100.0, rows.len());
  Ok(msg)
}

fn weights(conn: &Connection) -> std::collections::HashMap<String, f64> {
  let mut m = std::collections::HashMap::new();
  if let Ok(mut st) = conn.prepare("SELECT feat, bucket, w FROM model_weight") {
    if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))) {
      for (f, b, w) in rows.flatten() { m.insert(format!("{f}={b}"), w); }
    }
  }
  m
}

/// "我的"这一页要的东西：它以为你喜欢什么、你做过什么、哪些桶已经敢动排序。
/// 全部本地读，一个请求都不发（身份与配额由 auth_status 单独给）。
pub fn me_report(conn: &Connection) -> serde_json::Value {
  ensure_profile_tables(conn);
  ensure_event_tables(conn);
  let login = active_login(conn);

  // 两个分支的 query_map 闭包类型不同，不能塞进一个 if 里，所以这里只留"按 login 取"的一种
  let pairs = |sql: &str| -> Vec<(String, f64)> {
    let mut out = Vec::new();
    if let Ok(mut st) = conn.prepare(sql) {
      if let Ok(rows) = st.query_map(params![&login], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))) {
        out = rows.flatten().collect();
      }
    }
    out
  };
  let counts = |sql: &str| -> Vec<(String, i64)> {
    let mut out = Vec::new();
    if let Ok(mut st) = conn.prepare(sql) {
      if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))) {
        out = rows.flatten().collect();
      }
    }
    out
  };
  let one = |sql: &str| -> i64 {
    conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0)
  };

  let terms = if login.is_empty() { Vec::new() } else {
    pairs("SELECT term, weight FROM profile_term WHERE login=?1 ORDER BY weight DESC, term LIMIT 16")
  };
  let langs = if login.is_empty() { Vec::new() } else {
    pairs("SELECT language, weight FROM profile_language WHERE login=?1 ORDER BY weight DESC LIMIT 8")
  };
  let objs = |v: &Vec<(String, f64)>, k: &str| -> Vec<serde_json::Value> {
    v.iter()
      .map(|(name, w)| serde_json::json!({ k: name, "weight": (w * 1000.0).round() / 1000.0 }))
      .collect()
  };

  // 分桶表：n 与是否够到 MIN_N。样本不足的桶权重恒为 1.0，必须让界面标出来，
  // 否则看的人会以为排序已经被自己这几条数据改写了（手册 7.3）。
  let mut buckets: Vec<serde_json::Value> = Vec::new();
  if let Ok(mut st) = conn.prepare(
    "SELECT f.feat, f.bucket, f.n, f.n_pos, COALESCE(m.w, 1.0) \
     FROM feature_stat f LEFT JOIN model_weight m ON m.feat=f.feat AND m.bucket=f.bucket \
     ORDER BY f.feat, f.n DESC",
  ) {
    if let Ok(rows) = st.query_map([], |r| {
      Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?,
          r.get::<_, i64>(3)?, r.get::<_, f64>(4)?))
    }) {
      for (feat, bucket, n, pos, w) in rows.flatten() {
        buckets.push(serde_json::json!({
          "feat": feat, "bucket": bucket, "n": n, "n_pos": pos,
          "w": (w * 100.0).round() / 100.0, "live": n >= MIN_N,
          "ctr": if n > 0 { (pos as f64 * 1000.0 / n as f64).round() / 10.0 } else { 0.0 },
        }));
      }
    }
  }

  // 画像候选必须按 login 数：不这么写的话，刚登录的人词表明明是空的，
  // 页面上却显示着上一个账号留下的 297 个候选——自相矛盾，而且看不出来是谁的。
  let hits = if login.is_empty() { 0 } else {
    conn.query_row("SELECT COUNT(1) FROM feed_hit WHERE channel='profile' AND login=?1",
      params![&login], |r| r.get::<_, i64>(0)).unwrap_or(0)
  };
  let snapshot = if login.is_empty() { 0 } else {
    conn.query_row("SELECT COUNT(1) FROM starred_snapshot WHERE login=?1", params![&login],
      |r| r.get::<_, i64>(0)).unwrap_or(0)
  };

  serde_json::json!({
    "login": login,
    "terms": objs(&terms, "term"),
    "langs": objs(&langs, "language"),
    "min_n": MIN_N,
    "profile_hits": hits,
    "starred_snapshot": snapshot,
    "saved": one("SELECT COUNT(1) FROM saved"),
    "hides": one("SELECT COUNT(1) FROM event WHERE kind='hide'"),
    "kinds": counts("SELECT kind, COUNT(1) FROM event GROUP BY kind ORDER BY 2 DESC"),
    "hide_reasons": counts("SELECT COALESCE(payload,'未填'), COUNT(1) FROM event WHERE kind='hide' GROUP BY 1 ORDER BY 2 DESC"),
    "buckets": buckets,
    "fitted_at": conn.query_row("SELECT MAX(fitted_at) FROM model_weight", [], |r| r.get::<_, Option<i64>>(0)).ok().flatten().unwrap_or(0),
  })
}

fn ensure_profile_cache(conn: &Connection) {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS profile_cache(login TEXT PRIMARY KEY, body TEXT NOT NULL,
        fetched_at INTEGER NOT NULL);",
  ).ok();
}

/// "我的"页面上的 GitHub 侧信息：头像简介、他自己的公开仓库、近 90 天的公开事件日历。
/// 最多 5 个请求（1 用户 + 1 仓库 + 3 页事件），所以带 15 分钟缓存——
/// 在几个页面之间来回切不该把配额烧在这上面。
pub fn my_profile(conn: &Connection, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let login = match current_acct(conn) {
    Some(a) => a.login,
    None => active_login(conn),
  };
  if login.is_empty() { return Err("还没登录账号：这页的头像与仓库要读你自己的 GitHub".into()); }

  const TTL: i64 = 900;
  ensure_profile_cache(conn);
  let ts = now_s();
  if let Ok(body) = conn.query_row(
    "SELECT body FROM profile_cache WHERE login=?1 AND fetched_at > ?2",
    params![&login, ts - TTL], |r| r.get::<_, String>(0)) {
    emit("[profile] 命中 15 分钟缓存，未联网".into());
    return serde_json::from_str(&body).map_err(|e| format!("缓存坏了：{e}"));
  }

  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  let u: Option<serde_json::Value> =
    http.get_json(&format!("/users/{login}"), &BTreeMap::new(), "core", emit);

  let mut rq: BTreeMap<&str, String> = BTreeMap::new();
  rq.insert("per_page", "100".into());
  rq.insert("sort", "updated".into());
  rq.insert("direction", "desc".into());
  let repos: Option<Vec<serde_json::Value>> =
    http.get_json(&format!("/users/{login}/repos"), &rq, "core", emit);

  // 活跃图用的是 REST 的公开事件：GitHub 只给近 90 天、最多 300 条。
  // 这跟 GitHub 页面上那个 "N contributions" 不是同一个口径（那个走 GraphQL，
  // 还含私有仓库），所以界面上必须写清楚是"公开事件"，不要冒充它。
  let mut days: BTreeMap<String, i64> = BTreeMap::new();
  let mut ev_total = 0i64;
  for page in 1..=3i64 {
    let mut pq: BTreeMap<&str, String> = BTreeMap::new();
    pq.insert("per_page", "100".into());
    pq.insert("page", page.to_string());
    let ev: Vec<serde_json::Value> = match http.get_json(
      &format!("/users/{login}/events/public"), &pq, "core", emit) {
      Some(v) => v,
      None => break,
    };
    if ev.is_empty() { break; }
    ev_total += ev.len() as i64;
    for e in &ev {
      if let Some(d) = e["created_at"].as_str().map(|s| s.chars().take(10).collect::<String>()) {
        *days.entry(d).or_insert(0) += 1;
      }
    }
    if (ev.len() as i64) < 100 { break; }
  }

  let thin = |v: &serde_json::Value| serde_json::json!({
    "name": v["name"], "full_name": v["full_name"], "description": v["description"],
    "url": v["html_url"], "language": v["language"], "stars": v["stargazers_count"],
    "forks": v["forks_count"], "issues": v["open_issues_count"], "fork": v["fork"],
    "archived": v["archived"], "pushed_at": v["pushed_at"],
  });
  let mut by_updated: Vec<serde_json::Value> = repos.unwrap_or_default().iter().map(thin).collect();
  by_updated.retain(|r| r["fork"].as_bool() != Some(true));
  let mut by_stars = by_updated.clone();
  let num = |r: &serde_json::Value, k: &str| r[k].as_i64().unwrap_or(0);
  by_stars.sort_by(|a, b| num(b, "stars").cmp(&num(a, "stars")));

  let out = serde_json::json!({
    "login": login,
    "name": u.as_ref().and_then(|v| v["name"].as_str()),
    "bio": u.as_ref().and_then(|v| v["bio"].as_str()),
    "avatar": u.as_ref().and_then(|v| v["avatar_url"].as_str()),
    "location": u.as_ref().and_then(|v| v["location"].as_str()),
    "company": u.as_ref().and_then(|v| v["company"].as_str()),
    "blog": u.as_ref().and_then(|v| v["blog"].as_str()),
    "followers": u.as_ref().and_then(|v| v["followers"].as_i64()),
    "following": u.as_ref().and_then(|v| v["following"].as_i64()),
    "public_repos": u.as_ref().and_then(|v| v["public_repos"].as_i64()),
    "created_at": u.as_ref().and_then(|v| v["created_at"].as_str()),
    "url": u.as_ref().and_then(|v| v["html_url"].as_str()),
    "popular": by_stars.iter().take(6).cloned().collect::<Vec<_>>(),
    "recent": by_updated.iter().take(6).cloned().collect::<Vec<_>>(),
    "repo_count": by_updated.len(),
    "activity": days.iter().map(|(d, c)| serde_json::json!({"date": d, "count": c})).collect::<Vec<_>>(),
    "event_count": ev_total,
    "fetched_at": ts,
  });
  conn.execute("INSERT OR REPLACE INTO profile_cache(login, body, fetched_at) VALUES(?1,?2,?3)",
    params![&login, out.to_string(), ts]).ok();
  emit(format!("[profile] @{login} 仓库 {} 个、事件 {ev_total} 条（{} 天有活动）",
    by_updated.len(), days.len()));
  Ok(out)
}

// ================================================================ 界面要的四个入口（P6）
/// 按通道取一页。channel=None 表示全部。
/// 通道是"内容从哪来"的标签，不是"给用户看第几个 tab"的标签 —— 两者必须能对上，
/// 否则用户切到"画像"看到的却还是热度榜，界面就成了装饰。
pub fn load_channel(conn: &Connection, login: &str, channel: &str, limit: i64, offset: i64) -> Vec<Card> {
  let mut all = load_feed(conn, login, 100_000, 0);
  if !channel.is_empty() && channel != "all" {
    all.retain(|c| match channel {
      "profile" => c.channel == "profile",
      "explore" => c.window == "explore",
      "saved"   => is_saved(conn, c.id),
      _         => c.channel != "profile" && c.window != "explore",
    });
  }
  let off = offset.max(0) as usize;
  all.into_iter().skip(off).take(limit.max(1) as usize).collect()
}

pub fn is_saved(conn: &Connection, repo_id: i64) -> bool {
  conn.query_row("SELECT COUNT(1) FROM saved WHERE repo_id=?1", params![repo_id], |r| r.get::<_, i64>(0))
    .unwrap_or(0) > 0
}

pub fn saved_list(conn: &Connection, login: &str) -> Vec<Card> {
  ensure_event_tables(conn);
  load_channel(conn, login, "saved", 200, 0)
}

/// 探索通道：出生 ≤7 天、star 1..19 的"新生池"，按语言分层随机抽。
/// 这一层不参与混排打分 —— 否则 1..19 的天然低热会被斜率项压死，等于没有探索。
pub fn run_explore(conn: &Connection, per_lang: i64, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_event_tables(conn);
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);
  let langs: Vec<String> = if !current_login(conn).is_empty() {
    conn.prepare("SELECT language FROM profile_language WHERE login=?1 ORDER BY weight DESC LIMIT 6")
      .map(|mut s| s.query_map(params![current_login(conn)], |r| r.get(0)).map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default())
      .unwrap_or_default()
  } else { Vec::new() };
  let langs = if langs.is_empty() {
    vec!["rust".into(), "typescript".into(), "python".into(), "go".into()]
  } else { langs };

  // 没有 rand crate：用纳秒做种子的 LCG，够用来做"每次不一样"
  let mut state = now_s() as u64 ^ (std::process::id() as u64) << 32;
  let mut rnd = move || { state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (state >> 33) as usize };

  let since = ymd(ts / 86_400 - 7);
  let mut total = 0;
  for l in &langs {
    let mut q = BTreeMap::new();
    q.insert("q", format!("created:>{since} stars:1..19 language:{l} archived:false"));
    q.insert("sort", "stars".into());
    q.insert("per_page", "100".into());
    let res: Option<SearchJson> = http.get_json("/search/repositories", &q, "search", emit);
    let Some(s) = res else { continue };
    if s.items.is_empty() { continue }
    let mut idx: Vec<usize> = (0..s.items.len()).collect();
    for i in (1..idx.len()).rev() { let j = rnd() % (i + 1); idx.swap(i, j); }   // 洗牌
    for k in idx.iter().take(per_lang.max(1) as usize) {
      let r = &s.items[*k];
      upsert_repo(conn, r, "explore", ts);
      total += 1;
    }
    emit(format!("[explore] {l:<12} 池 {:<5} 抽 {}", s.total_count, idx.len().min(per_lang as usize)));
    std::thread::sleep(std::time::Duration::from_millis(400));
  }
  let msg = format!("[explore] 共放入 {total} 个新生项目，search 剩余 {}", http.search_left);
  emit(msg.clone());
  Ok(msg)
}

/// 用户主动搜索：既是一次检索，也是回路 A 最强的画像输入（他自己打的字比任何点击推断都可信）
pub fn search_repos(conn: &Connection, query: &str, login: &str, emit: &mut dyn FnMut(String)) -> Result<String, String> {
  ensure_profile_tables(conn);
  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  let mut q = BTreeMap::new();
  q.insert("q", format!("{query} stars:>10 archived:false"));
  q.insert("sort", "stars".into());
  q.insert("per_page", "50".into());
  let res: Option<SearchJson> = http.get_json("/search/repositories", &q, "search", emit);
  let Some(s) = res else { return Err("搜索没返回结果（可能配额不足）".into()) };
  for r in &s.items { upsert_repo(conn, r, "search", ts); }
  if !login.is_empty() {
    for t in tokenize(query).iter().take(6) {
      conn.execute("INSERT INTO profile_term(login, term, weight) VALUES(?1,?2,1.0)
                    ON CONFLICT(login,term) DO UPDATE SET weight = MAX(profile_term.weight, 1.0)",
        params![login, t]).ok();
    }
  }
  let msg = format!("[search] “{query}” 命中 {} 条入库，词已进画像", s.items.len());
  emit(msg.clone());
  Ok(msg)
}

// ================================================================ 设置与翻译
// 翻译是在线服务：开了它，项目简介就会离开这台机器。这与 D2"数据不出本机"
// 有直接张力，所以默认关闭，并且设置页必须把这件事写明白，让用户知情选择。
pub fn ensure_settings(conn: &Connection) {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS setting(key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE IF NOT EXISTS translation(key TEXT PRIMARY KEY, src TEXT NOT NULL,
        zh TEXT NOT NULL, created_at INTEGER NOT NULL);",
  ).ok();
}

pub fn get_settings(conn: &Connection) -> serde_json::Value {
  ensure_settings(conn);
  let mut m = serde_json::Map::new();
  if let Ok(mut st) = conn.prepare("SELECT key, value FROM setting") {
    if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))) {
      for (k, v) in rows.flatten() { m.insert(k, serde_json::Value::String(v)); }
    }
  }
  // 没设过的项用默认值补齐：默认浅色、翻译默认关
  for (k, v) in [("theme", "light"), ("translate_on", "0"),
                 ("translate_url", "https://api.mymemory.translated.net/get"),
                 ("lang", "zh-CN"), ("client_id", ""), ("scopes", "read:user public_repo"),
                 ("proxy_url", ""), ("active_login", "")] {
    if !m.contains_key(k) { m.insert(k.into(), serde_json::Value::String(v.into())); }
  }
  m.insert("has_token".into(), serde_json::Value::Bool(!load_accounts().is_empty()));
  serde_json::Value::Object(m)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
  ensure_settings(conn);
  conn.execute("INSERT OR REPLACE INTO setting(key, value) VALUES(?1,?2)", params![key, value]).map_err(|e| e.to_string())?;
  Ok(())
}

fn fnv(s: &str) -> String {
  let mut h: u64 = 0xcbf2_9ce4_8422_2325;
  for b in s.as_bytes() { h ^= *b as u64; h = h.wrapping_mul(0x1000_0000_01b3); }
  format!("{h:016x}")
}

#[derive(Deserialize)]
struct MM { #[serde(rename = "responseData")] rd: MMData }
#[derive(Deserialize)]
struct MMData { #[serde(rename = "translatedText")] zh: String }

/// 翻译一批文本：先查本地缓存，命中的不再联网；未命中的最多翻 8 条，
/// 因为 MyMemory 匿名额度是按字符算的，一次翻几十条会当场用完。
pub fn translate(conn: &Connection, url: &str, lang: &str, texts: &[String]) -> serde_json::Value {
  ensure_settings(conn);
  let mut out = serde_json::Map::new();
  let mut todo: Vec<String> = Vec::new();
  for t in texts {
    let key = fnv(t);
    let hit: Option<String> = conn
      .query_row("SELECT zh FROM translation WHERE key=?1", params![key], |r| r.get(0))
      .ok();
    match hit {
      Some(z) => { out.insert(t.clone(), serde_json::Value::String(z)); }
      None => { if todo.len() < 8 && !t.trim().is_empty() { todo.push(t.clone()); } }
    }
  }
  let mut net = 0;
  for t in &todo {
    let got = ureq::get(url)
      .query("q", t)
      .query("langpair", &format!("en|{lang}"))
      .header("User-Agent", UA)
      .call()
      .and_then(|mut r| r.body_mut().read_json::<MM>().map_err(|e| ureq::Error::from(e)))
      .map(|v| v.rd.zh)
      .unwrap_or_default();
    net += 1;
    let zh = if got.trim().is_empty() { t.clone() } else { got };
    conn.execute("INSERT OR REPLACE INTO translation(key, src, zh, created_at) VALUES(?1,?2,?3,?4)",
      params![fnv(t), t, zh, now_s()]).ok();
    out.insert(t.clone(), serde_json::Value::String(zh));
  }
  serde_json::json!({ "map": out, "cached": texts.len() - todo.len(), "net": net })
}

// ================================================================ 应用内详情（L1）
// 为什么必须自绘详情而不是直接跳浏览器：停留时长、滚到没滚到 README 底部、
// 看了哪几个 release —— 这些正负标签只在"内容在我们界面里"时才存在。
fn ensure_doc_cache(conn: &Connection) {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS doc_cache(
       repo_id INTEGER PRIMARY KEY, readme TEXT, extra TEXT, fetched_at INTEGER NOT NULL);",
  ).ok();
}

/// 取一个项目的详情：README(官方渲染 HTML) + releases + languages + 本地已有的曲线与理由
pub fn repo_detail(conn: &Connection, id: i64, emit: &mut dyn FnMut(String)) -> serde_json::Value {
  ensure_doc_cache(conn);
  let row: Option<(String, Option<String>, String, i64, i64, i64, i64, Option<String>, Option<f64>, Option<f64>, String, i64)> = conn
    .query_row(
      "SELECT full_name, description, url, stars, forks, open_issues, subscribers, language,
              slope, curvature, window_kind, created_at FROM repo WHERE id=?1",
      params![id],
      |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
              r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?)),
    )
    .ok();
  let Some((full, desc, url, stars, forks, issues, subs, lang, slope, curv, win, created)) = row else {
    return serde_json::json!({ "error": "库里没有这个项目" });
  };

  let ts = now_s();
  let mut http = Http { core_left: 999, search_left: 999, tok: None }.authed();
  http.probe(emit);

  // 缓存 7 天：README 不常改，而每次点开都打三个请求会白烧配额
  let cached: Option<(String, String)> = conn
    .query_row("SELECT readme, extra FROM doc_cache WHERE repo_id=?1 AND fetched_at > ?2",
      params![id, ts - 7 * 86_400], |r| Ok((r.get(0)?, r.get(1)?))).ok();
  let (readme, extra) = match cached {
    Some(v) => { emit("[detail] 命中 7 天内的缓存，未联网".into()); v }
    None => {
      // 第一次不带 html 媒体类型：拿 path / download_url，用来推 raw 基址与默认分支
      let meta: serde_json::Value = G!(&format!("{API}/repos/{full}/readme"))
        .header("User-Agent", UA).header("Accept", "application/vnd.github+json")
        .call().and_then(|mut r| r.body_mut().read_json::<serde_json::Value>().map_err(ureq::Error::from))
        .unwrap_or(serde_json::Value::Null);
      let download_url = meta["download_url"].as_str().unwrap_or("").to_string();
      let rpath = meta["path"].as_str().unwrap_or("README.md").to_string();
      let raw_base = match download_url.rsplit_once('/') { Some((b,_)) => b.to_string(), None => String::new() };
      emit(format!("[readme] path={rpath} raw_base={raw_base}"));
      let readme0 = G!(&format!("{API}/repos/{full}/readme"))
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github.html+json")
        .call()
        .and_then(|r| {
          use std::io::Read;
          let mut buf = String::new();
          let mut r = r;
          r.body_mut().as_reader().read_to_string(&mut buf)?;
          Ok::<String, ureq::Error>(buf)
        })
        .unwrap_or_default();
      let readme = {
        let web_base = format!("https://github.com/{full}");
        let (r, fixed) = rewrite_readme_urls(&readme0, if raw_base.is_empty() { web_base.as_str() } else { raw_base.as_str() }, &web_base);
        emit(format!("[readme] 改写了 {fixed} 个相对路径"));
        r
      };
      let mut q = BTreeMap::new();
      q.insert("per_page", "5".into());
      let rel: Option<serde_json::Value> = http.get_json(&format!("/repos/{full}/releases"), &q, "core", emit);
      let langs: Option<serde_json::Map<String, serde_json::Value>> =
        http.get_json(&format!("/repos/{full}/languages"), &BTreeMap::new(), "core", emit);
      let mut pairs: Vec<(String, f64)> = langs.unwrap_or_default().into_iter()
        .map(|(k, v)| (k, v.as_f64().unwrap_or(0.0))).collect();
      pairs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
      // /languages 返回的是字节数，不是百分比 —— 得先求和再折算
      let tot: f64 = pairs.iter().map(|(_, v)| *v).sum::<f64>().max(1.0);
      let names: Vec<String> = pairs.into_iter().take(5)
        .map(|(k, v)| format!("{k} {:.1}%", v / tot * 100.0)).collect();
      let rel_s = rel.map(|v| {
        let arr = v.as_array().cloned().unwrap_or_default();
        arr.iter().take(4).map(|x| format!("{}|{}|{}",
          x["tag_name"].as_str().unwrap_or("?"),
          x["name"].as_str().unwrap_or(""),
          x["published_at"].as_str().unwrap_or("").get(..10).unwrap_or(""))).collect::<Vec<_>>().join("\n")
      }).unwrap_or_default();
      let extra = serde_json::json!({ "releases": rel_s, "langs": names }).to_string();
      conn.execute("INSERT OR REPLACE INTO doc_cache(repo_id, readme, extra, fetched_at) VALUES(?1,?2,?3,?4)",
        params![id, readme, extra, ts]).ok();
      (readme, extra)
    }
  };
  let extra_v: serde_json::Value = serde_json::from_str(&extra).unwrap_or(serde_json::json!({}));

  let weeks: Vec<i64> = conn
    .prepare("SELECT total FROM star_week WHERE repo_id=?1 ORDER BY week DESC LIMIT 12")
    .map(|mut s| s.query_map(params![id], |r| r.get(0)).map(|x| x.filter_map(|y| y.ok()).collect()).unwrap_or_default())
    .unwrap_or_default();
  let saved: bool = conn.query_row("SELECT COUNT(1) FROM saved WHERE repo_id=?1", params![id], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0;

  serde_json::json!({
    "id": id, "full_name": full, "description": desc, "url": url,
    "stars": stars, "forks": forks, "open_issues": issues, "subscribers": subs,
    "language": lang, "slope": slope, "curvature": curv, "window": win,
    "age_days": (ts - created) / 86_400, "weeks": weeks, "saved": saved,
    "readme_html": readme, "releases": extra_v["releases"], "langs": extra_v["langs"]
  })
}

/// 逃生舱：源码树、blame、CI 日志这些 API 拿不全的东西，在应用内开一个独立 WebView 窗口看。
/// 只记 URL 级事件，不去解析 GitHub 的 DOM。
pub fn open_webview(app: &tauri::AppHandle, url: &str, repo_id: i64) -> Result<String, String> {
  use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
  let label = format!("gh-{}", repo_id);
  if let Some(w) = app.get_webview_window(&label) { let _ = w.set_focus(); return Ok("已置顶既有窗口".into()); }
  let parsed: tauri::Url = url.parse().map_err(|e| format!("URL 不合法 {e}"))?;
  WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
    .title("GitHub · 应用内浏览")
    .inner_size(1160.0, 800.0)
    .build().map_err(|e| format!("开窗失败 {e}"))?;
  let conn = open_db()?;
  let _ = log_event(&conn, "webview_open", repo_id, Some(url.into()), None);
  Ok("已打开应用内浏览窗口".into())
}

// ================================================================ 仓库视图：树 / 单文件 / Issues / PR
// 这条把 D9 的边界往前挪了一小步，但只挪一步：这里取的是**读材与列表**
// （文件树、单个文件内容、issue 列表、PR 列表）。blame、CI 日志、Discussions
// 仍然按 9.6 的结论交给内嵌 WebView，不在应用里重造 GitHub 前端。
// 缓存分三档：分支 1 天、树 1 小时、文件 6 小时、issue/PR 10 分钟 ——
// 因为切来切去的是同几个仓库，不缓存会在几分钟里把 5000 次/小时烧穿。

fn ensure_repo_files(conn: &Connection) {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS repo_file(repo_id INTEGER NOT NULL, path TEXT NOT NULL,
        kind TEXT NOT NULL, body TEXT NOT NULL, fetched_at INTEGER NOT NULL,
        PRIMARY KEY(repo_id, path, kind));",
  ).ok();
}

fn repo_full(conn: &Connection, id: i64) -> Option<String> {
  conn.query_row("SELECT full_name FROM repo WHERE id=?1", params![id], |r| r.get::<_, String>(0)).ok()
}

fn cache_get(conn: &Connection, id: i64, path: &str, kind: &str, ttl: i64) -> Option<String> {
  conn.query_row("SELECT body FROM repo_file WHERE repo_id=?1 AND path=?2 AND kind=?3 AND fetched_at > ?4",
    params![id, path, kind, now_s() - ttl], |r| r.get::<_, String>(0)).ok()
}

fn cache_put(conn: &Connection, id: i64, path: &str, kind: &str, body: &str) {
  ensure_repo_files(conn);
  conn.execute("INSERT OR REPLACE INTO repo_file(repo_id, path, kind, body, fetched_at) VALUES(?1,?2,?3,?4,?5)",
    params![id, path, kind, body, now_s()]).ok();
}

/// URL 路径段要百分号编码（空格是 %20 不是 +，跟表单编码不一样），但 '/' 要留着
fn path_encode(s: &str) -> String {
  s.bytes().map(|b| match b {
    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
    _ => format!("%{b:02X}"),
  }).collect()
}

/// 默认分支：树要按分支名取，而库里没存这个字段，所以现拿一次并缓存一天
fn default_branch(conn: &Connection, id: i64, full: &str, emit: &mut dyn FnMut(String)) -> String {
  if let Some(c) = cache_get(conn, id, "", "branch", 86_400) { return c; }
  let v: Option<serde_json::Value> = {
    let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
    h.get_json(&format!("/repos/{full}"), &BTreeMap::new(), "core", emit)
  };
  let b = v.and_then(|x| x["default_branch"].as_str().map(|s| s.to_string()))
    .unwrap_or_else(|| "main".into());
  emit(format!("[tree] 默认分支 {b}"));
  cache_put(conn, id, "", "branch", &b);
  b
}

/// 文件树：一次 recursive 请求拿全，前端自己折叠。上限 4000 条，超了标 truncated。
pub fn repo_tree(conn: &Connection, id: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = repo_full(conn, id).ok_or("库里没有这个项目")?;
  if let Some(c) = cache_get(conn, id, "", "tree", 3_600) {
    emit("[tree] 命中 1 小时缓存".into());
    return Ok(serde_json::from_str(&c).map_err(|e| e.to_string())?);
  }
  let branch = default_branch(conn, id, &full, emit);
  let mut q = BTreeMap::new();
  q.insert("recursive", "1".to_string());
  let v: Option<serde_json::Value> = {
    let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
    h.probe(emit);
    h.get_json(&format!("/repos/{full}/git/trees/{branch}"), &q, "core", emit)
  };
  let v = v.ok_or("取不到文件树（仓库可能是空的，或配额不够）")?;
  let mut entries: Vec<serde_json::Value> = v["tree"].as_array().map(|arr| {
    arr.iter().filter_map(|e| {
      let p = e["path"].as_str()?;
      Some(serde_json::json!({
        "path": p,
        "dir": e["type"].as_str() == Some("tree"),
        "size": e["size"].as_i64().unwrap_or(0),
      }))
    }).collect()
  }).unwrap_or_default();
  let over = entries.len() > 4_000;
  if over { entries.truncate(4_000); }
  entries.sort_by(|a, b| a["path"].as_str().unwrap_or("").cmp(b["path"].as_str().unwrap_or("")));
  let out = serde_json::json!({
    "branch": branch, "entries": entries, "count": entries.len(),
    "truncated": over || v["truncated"].as_bool().unwrap_or(false),
  });
  cache_put(conn, id, "", "tree", &out.to_string());
  emit(format!("[tree] {} 条（分支 {branch}）", entries.len()));
  Ok(out)
}

/// 单个文件内容：走官方 raw 媒体类型，省掉 base64 解码这一步。
/// 超过 200KB 只给前 200KB 并说明；含 NUL 字节就当二进制不预览。
pub fn repo_file_read(conn: &Connection, id: i64, path: &str, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = repo_full(conn, id).ok_or("库里没有这个项目")?;
  const MAX: usize = 200_000;
  if let Some(c) = cache_get(conn, id, path, "file", 6 * 3_600) {
    return Ok(serde_json::from_str(&c).map_err(|e| e.to_string())?);
  }
  let url = format!("{API}/repos/{full}/contents/{}", path_encode(path));
  let body = G!(&url)
    .header("User-Agent", UA)
    .header("Accept", "application/vnd.github.raw")
    .call()
    .and_then(|r| {
      use std::io::Read;
      let mut buf = Vec::new();
      let mut r = r;
      r.body_mut().as_reader().take((MAX + 1) as u64).read_to_end(&mut buf)?;
      Ok::<Vec<u8>, ureq::Error>(buf)
    })
    .map_err(|e| format!("读不到 {path}：{e}"))?;
  let binary = body.contains(&0u8);
  let text = String::from_utf8_lossy(&body).to_string();
  let out = serde_json::json!({
    "path": path,
    "bytes": body.len(),
    "truncated": body.len() > MAX,
    "binary": binary,
    "text": if binary { String::new() } else { text.chars().take(MAX).collect::<String>() },
  });
  cache_put(conn, id, path, "file", &out.to_string());
  emit(format!("[file] {path} {}B{}", body.len(), if binary { "（二进制，不预览）" } else { "" }));
  Ok(out)
}

/// issue 与 PR 列表。GitHub 的 /issues 会把 PR 一起返回（带 pull_request 字段），
/// 所以 kind=issue 时必须把它们滤掉，否则两个列表看起来一样。
pub fn repo_list(conn: &Connection, id: i64, kind: &str, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = repo_full(conn, id).ok_or("库里没有这个项目")?;
  let kind = if kind == "pull" { "pull" } else { "issue" };
  if let Some(c) = cache_get(conn, id, "", kind, 600) {
    return Ok(serde_json::from_str(&c).map_err(|e| e.to_string())?);
  }
  let mut q = BTreeMap::new();
  q.insert("state", "open".to_string());
  q.insert("per_page", "30".to_string());
  q.insert("sort", "created".to_string());
  let path = if kind == "pull" { format!("/repos/{full}/pulls") } else { format!("/repos/{full}/issues") };
  let v: Option<Vec<serde_json::Value>> = {
    let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
    h.probe(emit);
    h.get_json(&path, &q, "core", emit)
  };
  let rows = v.unwrap_or_default();
  let items: Vec<serde_json::Value> = rows.iter()
    .filter(|x| if kind == "issue" { x.get("pull_request").is_none() } else { true })
    .map(|x| serde_json::json!({
      "number": x["number"],
      "title": x["title"].as_str().unwrap_or(""),
      "author": x["user"]["login"].as_str().unwrap_or(""),
      "created_at": x["created_at"].as_str().unwrap_or(""),
      "comments": x["comments"].as_i64().or_else(|| x["review_comments"].as_i64()).unwrap_or(0),
      "draft": x["draft"].as_bool().unwrap_or(false),
      "labels": x["labels"].as_array().map(|a| a.iter().filter_map(|l| l["name"].as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default(),
    }))
    .collect();
  let out = serde_json::json!({ "kind": kind, "items": items, "count": items.len() });
  cache_put(conn, id, "", kind, &out.to_string());
  emit(format!("[{kind}] {} 条", items.len()));
  Ok(out)
}

// ================================================================ 应用内的 issue / PR / Actions
// 边界（2026-10-06 他的要求）：点 issue / PR **不许跳系统浏览器**，能在应用内看的一律在应用内看；
// 真做不了的（Insights 要仓库权限、Projects 只有 GraphQL、Security 要权限）才退回**应用内 WebView**。
// 这一层仍然是只读：不发评论、不合并、不 resolve。
//
// 正文一律走 `application/vnd.github.html+json` 拿 body_html（跟 README 同一条路，不引 markdown 库）；
// 缓存按"变不变"分档：详情与评论 10 分钟、diff 1 小时、Actions 5 分钟。

const ACCEPT_HTML: &str = "application/vnd.github.html+json";

fn gh_full(conn: &Connection, id: i64) -> Result<String, String> {
  repo_full(conn, id).ok_or_else(|| "库里没有这个项目".to_string())
}

fn labels_of(v: &serde_json::Value) -> Vec<serde_json::Value> {
  v["labels"].as_array().map(|a| {
    a.iter().filter_map(|l| {
      let name = l["name"].as_str()?;
      Some(serde_json::json!({ "name": name, "color": l["color"].as_str().unwrap_or("") }))
    }).collect()
  }).unwrap_or_default()
}

/// 单条 issue 的详情。注意 GitHub 的 `/issues/{n}` 对 PR 号也成立（返回它的 issue 侧面），
/// 所以这里给出 `is_pull`，前端据此决定要不要再去拉 diff。
pub fn issue_detail(conn: &Connection, id: i64, number: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = gh_full(conn, id)?;
  let key = format!("#{number}");
  if let Some(c) = cache_get(conn, id, &key, "issue", 600) {
    emit("[issue] 命中 10 分钟缓存".into());
    return serde_json::from_str(&c).map_err(|e| e.to_string());
  }
  let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
  h.probe(emit);
  let v: Option<serde_json::Value> =
    h.get_json_as(&format!("/repos/{full}/issues/{number}"), &BTreeMap::new(), "core", ACCEPT_HTML, emit);
  let v = v.ok_or("取不到这条 issue（可能已删、或配额不够）")?;
  let out = serde_json::json!({
    "number": v["number"],
    "is_pull": !v["pull_request"].is_null(),
    "title": v["title"].as_str().unwrap_or(""),
    "url": v["html_url"].as_str().unwrap_or(""),
    "state": v["state"].as_str().unwrap_or(""),
    "state_reason": v["state_reason"].as_str().unwrap_or(""),
    "author": v["user"]["login"].as_str().unwrap_or(""),
    "created_at": v["created_at"].as_str().unwrap_or(""),
    "closed_at": v["closed_at"].as_str().unwrap_or(""),
    "comments": v["comments"].as_i64().unwrap_or(0),
    "labels": labels_of(&v),
    "body_html": v["body_html"].as_str().unwrap_or(""),
    "reactions": v["reactions"]["total_count"].as_i64().unwrap_or(0),
  });
  cache_put(conn, id, &key, "issue", &out.to_string());
  emit(format!("[issue] #{number}「{}」正文 {} 字符", out["title"].as_str().unwrap_or(""), out["body_html"].as_str().map(|s| s.chars().count()).unwrap_or(0)));
  Ok(out)
}

/// 一条 issue / PR 的评论（PR 与 issue 共用这个端点）
pub fn issue_comments(conn: &Connection, id: i64, number: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = gh_full(conn, id)?;
  let key = format!("#{number}");
  if let Some(c) = cache_get(conn, id, &key, "comments", 600) {
    emit("[comments] 命中 10 分钟缓存".into());
    return serde_json::from_str(&c).map_err(|e| e.to_string());
  }
  let mut q = BTreeMap::new();
  q.insert("per_page", "100".to_string());
  let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
  h.probe(emit);
  let v: Option<Vec<serde_json::Value>> =
    h.get_json_as(&format!("/repos/{full}/issues/{number}/comments"), &q, "core", ACCEPT_HTML, emit);
  let rows = v.unwrap_or_default();
  let items: Vec<serde_json::Value> = rows.iter().map(|c| serde_json::json!({
    "author": c["user"]["login"].as_str().unwrap_or(""),
    "association": c["author_association"].as_str().unwrap_or(""),
    "created_at": c["created_at"].as_str().unwrap_or(""),
    "body_html": c["body_html"].as_str().unwrap_or(""),
  })).collect();
  let out = serde_json::json!({ "count": items.len(), "items": items });
  cache_put(conn, id, &key, "comments", &out.to_string());
  emit(format!("[comments] #{number} {} 条", items.len()));
  Ok(out)
}

/// PR 的主体信息：改动量、分支、草稿/合并状态。正文同样用 html 媒体类型
pub fn pr_detail(conn: &Connection, id: i64, number: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = gh_full(conn, id)?;
  let key = format!("#{number}");
  if let Some(c) = cache_get(conn, id, &key, "pr", 600) {
    emit("[pr] 命中 10 分钟缓存".into());
    return serde_json::from_str(&c).map_err(|e| e.to_string());
  }
  let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
  h.probe(emit);
  let v: Option<serde_json::Value> =
    h.get_json_as(&format!("/repos/{full}/pulls/{number}"), &BTreeMap::new(), "core", ACCEPT_HTML, emit);
  let v = v.ok_or("取不到这个 PR")?;
  let out = serde_json::json!({
    "number": v["number"],
    "title": v["title"].as_str().unwrap_or(""),
    "url": v["html_url"].as_str().unwrap_or(""),
    "state": v["state"].as_str().unwrap_or(""),
    "draft": v["draft"].as_bool().unwrap_or(false),
    "merged": v["merged"].as_bool().unwrap_or(false),
    "mergeable_state": v["mergeable_state"].as_str().unwrap_or(""),
    "author": v["user"]["login"].as_str().unwrap_or(""),
    "created_at": v["created_at"].as_str().unwrap_or(""),
    "base": v["base"]["ref"].as_str().unwrap_or(""),
    "head": v["head"]["ref"].as_str().unwrap_or(""),
    "additions": v["additions"].as_i64().unwrap_or(0),
    "deletions": v["deletions"].as_i64().unwrap_or(0),
    "changed_files": v["changed_files"].as_i64().unwrap_or(0),
    "commits": v["commits"].as_i64().unwrap_or(0),
    "review_comments": v["review_comments"].as_i64().unwrap_or(0),
    "labels": labels_of(&v),
    "body_html": v["body_html"].as_str().unwrap_or(""),
  });
  cache_put(conn, id, &key, "pr", &out.to_string());
  emit(format!("[pr] #{number} +{}/-{} {} 文件", out["additions"], out["deletions"], out["changed_files"]));
  Ok(out)
}

/// PR 的变更文件与逐文件 patch（unified diff）。diff 一旦生成就不会变，所以缓存 1 小时。
/// 单个文件的 patch 截到 20k 字符——大文件整段塞进 webview 会把渲染拖死，够看就行。
pub fn pr_files(conn: &Connection, id: i64, number: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = gh_full(conn, id)?;
  let key = format!("#{number}");
  if let Some(c) = cache_get(conn, id, &key, "files", 3_600) {
    emit("[files] 命中 1 小时缓存".into());
    return serde_json::from_str(&c).map_err(|e| e.to_string());
  }
  const MAX_PATCH: usize = 20_000;
  let mut q = BTreeMap::new();
  q.insert("per_page", "100".to_string());
  let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
  h.probe(emit);
  let v: Option<Vec<serde_json::Value>> =
    h.get_json_as(&format!("/repos/{full}/pulls/{number}/files"), &q, "core", "application/vnd.github+json", emit);
  let rows = v.unwrap_or_default();
  let items: Vec<serde_json::Value> = rows.iter().map(|f| {
    let patch = f["patch"].as_str().unwrap_or("");
    let cut = patch.chars().count() > MAX_PATCH;
    serde_json::json!({
      "filename": f["filename"].as_str().unwrap_or(""),
      "status": f["status"].as_str().unwrap_or(""),
      "additions": f["additions"].as_i64().unwrap_or(0),
      "deletions": f["deletions"].as_i64().unwrap_or(0),
      "changes": f["changes"].as_i64().unwrap_or(0),
      "patch": if cut { patch.chars().take(MAX_PATCH).collect::<String>() } else { patch.to_string() },
      "patch_truncated": cut,
      "binary": f["patch"].is_null(),
    })
  }).collect();
  let out = serde_json::json!({ "count": items.len(), "truncated": rows.len() >= 100, "items": items });
  cache_put(conn, id, &key, "files", &out.to_string());
  emit(format!("[files] #{number} {} 个文件", items.len()));
  Ok(out)
}

/// 最近的 Actions 运行。**只能读到列表**：日志下载要仓库权限，所以点一条 run 是走应用内 WebView。
pub fn actions_runs(conn: &Connection, id: i64, emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let full = gh_full(conn, id)?;
  if let Some(c) = cache_get(conn, id, "", "actions", 300) {
    emit("[actions] 命中 5 分钟缓存".into());
    return serde_json::from_str(&c).map_err(|e| e.to_string());
  }
  let mut q = BTreeMap::new();
  q.insert("per_page", "30".to_string());
  let mut h = Http { core_left: 999, search_left: 999, tok: None }.authed();
  h.probe(emit);
  let v: Option<serde_json::Value> =
    h.get_json_as(&format!("/repos/{full}/actions/runs"), &q, "core", "application/vnd.github+json", emit);
  let v = v.ok_or("取不到 Actions 运行（这个仓库可能没开 Actions）")?;
  let items: Vec<serde_json::Value> = v["workflow_runs"].as_array().map(|a| a.iter().map(|r| serde_json::json!({
    "id": r["id"],
    "name": r["name"].as_str().unwrap_or(""),
    "title": r["display_title"].as_str().unwrap_or(""),
    "status": r["status"].as_str().unwrap_or(""),
    "conclusion": r["conclusion"].as_str().unwrap_or(""),
    "event": r["event"].as_str().unwrap_or(""),
    "branch": r["head_branch"].as_str().unwrap_or(""),
    "run_number": r["run_number"].as_i64().unwrap_or(0),
    "created_at": r["created_at"].as_str().unwrap_or(""),
    "url": r["html_url"].as_str().unwrap_or(""),
  })).collect()).unwrap_or_default();
  let out = serde_json::json!({ "total": v["total_count"].as_i64().unwrap_or(0), "count": items.len(), "items": items });
  cache_put(conn, id, "", "actions", &out.to_string());
  emit(format!("[actions] 共 {} 次运行，取回 {} 条", out["total"], items.len()));
  Ok(out)
}

// ================================================================ 凭据与"用我自己的账号"
// token 只存 accounts.json，不进 SQLite —— 把库文件拷走或发给别人调试时不会连带把凭据带出去。
// 正式版本要换成系统钥匙串（Windows 凭据管理器 / Keychain / Secret Service），因为
// "同机同用户攻击者能读整个 AppData"这个威胁模型下，放文件并不比放库更安全。
//
// 这里曾经并存两条路：单 token 的 cred.bin（原型第一版）和账号表 accounts.json（多账号版）。
// 后果是"界面上把账号删了，token 其实还在被 token_for 用"。删掉 cred.bin 这条路，
// 账号表就是唯一真相；本机磁盘上原本也没有 cred.bin，不需要迁移。

impl Http {
  fn authed(mut self) -> Self {
    if let Ok(c) = open_db() { if let Some(t) = token_for(&c) { self.tok = Some(t); } }
    self
  }
}

/// 界面只问一句话：我现在是谁、还能发多少次请求、scope 够不够。
/// `/rate_limit` 不计配额，所以这个可以随便刷；带 token 却回 401 就说明凭据已经失效。
pub fn auth_status(emit: &mut dyn FnMut(String)) -> Result<serde_json::Value, String> {
  let conn = open_db()?;
  let list = load_accounts();
  let acct = current_acct(&conn);
  let who = acct.clone().map(|a| a.login).unwrap_or_default();

  let mut req = G!(&format!("{API}/rate_limit"))
    .header("User-Agent", UA)
    .header("Accept", "application/vnd.github+json");
  if let Some(a) = &acct { req = req.header("Authorization", format!("Bearer {}", a.token)); }

  let mut hdr_scopes = String::new();
  let v: serde_json::Value = match req.call() {
    Ok(mut r) => {
      if let Some(s) = r.headers().get("x-oauth-scopes").and_then(|x| x.to_str().ok()) {
        hdr_scopes = s.to_string();
      }
      r.body_mut().read_json().map_err(|e| e.to_string())?
    }
    Err(e) => {
      let t = format!("{e}");
      if t.contains("401") || t.contains("403") {
        emit(format!("[auth] token 已失效: {t}"));
        return Ok(serde_json::json!({
          "authed": false, "invalid": true, "login": who,
          "error": "凭据已被撤销或过期（GitHub 回 401/403）—— 删掉这个账号重新登录" }));
      }
      emit(format!("[auth] 读不到配额: {t}"));
      return Ok(serde_json::json!({ "authed": acct.is_some(), "login": who, "error": t,
        "hint": "读不到配额不等于没登录：可能是网络或代理不通" }));
    }
  };

  let pool = |k: &str| serde_json::json!({
    "limit": v["resources"][k]["limit"],
    "remaining": v["resources"][k]["remaining"],
    "resets_at": v["resources"][k]["reset"],
  });
  let scopes = if !hdr_scopes.is_empty() {
    hdr_scopes
  } else {
    acct.clone().map(|a| a.scopes).unwrap_or_default()
  };
  emit(format!("[auth] {} login={} core={}/{}",
    if acct.is_some() { "认证态" } else { "匿名态" },
    if who.is_empty() { "-".to_string() } else { who.clone() },
    v["resources"]["core"]["remaining"], v["resources"]["core"]["limit"]));
  Ok(serde_json::json!({
    "authed": acct.is_some(),
    "login": who,
    "mode": acct.clone().map(|a| a.auth_mode).unwrap_or_default(),
    "scopes": scopes,
    "missing_scope": missing_scopes(&scopes),
    "core": pool("core"),
    "search": pool("search"),
    "graphql": pool("graphql"),
    "accounts": list.len(),
    "cred_file": accounts_path(),
  }))
}

/// 画像回路要读你自己的收藏与仓库，这两个 scope 缺一个就会静默失败。
/// fine-grained token 不回 scope，所以只提示、不拦。
pub fn missing_scopes(scopes: &str) -> Vec<&'static str> {
  if scopes.is_empty() { return Vec::new(); }
  let has = |w: &str| scopes.split(',').any(|s| s.trim() == w);
  let mut miss = Vec::new();
  if !has("read:user") && !has("repo") { miss.push("read:user"); }
  if !has("public_repo") && !has("repo") { miss.push("public_repo"); }
  miss
}

/// 用系统默认浏览器打开外链。
/// 为什么非要一个命令：Tauri 2 默认会把 `window.open` 和 `target="_blank"` 吞掉
/// （没装 opener 插件、也没挂 on_new_window），点了没反应还不报错。
/// 只放行 github.com 的 https 地址：这个口子一旦变成"任何字符串都交给浏览器"，
/// README 里一个链接就够了。
pub fn open_external(url: &str) -> Result<String, String> {
  let u = url.trim();
  let ok = u.starts_with("https://github.com/") || u.starts_with("https://www.github.com/");
  if !ok { return Err(format!("只允许打开 github.com 的 https 链接，收到：{u}")); }
  let r = {
    #[cfg(windows)]
    { std::process::Command::new("explorer").arg(u).spawn() }
    #[cfg(not(windows))]
    { std::process::Command::new("xdg-open").arg(u).spawn() }
  };
  r.map(|_| "已在系统浏览器打开".to_string()).map_err(|e| format!("打不开系统浏览器：{e}"))
}

pub fn active_login(conn: &Connection) -> String {
  let s = get_settings(conn);
  match s.get("active_login").and_then(|v| v.as_str()) {
    Some(l) if !l.is_empty() => l.to_string(),
    _ => current_login(conn),
  }
}

/// 通用认证探针（CLI 用）：带**当前账号**的 token 打一个任意路径，返回 (状态码, 响应体)。
/// 存在的意义是把"端点不给 / 我们的凭据或参数不对"这类二分问题当场排掉——猜是没用的。
/// 实测案例：`/repos/{o}/{r}/stargazers` 匿名 401，而我们带 token 时拿到 404，方向反了。
pub fn probe_get(path: &str, accept: &str) -> Result<(u16, String), String> {
  let mut req = G!(&format!("{API}{path}")).header("User-Agent", UA).header("Accept", accept);
  if let Ok(conn) = open_db() {
    if let Some(t) = token_for(&conn) {
      req = req.header("Authorization", format!("Bearer {t}"));
    }
  }
  match req.call() {
    Ok(mut r) => {
      let code = r.status().as_u16();
      use std::io::Read;
      let mut buf = String::new();
      r.body_mut().as_reader().read_to_string(&mut buf).map_err(|e| e.to_string())?;
      Ok((code, buf))
    }
    Err(e) => Err(e.to_string()),
  }
}


// ================================================================ 代理支持
// 实测：api.github.com 可直连，但 github.com（设备码端点、徽章图片）在本机直连是被重置的，
// 而 ureq 不读 Windows 系统代理。企业网络/代理环境下这不是可选项，必须内建。
static AGENT: std::sync::OnceLock<ureq::Agent> = std::sync::OnceLock::new();

fn proxy_setting() -> String {
  if let Ok(v) = std::env::var("GHFIND_PROXY") { if !v.is_empty() { return v; } }
  for k in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
    if let Ok(v) = std::env::var(k) { if !v.is_empty() && !v.contains("<") { return v; } }
  }
  open_db().ok().and_then(|c| get_settings(&c).get("proxy_url").and_then(|v| v.as_str()).map(|s| s.to_string())).unwrap_or_default()
}

fn agent() -> &'static ureq::Agent {
  AGENT.get_or_init(|| {
    let mut cb = ureq::Agent::config_builder();
    // 全局超时是必须的：没有它，连不上的主机要等到 TCP 自己放弃，界面看起来像死了
    cb = cb.timeout_global(Some(std::time::Duration::from_secs(45)));
    let p = proxy_setting();
    if !p.trim().is_empty() {
      match ureq::Proxy::new(p.trim()) {
        Ok(px) => { cb = cb.proxy(Some(px)); eprintln!("[proxy] 走 {p}"); }
        Err(e) => eprintln!("[proxy] 配置无效 {p}: {e} —— 改为直连"),
      }
    }
    cb.build().into()
  })
}

/// 换过代理设置后要重建 agent，否则进程内一直用旧的
pub fn reset_agent() {
  if let Some(v) = AGENT.get() { let _ = v; }
  // OnceLock 不支持重置：用一个新进程外部的做法——这里改为记录到文件并由调用方重启生效
}

pub fn proxy_now() -> String { proxy_setting() }



// ================================================================ README 相对路径改写
// GitHub 网页会把 README 里的相对图片路径改写成仓库地址，但 API 的 html 渲染**不改写**。
// 不处理的后果很阴：src="docs/x.png" 会被解析成 http://tauri.localhost/docs/x.png，
// 而 Tauri 的资源服务器对未知路径返回 200 + index.html —— 图片既不报错也永远出不来。
pub fn rewrite_readme_urls(html: &str, raw_base: &str, web_base: &str) -> (String, usize) {
  let mut n = 0usize;
  let mut out = String::with_capacity(html.len());
  let bytes = html.as_bytes();
  let mut i = 0usize;
  while i < bytes.len() {
    // 找下一个 src=" 或 href=" 或 srcset="
    let rest = &html[i..];
    let (attr, is_link, is_set) = if let Some(p) = rest.find("src=\"") { (p, false, false) }
      else if let Some(p) = rest.find("href=\"") { (p, true, false) }
      else if let Some(p) = rest.find("srcset=\"") { (p, false, true) }
      else { out.push_str(rest); break; };
    let head_end = i + attr + if is_set { 7 } else { 5 };
    out.push_str(&html[i..head_end]);
    let close = match html[head_end..].find('"') { Some(p) => head_end + p, None => { out.push_str(&html[head_end..]); break; } };
    let val = &html[head_end..close];
    let new = if val.is_empty() || val.starts_with('#') || val.starts_with("data:")
      || val.starts_with("http://") || val.starts_with("https://") || val.starts_with("//") || val.starts_with("mailto:") {
      val.to_string()
    } else {
      n += 1;
      let clean = val.trim_start_matches("./");
      let (base, path) = if clean.starts_with('/') {
        (web_base.trim_end_matches("/tree").to_string(), clean.to_string())   // 根相对：给仓库页域名
      } else {
        (raw_base.to_string(), format!("/{}", clean))
      };
      format!("{}{}", base.trim_end_matches('/'), path)
    };
    out.push_str(&new);
    out.push('"');
    i = close + 1;
  }
  (out, n)
}

// ================================================================ 多账号与设备码登录
// 凭据一律不进 SQLite：存成本机单独文件，拷库文件不会带出 token。
// 正式版应换成系统钥匙串（Windows 凭据管理器 / macOS Keychain / Linux Secret Service）。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct Acct {
  pub login: String,
  pub user_id: i64,
  pub token: String,
  pub auth_mode: String,      // pat | oauth_device
  pub scopes: String,
  pub added_at: i64,
}

fn accounts_path() -> String {
  let dir = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("APPDATA")).unwrap_or_else(|_| ".".into());
  format!("{dir}\\gh-feed\\accounts.json")
}

pub fn load_accounts() -> Vec<Acct> {
  std::fs::read_to_string(accounts_path())
    .ok()
    .and_then(|s| serde_json::from_str::<Vec<Acct>>(&s).ok())
    .unwrap_or_default()
}

fn save_accounts(list: &[Acct]) -> Result<(), String> {
  if let Some(p) = std::path::Path::new(&accounts_path()).parent() { std::fs::create_dir_all(p).ok(); }
  std::fs::write(accounts_path(), serde_json::to_string_pretty(list).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())
}

pub fn upsert_account(a: Acct) -> Result<(), String> {
  let mut list = load_accounts();
  match list.iter_mut().find(|x| x.login == a.login) {
    Some(slot) => *slot = a,
    None => list.push(a),
  }
  save_accounts(&list)
}

pub fn remove_account(login: &str) -> Result<(), String> {
  let mut list = load_accounts();
  list.retain(|x| x.login != login);
  save_accounts(&list)?;
  // 删掉的是当前生效的那个就必须把 active_login 清掉：否则"建我的画像"会拿一个
  // 已经不存在的账号去跑，请求退回匿名额度，而词表写在那个 login 名下——静默错位。
  let conn = open_db()?;
  if active_login(&conn) == login { set_setting(&conn, "active_login", "")?; }
  Ok(())
}

/// 当前真正带着 token 的账号：优先按 active_login 匹配；没设过就用唯一的那个。
/// 账号表是唯一真相——别再往回退路径上加第二个凭据文件。
/// 注意这跟 `active_login()` 不是一回事：后者会退回 profile_term 里的词表归属，
/// 那个 login 可能根本没有对应凭据（借来的公开账号就是这种）。
pub fn current_acct(conn: &Connection) -> Option<Acct> {
  let list = load_accounts();
  let want = get_settings(conn).get("active_login")
    .and_then(|v| v.as_str()).unwrap_or("").to_string();
  if let Some(a) = list.iter().find(|x| x.login == want) { return Some(a.clone()); }
  if list.len() == 1 { return list.first().cloned(); }
  None
}

pub fn token_for(conn: &Connection) -> Option<String> {
  current_acct(conn).map(|a| a.token)
}

// ---------- 设备码流程（RFC 8628 的形状，GitHub 的实现）
fn form_post(url: &str, body: &str) -> Result<serde_json::Value, String> {
  P!(url)
    .header("User-Agent", UA)
    .header("Accept", "application/json")
    .header("Content-Type", "application/x-www-form-urlencoded")
    .send(body)
    .map(|mut r| r.body_mut().read_json::<serde_json::Value>().map_err(|e| e.to_string()))
    .map_err(|e| {
      let t = format!("{e}");
      if t.contains("404") {
        format!("{t} —— client_id 不存在或拼错；确认 OAuth App 已创建、且设置里打开了 Device Flow")
      } else if t.contains("401") || t.contains("403") {
        format!("{t} —— client_id 无效，或该 App 被 GitHub 限制")
      } else { t }
    })?
}

fn url_encode(s: &str) -> String {
  s.bytes().map(|b| match b {
    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
    b' ' => "+".into(),
    _ => format!("%{b:02X}"),
  }).collect()
}

/// 第一步：申请设备码。返回 user_code（要显示给用户）与 verification_uri
pub fn device_start(client_id: &str, scopes: &str) -> Result<serde_json::Value, String> {
  if client_id.trim().is_empty() { return Err("还没填 OAuth App 的 client_id".into()); }
  let body = format!("client_id={}&scope={}", url_encode(client_id.trim()), url_encode(scopes));
  let v = form_post("https://github.com/login/device/code", &body)?;
  if let Some(e) = v.get("error") {
    return Err(format!("申请设备码被拒：{}（提示：App 设置里必须打开 Device Flow）", e));
  }
  Ok(v)
}

/// 第二步：轮询。每次只问一次，由界面按返回的 interval 定时重试 ——
/// 把轮询放进 Rust 后台线程会让"取消"和"窗口关了"变得难处理。
pub fn device_poll(client_id: &str, device_code: &str) -> Result<serde_json::Value, String> {
  let body = format!("client_id={}&device_code={}&grant_type={}",
    url_encode(client_id.trim()), url_encode(device_code),
    url_encode("urn:ietf:params:oauth:grant-type:device_code"));
  let v = form_post("https://github.com/login/oauth/access_token", &body)?;
  match v.get("error").and_then(|e| e.as_str()) {
    Some("authorization_pending") => Ok(serde_json::json!({ "state": "pending" })),
    Some("slow_down") => Ok(serde_json::json!({ "state": "slow_down", "hint": "把轮询间隔再加 5 秒" })),
    Some("expired_token") => Ok(serde_json::json!({ "state": "expired" })),
    Some("access_denied") => Ok(serde_json::json!({ "state": "denied" })),
    Some(other) => Ok(serde_json::json!({ "state": "error", "error": other })),
    None => {
      let tok = v["access_token"].as_str().unwrap_or("").to_string();
      if tok.is_empty() { return Err("返回里没有 access_token".into()); }
      let scopes = v["scope"].as_str().unwrap_or("").to_string();
      // 拿到 token 后立刻验一次，把 login/user_id 定下来并存进账号表
      let who = G!(&format!("{API}/user"))
        .header("User-Agent", UA).header("Authorization", format!("Bearer {tok}"))
        .call().map(|mut r| r.body_mut().read_json::<serde_json::Value>().map_err(|e| e.to_string()))
        .map_err(|e| format!("{e}"))??;
      let login = who["login"].as_str().ok_or("读不到 login")?.to_string();
      upsert_account(Acct {
        login: login.clone(), user_id: who["id"].as_i64().unwrap_or(0), token: tok.clone(),
        auth_mode: "oauth_device".into(), scopes, added_at: now_s(),
      })?;
      let conn = open_db()?;
      set_setting(&conn, "active_login", &login)?;
      Ok(serde_json::json!({ "state": "ok", "login": login, "user_id": who["id"], "token_len": tok.len() }))
    }
  }
}

/// 用粘贴的 token 建账号（设备码之前的过渡路径，也保留给不想用 OAuth 的人）
pub fn add_pat_account(tok: &str) -> Result<serde_json::Value, String> {
  let tok = tok.trim();
  if tok.is_empty() { return Err("token 为空".into()); }
  // x-oauth-scopes 是 GitHub 在认证响应头里回报的真实作用域。存下来才有"这个 token
  // 够不够建画像"可判读——只凭他创建时勾了什么记，回头对不上。
  let (who, scopes) = G!(&format!("{API}/user"))
    .header("User-Agent", UA).header("Accept", "application/vnd.github+json")
    .header("Authorization", format!("Bearer {tok}"))
    .call()
    .map(|mut r| {
      let sc = r.headers().get("x-oauth-scopes")
        .and_then(|x| x.to_str().ok()).unwrap_or("").to_string();
      (r.body_mut().read_json::<serde_json::Value>().unwrap_or(serde_json::Value::Null), sc)
    })
    .map_err(|e| format!("{e}"))?;
  let login = who["login"].as_str().ok_or("返回里没有 login（token 可能无效）")?.to_string();
  upsert_account(Acct {
    login: login.clone(), user_id: who["id"].as_i64().unwrap_or(0), token: tok.to_string(),
    auth_mode: "pat".into(), scopes: scopes.clone(), added_at: now_s(),
  })?;
  let conn = open_db()?;
  set_setting(&conn, "active_login", &login)?;
  // 顺手把真实配额读出来：这是"认证态 5000/小时"这条一直未核实的说法的现场验证
  let rl: serde_json::Value = G!(&format!("{API}/rate_limit"))
    .header("User-Agent", UA).header("Authorization", format!("Bearer {tok}"))
    .call().and_then(|mut r| r.body_mut().read_json::<serde_json::Value>().map_err(ureq::Error::from))
    .unwrap_or(serde_json::Value::Null);
  let core = &rl["resources"]["core"];
  Ok(serde_json::json!({ "login": login, "user_id": who["id"], "public_repos": who["public_repos"],
    "following": who["following"], "followers": who["followers"],
    "scopes": scopes, "missing_scope": missing_scopes(&scopes),
    "quota_limit": core["limit"], "quota_remaining": core["remaining"] }))
}

/// 账号列表给界面看：绝不带 token 内容，只带长度
pub fn accounts_json() -> serde_json::Value {
  serde_json::json!(load_accounts().iter().map(|a| serde_json::json!({
    "login": a.login, "user_id": a.user_id, "mode": a.auth_mode, "scopes": a.scopes,
    "added_at": a.added_at, "token_len": a.token.len()
  })).collect::<Vec<_>>())
}

/// 各通道现在各有多少可看的东西。界面顶部的频道标签要用它，
/// 否则用户点进"探索"才知道是空的 —— 那是浪费他一次点击。
pub fn channel_counts(conn: &Connection) -> serde_json::Value {
  ensure_event_tables(conn);
  ensure_social_tables(conn);
  let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(0) };
  serde_json::json!({
    "all": q("SELECT COUNT(1) FROM repo WHERE slope IS NOT NULL"),
    "hot": q("SELECT COUNT(1) FROM repo WHERE slope IS NOT NULL AND window_kind LIKE 'born%'"),
    "profile": q("SELECT COUNT(1) FROM feed_hit WHERE channel='profile'"),
    "social": q("SELECT COUNT(1) FROM feed_hit WHERE channel='social'"),
    "explore": q("SELECT COUNT(1) FROM repo WHERE window_kind='explore'"),
    "saved": q("SELECT COUNT(1) FROM saved"),
    "pool": q("SELECT COUNT(1) FROM repo"),
    "last_collect": conn.query_row("SELECT MAX(ran_at) FROM query_log", [], |r| r.get::<_, Option<i64>>(0)).ok().flatten().unwrap_or(0),
    "last_refill": conn.query_row("SELECT MAX(at) FROM refill_log", [], |r| r.get::<_, Option<i64>>(0)).ok().flatten().unwrap_or(0)
  })
}
