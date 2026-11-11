//! 「我的」页要的东西：当前账号的公开资料、自己名下最近更新的仓库。
//!
//! 令牌由外壳传进来（桌面从 `gh auth token` 拿，安卓将来从 Keystore 拿），
//! 这个模块不读任何本机路径 —— 跟 [`crate::store`] 守同一条规矩。

use crate::source::Source;
use crate::store::Res;
use serde_json::Value;

/// 账号资料。字段是 GitHub `/user` 的子集，只取界面上真的要显示的那些。
///
/// 全部用 `String` / `u32` 而不是 `Option`：GitHub 对空字段返回 `null`，
/// 前端拿到 `null` 要处处判空，不如在这里就归一成空串。
#[derive(Debug, Clone, serde::Serialize)]
pub struct Account {
    pub login: String,
    pub name: String,
    pub avatar: String,
    pub bio: String,
    pub company: String,
    pub location: String,
    pub blog: String,
    pub html: String,
    pub public_repos: u32,
    pub followers: u32,
    pub following: u32,
    /// 注册时间，RFC3339
    pub since: String,
    /// 令牌是从哪儿找来的：`gh` / `env` / `hosts.yml`。
    /// 显示出来是为了让用户知道「这个登录不是我瞎猜的」。
    pub via: String,
}

/// 自己名下的仓库。比 [`crate::model::Repo`] 轻得多：
/// 这些仓库不在本地库里，不需要打分、封面、README 摘要那一套。
#[derive(Debug, Clone, serde::Serialize)]
pub struct OwnedRepo {
    pub name: String,
    pub full_name: String,
    pub description: String,
    pub language: String,
    pub stars: u32,
    pub forks: u32,
    pub pushed_at: String,
    pub html: String,
    pub private: bool,
    pub fork: bool,
    pub archived: bool,
}

fn text(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn num(v: &Value, key: &str) -> u32 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(0) as u32
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

impl Account {
    /// 用令牌换资料。令牌无效会返回 401，这里的错误信息会原样显示在登录卡上。
    pub fn fetch(token: &str, via: &str) -> Res<Self> {
        let v = Source::new(Some(token.to_string())).json("https://api.github.com/user")?;
        let login = text(&v, "login");
        if login.is_empty() {
            return Err("这个令牌换不到账号（GitHub 没返回 login）".into());
        }
        Ok(Self {
            login,
            name: text(&v, "name"),
            avatar: text(&v, "avatar_url"),
            bio: text(&v, "bio"),
            company: text(&v, "company"),
            location: text(&v, "location"),
            blog: text(&v, "blog"),
            html: text(&v, "html_url"),
            public_repos: num(&v, "public_repos"),
            followers: num(&v, "followers"),
            following: num(&v, "following"),
            since: text(&v, "created_at"),
            via: via.to_string(),
        })
    }
}

/// 自己名下最近推送的仓库。
///
/// `affiliation=owner` 只取「我拥有的」，不含组织仓库和协作仓库 ——
/// 这一栏是「我的」，混进一堆别人的项目就不叫我的了。
pub fn repos(token: &str, limit: usize) -> Res<Vec<OwnedRepo>> {
    let n = limit.clamp(1, 50);
    let url = format!(
        "https://api.github.com/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page={n}"
    );
    let v = Source::new(Some(token.to_string())).json(&url)?;
    let arr = v.as_array().cloned().unwrap_or_default();
    Ok(arr
        .iter()
        .map(|r| OwnedRepo {
            name: text(r, "name"),
            full_name: text(r, "full_name"),
            description: text(r, "description"),
            language: text(r, "language"),
            stars: num(r, "stargazers_count"),
            forks: num(r, "forks_count"),
            pushed_at: text(r, "pushed_at"),
            html: text(r, "html_url"),
            private: flag(r, "private"),
            fork: flag(r, "fork"),
            archived: flag(r, "archived"),
        })
        .filter(|r| !r.full_name.is_empty())
        .collect())
}
