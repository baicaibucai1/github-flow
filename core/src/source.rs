use crate::model::{Repo, SearchHit};
use crate::store::Res;
use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

const UA: &str = "flow/0.1 (github discovery client)";

/// 一次图片探测的结果。宽高为 0 表示没认出来（不是栅格图，或只取到半个头）。
pub struct Probe {
    pub ctype: String,
    pub bytes: u64,
    pub w: u32,
    pub h: u32,
}


/// 唯一的出网口。所有网络请求都从这里走，
/// 这样配额、重试、UA 只有一个地方要改。
pub struct Source {
    agent: ureq::Agent,
    token: Option<String>,
}

/// 目录里的一项。`kind` 直接沿用 GitHub 的 `blob` / `tree`，
/// 前端靠它区分文件和目录，不做二次映射。
#[derive(Debug, serde::Serialize)]
pub struct TreeItem {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// 详情页要的 README 全文和目录结构。
/// 这两个不在本地库里：库只存首屏摘要，全文按需现拉。
#[derive(Debug, serde::Serialize)]
pub struct RepoExtra {
    pub branch: String,
    pub readme: String,
    pub tree: Vec<TreeItem>,
    /// 仓库真实条目数。列表本身有上限（400），界面要显示「共 N 个」，
    /// 用 tree.len() 会把数字说小。
    pub total: usize,
}

impl Source {
    pub fn new(token: Option<String>) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(UA)
            .build();
        Self { agent, token }
    }

    fn has_token(&self) -> bool {
        self.token.as_deref().map(|t| !t.is_empty()).unwrap_or(false)
    }

    fn call(&self, url: &str, accept: &str) -> Res<ureq::Response> {
        let mut req = self
            .agent
            .get(url)
            .set("Accept", accept)
            .set("X-GitHub-Api-Version", "2022-11-28");
        if let Some(t) = self.token.as_deref() {
            if !t.is_empty() {
                req = req.set("Authorization", &format!("Bearer {t}"));
            }
        }
        match req.call() {
            Ok(r) => Ok(r),
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default();
                let msg = if code == 403 || code == 429 {
                    format!("被限流或拒绝（{code}）：{}", body.chars().take(200).collect::<String>())
                } else {
                    format!("HTTP {code}：{}", body.chars().take(200).collect::<String>())
                };
                Err(msg.into())
            }
            Err(e) => Err(format!("网络不通：{e}").into()),
        }
    }

    /// 拉一个仓库的 README 全文和完整目录，给详情页用。
    ///
    /// 三次请求：仓库信息拿默认分支、README 拿正文、git/trees 拿目录。
    /// README 用 `vnd.github.raw` 媒体类型，返回的就是 markdown 原文，
    /// 省掉一次 base64 解码——这个仓库的 README 能有几百 KB。
    ///
    /// 没有 README 或目录拉不到都不算失败：返回空，界面自己显示「没有」。
    /// 只有仓库本身不存在才报错。
    pub fn repo_extra(&self, full_name: &str) -> Res<RepoExtra> {
        let parts: Vec<&str> = full_name.split('/').collect();
        if parts.len() != 2 || parts.iter().any(|p| p.is_empty() || p.len() > 100) {
            return Err("仓库名要是 owner/repo 的形式".into());
        }

        let meta: serde_json::Value = self
            .call(
                &format!("https://api.github.com/repos/{full_name}"),
                "application/vnd.github+json",
            )?
            .into_json()?;
        let branch = meta["default_branch"]
            .as_str()
            .unwrap_or("HEAD")
            .to_string();

        let readme = self
            .call(
                &format!("https://api.github.com/repos/{full_name}/readme"),
                "application/vnd.github.raw",
            )
            .ok()
            .and_then(|r| r.into_string().ok())
            .unwrap_or_default();

        let tree: serde_json::Value = match self.call(
            &format!("https://api.github.com/repos/{full_name}/git/trees/{branch}?recursive=1"),
            "application/vnd.github+json",
        ) {
            Ok(r) => r.into_json()?,
            Err(_) => serde_json::json!({ "tree": [] }),
        };

        let items = tree["tree"].as_array().cloned().unwrap_or_default();
        let mut out = Vec::with_capacity(items.len().min(400));
        for it in items.iter().take(400) {
            if let (Some(path), Some(kind)) = (it["path"].as_str(), it["type"].as_str()) {
                out.push(TreeItem {
                    path: path.to_string(),
                    kind: kind.to_string(),
                });
            }
        }
        Ok(RepoExtra {
            branch,
            readme,
            tree: out,
            total: items.len(),
        })
    }

    /// 搜索一页。`sort` 取 `stars` 或 `updated`：
    /// 前者保证质量，后者保证新鲜——信息流两个都要，所以两路都拉。
    pub fn search(&self, q: &str, sort: &str, page: u32) -> Res<Vec<Repo>> {
        let url = format!(
            "https://api.github.com/search/repositories?q={}&sort={}&order=desc&per_page=100&page={}",
            encode(q),
            sort,
            page
        );
        let r = self.call(&url, "application/vnd.github+json")?;
        let v: serde_json::Value = r.into_json()?;
        let items = v["items"].as_array().cloned().unwrap_or_default();
        let mut out = Vec::with_capacity(items.len());
        for it in items {
            match serde_json::from_value::<SearchHit>(it) {
                Ok(h) => out.push(h.into_repo()),
                Err(_) => continue, // 单个字段缺失不该让整批失败
            }
        }
        Ok(out)
    }

    /// 按语言 + 时间窗铺开采集，凑够 `target` 条就停。
    ///
    /// 为什么不用「一次搜 1000 条」：Search API 单查询上限就是 1000，
    /// 且按 stars 排的前 1000 条永远是同一批老面孔。按语言拆开、
    /// 再叠一路 `updated` 排序，才能既保证质量又拿到新东西。
    pub fn harvest(
        &self,
        target: usize,
        mut on_progress: impl FnMut(usize),
    ) -> Res<Vec<Repo>> {
        let since = (chrono::Utc::now() - chrono::Duration::days(90))
            .format("%Y-%m-%d")
            .to_string();
        let langs = [
            "rust", "python", "typescript", "javascript", "go", "java", "cpp", "c", "zig",
            "kotlin", "swift", "ruby",
        ];

        // 为什么要按星数分三档，而不是「一句 stars:>=50 取三页」：
        // Search API 按 stars 排序取第一页，永远是该语言星数最高的 100 个。
        // 也就是说条件写得再宽，捞回来的还是同一批巨无霸，中小项目一条都进不来。
        // 想要「大中小都有」，只能把星数区间切开，一档一档地要。
        //
        // 顺序也有讲究：先铺满所有语言的新芽，再铺中坚，最后巨头。
        // 万一中途到量停下，缺的是巨头（反正不缺），而不是小项目。
        let mut plan: Vec<(String, &str)> = Vec::new();
        for lang in langs {
            plan.push((
                format!("language:{lang} stars:100..800 pushed:>{since} fork:false archived:false"),
                "updated",
            ));
        }
        for lang in langs {
            plan.push((
                format!("language:{lang} stars:800..10000 pushed:>{since} fork:false archived:false"),
                "stars",
            ));
        }
        for lang in langs {
            plan.push((
                format!("language:{lang} stars:>=10000 pushed:>{since} fork:false archived:false"),
                "stars",
            ));
        }
        for topic in ["llm", "agent", "mcp", "cli", "rag"] {
            plan.push((
                format!("topic:{topic} stars:>=80 pushed:>{since} fork:false archived:false"),
                "stars",
            ));
        }

        let mut seen: HashSet<i64> = HashSet::new();
        let mut out: Vec<Repo> = Vec::new();

        for (q, sort) in plan {
            if out.len() >= target {
                break;
            }
            match self.search(&q, sort, 1) {
                Ok(page) => {
                    for r in page {
                        if seen.insert(r.id) {
                            out.push(r);
                        }
                    }
                    on_progress(out.len());
                }
                // 单个查询失败（限流、网络抖动）不该毁掉整批：
                // 已经拿到的数据仍然有价值，剩下的靠下次增量补。
                Err(e) => {
                    on_progress(out.len());
                    eprintln!("  跳过一条查询（{e}）");
                }
            }
            std::thread::sleep(Duration::from_millis(if self.has_token() { 2100 } else { 6200 }));
        }
        out.truncate(target);
        Ok(out)
    }

    /// 拉 README（纯文本）。详情页用，失败不影响主体信息。
    pub fn readme(&self, full_name: &str) -> Res<String> {
        let url = format!("https://api.github.com/repos/{full_name}/readme");
        let r = self.call(&url, "application/vnd.github.raw")?;
        let text = r.into_string()?;
        // GitHub 对超大 README 会截断，界面上不需要全量，20000 字足够。
        Ok(text.chars().take(20_000).collect())
    }

    /// 只取图片开头 64KB，用来判断宽高和体积。
    ///
    /// 不下载整图：一张截图动辄 300KB，3500 个仓库就是上 G 的流量，
    /// 而我们只需要知道它「够不够大、是不是太窄」。文件头里都有。
    pub fn probe_image(&self, url: &str) -> Res<Probe> {
        let r = self
            .agent
            .get(url)
            .set("Range", "bytes=0-65535")
            .set("Accept", "image/*")
            .call()
            .map_err(|e| format!("取图失败：{e}"))?;

        let ctype = r.header("content-type").unwrap_or("").to_lowercase();
        // Content-Range: bytes 0-65535/1234567
        let total = r
            .header("content-range")
            .and_then(|v| v.rsplit('/').next().map(|s| s.to_string()))
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| r.header("content-length").and_then(|v| v.parse().ok()))
            .unwrap_or(0);

        // 只读前 64KB。`into_reader()` 给的是 `Box<dyn Read>`，
        // 在 trait object 上没法直接 `take`，所以自己按块读到位就停。
        let mut buf = Vec::with_capacity(64 * 1024);
        let mut rd = r.into_reader();
        let mut chunk = [0u8; 16 * 1024];
        while buf.len() < 64 * 1024 {
            let n = rd.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }

        let (w, h) = crate::image::dims(&buf).unwrap_or((0, 0));
        Ok(Probe {
            ctype,
            bytes: total,
            w,
            h,
        })
    }

    pub fn rate(&self) -> Res<serde_json::Value> {
        let r = self.call("https://api.github.com/rate_limit", "application/vnd.github+json")?;
        Ok(r.into_json()?)
    }
}

/// 百分号编码。只保留 RFC 3986 的 unreserved 字符，其余一律转义，
/// 省得哪天查询里出现中文或 `>` 就把请求拼坏。
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 查询串被正确转义() {
        assert_eq!(encode("stars:>=100"), "stars%3A%3E%3D100");
        assert_eq!(encode("a b"), "a+b");
        assert_eq!(encode("rust"), "rust");
    }
}
