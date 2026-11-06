use serde::{Deserialize, Serialize};

/// 一个 GitHub 仓库在界面上的全部样子。
///
/// 字段刻意保持扁平：SQLite 一行 ↔ 一个结构体 ↔ 一张卡片，
/// 中间不做任何嵌套包装，出问题时能一眼对上。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    pub id: i64,
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub description: String,
    pub language: String,
    pub topics: Vec<String>,
    pub stars: u32,
    pub forks: u32,
    pub open_issues: u32,
    /// RFC3339，如 `2026-11-06T05:12:33Z`
    pub created_at: String,
    pub pushed_at: String,
    pub archived: bool,
    pub is_fork: bool,
    pub homepage: String,
    pub license: String,
    /// 排序分，0–1。由 [`crate::rank::score`] 算出，入库时缓存。
    pub score: f64,
    /// 本机是否收藏
    pub saved: bool,

    /// README 里的一级标题。没写 H1 就是空串——宁可空着，也不拿「Installation」冒充。
    pub readme_title: String,
    /// README 的第一段正经说明，已去掉徽章、代码块、HTML 与链接语法。
    pub readme_head: String,
    /// README 里第一张能当封面的图（已解析成绝对地址）。
    pub cover_url: String,
    /// 封面类型：`shot` 截图 / `logo` 图标 / `gif` 动图 / 空串表示没有。
    /// 图标和截图要的排版不一样，所以得分开记。
    pub cover_kind: String,
    pub cover_w: u32,
    pub cover_h: u32,
}

/// GitHub search 接口返回的原始形态。只取用得上的字段，
/// 少取一个字段就少一处将来会变的耦合。
#[derive(Debug, Deserialize)]
pub struct SearchHit {
    pub id: i64,
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub stargazers_count: u32,
    pub forks_count: u32,
    pub open_issues_count: u32,
    pub created_at: String,
    pub pushed_at: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub fork: bool,
    pub homepage: Option<String>,
    pub license: Option<License>,
    #[serde(default)]
    pub topics: Vec<String>,
    pub owner: Owner,
}

#[derive(Debug, Deserialize)]
pub struct License {
    pub spdx_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Owner {
    pub login: String,
}

impl SearchHit {
    pub fn into_repo(self) -> Repo {
        Repo {
            id: self.id,
            full_name: self.full_name,
            owner: self.owner.login,
            name: self.name,
            description: self.description.unwrap_or_default(),
            language: self.language.unwrap_or_default(),
            topics: self.topics,
            stars: self.stargazers_count,
            forks: self.forks_count,
            open_issues: self.open_issues_count,
            created_at: self.created_at,
            pushed_at: self.pushed_at,
            archived: self.archived,
            is_fork: self.fork,
            homepage: self.homepage.unwrap_or_default(),
            license: self.license.and_then(|l| l.spdx_id).unwrap_or_default(),
            score: 0.0,
            saved: false,
            readme_title: String::new(),
            readme_head: String::new(),
            cover_url: String::new(),
            cover_kind: String::new(),
            cover_w: 0,
            cover_h: 0,
        }
    }
}
