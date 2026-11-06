use crate::model::Repo;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use std::path::Path;

pub type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync + 'static>>;

/// 一个连接 = 一个库。外壳负责把文件路径给进来，这里不猜任何平台路径。
pub struct Store {
    conn: Connection,
}

const SCHEMA: &str = r#"
create table if not exists repo (
  id          integer primary key,
  full_name   text not null unique,
  owner       text not null,
  name        text not null,
  description text not null default '',
  language    text not null default '',
  topics      text not null default '[]',
  stars       integer not null default 0,
  forks       integer not null default 0,
  open_issues integer not null default 0,
  created_at  text not null default '',
  pushed_at   text not null default '',
  archived    integer not null default 0,
  is_fork     integer not null default 0,
  homepage    text not null default '',
  license     text not null default '',
  score       real not null default 0
);
create index if not exists idx_repo_score  on repo(score desc);
create index if not exists idx_repo_pushed on repo(pushed_at desc);

create table if not exists saved (
  repo_id integer primary key,
  at      text not null
);

create table if not exists meta (
  k text primary key,
  v text not null
);
"#;

impl Store {
    pub fn open(path: &Path) -> Res<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let s = Self { conn };
        s.conn.execute_batch(SCHEMA)?;
        Ok(s)
    }

    /// 只给测试用：不落盘，跑完就没了。
    pub fn open_memory() -> Res<Self> {
        let conn = Connection::open_in_memory()?;
        let s = Self { conn };
        s.conn.execute_batch(SCHEMA)?;
        Ok(s)
    }

    pub fn count(&self) -> Res<i64> {
        Ok(self
            .conn
            .query_row("select count(*) from repo", [], |r| r.get(0))?)
    }

    pub fn upsert(&mut self, repos: &[Repo]) -> Res<usize> {
        let tx = self.conn.transaction()?;
        let mut n = 0;
        {
            let mut st = tx.prepare(
                "insert into repo (id, full_name, owner, name, description, language, topics,
                                   stars, forks, open_issues, created_at, pushed_at,
                                   archived, is_fork, homepage, license, score)
                 values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
                 on conflict(id) do update set
                   full_name=excluded.full_name, description=excluded.description,
                   language=excluded.language, topics=excluded.topics,
                   stars=excluded.stars, forks=excluded.forks,
                   open_issues=excluded.open_issues, pushed_at=excluded.pushed_at,
                   archived=excluded.archived, homepage=excluded.homepage,
                   license=excluded.license",
            )?;
            for r in repos {
                st.execute(params![
                    r.id,
                    r.full_name,
                    r.owner,
                    r.name,
                    r.description,
                    r.language,
                    serde_json::to_string(&r.topics)?,
                    r.stars,
                    r.forks,
                    r.open_issues,
                    r.created_at,
                    r.pushed_at,
                    r.archived as i32,
                    r.is_fork as i32,
                    r.homepage,
                    r.license,
                    r.score,
                ])?;
                n += 1;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// 全量重算分数。采集完跑一次即可，读的时候不再算，保证列表和详情一个数。
    pub fn rescore(&mut self, now: DateTime<Utc>) -> Res<usize> {
        let rows: Vec<Repo> = {
            let mut st = self.conn.prepare("select * from repo")?;
            let it = st.query_map([], row_to_repo)?;
            it.filter_map(Result::ok).collect()
        };
        let tx = self.conn.transaction()?;
        {
            let mut st = tx.prepare("update repo set score = ?1 where id = ?2")?;
            for r in &rows {
                st.execute(params![crate::rank::score(r, now), r.id])?;
            }
        }
        tx.commit()?;
        Ok(rows.len())
    }

    /// 流的主体。
    ///
    /// 关键点：**按星数档位分别取候选，而不是先取全局前 N 再分档**。
    /// 之前就是先 `order by score desc limit N`，结果高星项目把名额占满，
    /// 小项目一条都进不来，分档轮转等于没做——首屏照样全是 pytorch 那一批。
    pub fn feed(&self, limit: usize) -> Res<Vec<Repo>> {
        let mut all: Vec<Repo> = Vec::with_capacity(limit * 2);
        for (lo, hi) in [
            (0_i64, 999_i64),
            (1_000, 9_999),
            (10_000, 49_999),
            (50_000, i64::MAX),
        ] {
            let mut st = self.conn.prepare(
                "select r.*, s.repo_id is not null as saved
                 from repo r left join saved s on s.repo_id = r.id
                 where r.score > 0 and r.stars between ?1 and ?2
                 order by r.score desc
                 limit ?3",
            )?;
            let it = st.query_map(params![lo, hi, limit as i64], |row| {
                row_to_repo_with_saved(row)
            })?;
            for r in it.filter_map(Result::ok) {
                all.push(r);
            }
        }
        Ok(diversify(all, limit))
    }

    pub fn get(&self, id: i64) -> Res<Option<Repo>> {
        let mut st = self
            .conn
            .prepare(
                "select r.*, s.repo_id is not null as saved
                 from repo r left join saved s on s.repo_id = r.id
                 where r.id = ?1",
            )?;
        let mut it = st.query_map(params![id], row_to_repo_with_saved)?;
        Ok(it.next().and_then(Result::ok))
    }

    pub fn saved(&self) -> Res<Vec<Repo>> {
        let mut st = self.conn.prepare(
            "select r.*, 1 as saved from repo r
             join saved s on s.repo_id = r.id
             order by s.at desc",
        )?;
        let it = st.query_map([], row_to_repo_with_saved)?;
        Ok(it.filter_map(Result::ok).collect())
    }

    pub fn set_saved(&mut self, id: i64, on: bool) -> Res<()> {
        if on {
            self.conn.execute(
                "insert or replace into saved (repo_id, at) values (?1, ?2)",
                params![id, Utc::now().to_rfc3339()],
            )?;
        } else {
            self.conn
                .execute("delete from saved where repo_id = ?1", params![id])?;
        }
        Ok(())
    }

    pub fn meta_set(&self, k: &str, v: &str) -> Res<()> {
        self.conn.execute(
            "insert or replace into meta (k, v) values (?1, ?2)",
            params![k, v],
        )?;
        Ok(())
    }

    pub fn meta_get(&self, k: &str) -> Res<Option<String>> {
        let mut st = self.conn.prepare("select v from meta where k = ?1")?;
        let mut it = st.query_map(params![k], |r| r.get::<_, String>(0))?;
        Ok(it.next().and_then(Result::ok))
    }

    /// 语言分布，给筛选条用。
    pub fn languages(&self) -> Res<Vec<(String, i64)>> {
        let mut st = self.conn.prepare(
            "select language, count(*) c from repo
             where score > 0 and language <> ''
             group by language order by c desc limit 12",
        )?;
        let it = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(it.filter_map(Result::ok).collect())
    }
}

/// 按星数分档。分档而不是纯按分数排，是因为纯分数排出来的东西
/// 首屏一定是 pytorch、transformers 这类人尽皆知的仓库 —— 那是总榜，不是发现。
/// 分档轮转之后，首屏必然同时出现巨无霸、中型项目和小项目。
fn scale_bucket(stars: u32) -> usize {
    match stars {
        0..=999 => 0,
        1_000..=9_999 => 1,
        10_000..=49_999 => 2,
        _ => 3,
    }
}

/// 两条约束一起满足：
/// 1. 同作者不相邻（否则像某人的仓库列表）
/// 2. 四个星数档轮转出现（否则像排行榜）
fn diversify(items: Vec<Repo>, limit: usize) -> Vec<Repo> {
    let mut buckets: Vec<Vec<Repo>> = vec![Vec::new(); 4];
    for r in items {
        let b = scale_bucket(r.stars);
        buckets[b].push(r);
    }

    let mut out: Vec<Repo> = Vec::with_capacity(limit);
    let mut round = 0usize;

    'outer: loop {
        let mut progressed = false;
        for k in 0..4 {
            let b = (k + round) % 4;
            let pos = buckets[b].iter().position(|c| {
                !out.iter().rev().take(2).any(|o| o.owner == c.owner)
            });
            if let Some(p) = pos {
                out.push(buckets[b].remove(p));
                progressed = true;
                if out.len() >= limit {
                    break 'outer;
                }
            }
        }
        // 所有档都存在作者冲突时，妥协取一个，不能让流断在半路
        if !progressed {
            for b in 0..4 {
                if !buckets[b].is_empty() {
                    out.push(buckets[b].remove(0));
                    progressed = true;
                    break;
                }
            }
        }
        if !progressed {
            break;
        }
        round = round.wrapping_add(1);
    }
    out
}

fn row_to_repo(row: &rusqlite::Row) -> rusqlite::Result<Repo> {
    let topics: String = row.get("topics")?;
    Ok(Repo {
        id: row.get("id")?,
        full_name: row.get("full_name")?,
        owner: row.get("owner")?,
        name: row.get("name")?,
        description: row.get("description")?,
        language: row.get("language")?,
        topics: serde_json::from_str(&topics).unwrap_or_default(),
        stars: row.get("stars")?,
        forks: row.get("forks")?,
        open_issues: row.get("open_issues")?,
        created_at: row.get("created_at")?,
        pushed_at: row.get("pushed_at")?,
        archived: row.get::<_, i32>("archived")? != 0,
        is_fork: row.get::<_, i32>("is_fork")? != 0,
        homepage: row.get("homepage")?,
        license: row.get("license")?,
        score: row.get("score")?,
        saved: false,
    })
}

fn row_to_repo_with_saved(row: &rusqlite::Row) -> rusqlite::Result<Repo> {
    let mut r = row_to_repo(row)?;
    r.saved = row.get::<_, i32>("saved").unwrap_or(0) != 0;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(id: i64, owner: &str, score: f64) -> Repo {
        Repo {
            id,
            full_name: format!("{owner}/r{id}"),
            owner: owner.into(),
            name: format!("r{id}"),
            description: "描述描述描述描述描述描述".into(),
            language: "Rust".into(),
            topics: vec![],
            stars: 100,
            forks: 0,
            open_issues: 0,
            created_at: "2020-01-01T00:00:00Z".into(),
            pushed_at: "2026-11-01T00:00:00Z".into(),
            archived: false,
            is_fork: false,
            homepage: String::new(),
            license: "MIT".into(),
            score,
            saved: false,
        }
    }

    #[test]
    fn 存取一条能原样取回() {
        let mut s = Store::open_memory().unwrap();
        let r = mk(1, "alice", 0.5);
        s.upsert(&[r]).unwrap();
        let got = s.get(1).unwrap().unwrap();
        assert_eq!(got.full_name, "alice/r1");
        assert_eq!(got.topics.len(), 0);
    }

    #[test]
    fn 收藏是独立状态_不影响仓库本身() {
        let mut s = Store::open_memory().unwrap();
        s.upsert(&[mk(1, "alice", 0.5)]).unwrap();
        s.set_saved(1, true).unwrap();
        assert!(s.get(1).unwrap().unwrap().saved);
        assert_eq!(s.saved().unwrap().len(), 1);
        s.set_saved(1, false).unwrap();
        assert!(!s.get(1).unwrap().unwrap().saved);
        assert_eq!(s.count().unwrap(), 1, "取消收藏不该删掉仓库");
    }

    #[test]
    fn 同作者不会占满首屏() {
        let items: Vec<Repo> = (0..6).map(|i| mk(i, "same", 1.0)).collect();
        let other: Vec<Repo> = (10..14).map(|i| mk(i, "diff", 0.9)).collect();
        let mixed: Vec<Repo> = items.into_iter().chain(other).collect();
        let out = diversify(mixed, 10);
        for w in out.windows(3) {
            assert!(
                !(w[0].owner == w[1].owner && w[1].owner == w[2].owner),
                "出现了三个同作者相邻"
            );
        }
    }

    #[test]
    fn 积分为零的不进流() {
        let mut s = Store::open_memory().unwrap();
        s.upsert(&[mk(1, "a", 0.0), mk(2, "b", 0.7)]).unwrap();
        let f = s.feed(10).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].id, 2);
    }
}
