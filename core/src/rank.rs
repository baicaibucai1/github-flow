use crate::model::Repo;
use chrono::{DateTime, Utc};

/// 新鲜度半衰期（天）。仓库超过这个天数没推送，新鲜度减半。
const HALF_LIFE_DAYS: f64 = 45.0;

/// 判断一个仓库值不值得出现在流里。
///
/// 这里**只做硬性排除**，不做偏好判断：fork、归档、没有任何描述，
/// 这三类进去只会让人觉这是垃圾场。
pub fn eligible(r: &Repo) -> bool {
    !r.is_fork && !r.archived && !r.description.trim().is_empty() && r.stars >= 30
}

/// 距今多少天。时间串解析不了就当作「很旧」，不 panic。
pub fn days_since(rfc3339: &str, now: DateTime<Utc>) -> f64 {
    match DateTime::parse_from_rfc3339(rfc3339) {
        Ok(t) => {
            let d = (now - t.with_timezone(&Utc)).num_seconds() as f64 / 86_400.0;
            d.max(0.0)
        }
        Err(_) => 3650.0,
    }
}

/// 热度：对数刻度，**除以 6** 而不是 5。
///
/// 除数决定饱和点：除以 5 时 10 万星就已经顶到 1.0，
/// 结果 pytorch、transformers 和随便一个万星项目同分，排序退化成按星数排队。
/// 除以 6 之后 10 万星 ≈ 0.83、百万星才到 1.0，头部之间才拉得开。
pub fn popularity(stars: u32) -> f64 {
    let v = ((stars as f64) + 1.0).log10() / 6.0;
    v.clamp(0.0, 1.0)
}

/// 新鲜度：指数衰减，半衰期 45 天。今天推送过 = 1.0，45 天前 ≈ 0.5。
pub fn freshness(pushed_at: &str, now: DateTime<Utc>) -> f64 {
    let d = days_since(pushed_at, now);
    0.5_f64.powf(d / HALF_LIFE_DAYS)
}

/// 综合分，0–1。
///
/// 权重是刻意写死的常量而不是配置项：第一版要的是**能解释**，
/// 一旦做成可调参数，出问题时就没人知道到底哪一版在跑。
/// 新鲜度占 0.55 高于热度：这是个信息流，不是名人堂。
pub fn score(r: &Repo, now: DateTime<Utc>) -> f64 {
    if !eligible(r) {
        return 0.0;
    }
    let hot = popularity(r.stars);
    let fresh = freshness(&r.pushed_at, now);

    let mut s = 0.45 * hot + 0.55 * fresh;

    // 描述过短（<12 字）通常是占位符，卡面会很空，压一档。
    if r.description.chars().count() < 12 {
        s *= 0.7;
    }

    // 半年没动过的项目，即便星多也不该占前排：用户点进去只会失望。
    if days_since(&r.pushed_at, now) > 180.0 {
        s *= 0.6;
    }

    s.clamp(0.0, 1.0)
}

/// 卡片上的一句话理由。信息流里没有理由，就只是榜单。
pub fn reason(r: &Repo, now: DateTime<Utc>) -> String {
    let d = days_since(&r.pushed_at, now);
    if d <= 3.0 {
        "近三天有更新".into()
    } else if r.stars >= 20_000 {
        "两万星以上，长期活跃".into()
    } else if d <= 30.0 {
        "本月还在动".into()
    } else if !r.topics.is_empty() {
        format!("关于 {}", r.topics[0])
    } else {
        format!("{} 生态", if r.language.is_empty() { "开源" } else { &r.language })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(stars: u32, pushed: &str, desc: &str) -> Repo {
        Repo {
            id: 1,
            full_name: "a/b".into(),
            owner: "a".into(),
            name: "b".into(),
            description: desc.into(),
            language: "Rust".into(),
            topics: vec![],
            stars,
            forks: 0,
            open_issues: 0,
            created_at: "2020-01-01T00:00:00Z".into(),
            pushed_at: pushed.into(),
            archived: false,
            is_fork: false,
            homepage: String::new(),
            license: "MIT".into(),
            score: 0.0,
            saved: false,
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-06T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn 同样的输入给同样的分数() {
        let r = repo(1200, "2026-11-05T00:00:00Z", "一个足够长的项目描述嗯嗯");
        assert_eq!(score(&r, now()), score(&r, now()));
    }

    #[test]
    fn 归档与分叉一律不出现() {
        let mut r = repo(90_000, "2026-11-05T00:00:00Z", "一个足够长的项目描述嗯嗯");
        r.archived = true;
        assert_eq!(score(&r, now()), 0.0);
        r.archived = false;
        r.is_fork = true;
        assert_eq!(score(&r, now()), 0.0);
    }

    #[test]
    fn 活的小项目能压过死的巨无霸() {
        let alive = repo(800, "2026-11-05T00:00:00Z", "一个足够长的项目描述嗯嗯");
        let dead = repo(120_000, "2024-01-01T00:00:00Z", "一个足够长的项目描述嗯嗯");
        assert!(
            score(&alive, now()) > score(&dead, now()),
            "活着的小项目 {} 应该高于停更的巨无霸 {}",
            score(&alive, now()),
            score(&dead, now())
        );
    }

    #[test]
    fn 分数量级符合预期() {
        let hot_new = repo(50_000, "2026-11-06T00:00:00Z", "一个足够长的项目描述嗯嗯");
        let cold_old = repo(200, "2026-06-01T00:00:00Z", "一个足够长的项目描述嗯嗯");
        let a = score(&hot_new, now());
        let b = score(&cold_old, now());
        assert!(a > 0.85, "五万星当天有推送应接近满分，实得 {a}");
        assert!((0.2..0.6).contains(&b), "两百星半年前推送应在中段，实得 {b}");
    }

    #[test]
    fn 空描述与星数过低的被排除() {
        let mut r = repo(5000, "2026-11-05T00:00:00Z", "   ");
        assert_eq!(score(&r, now()), 0.0);
        r.description = "一个足够长的项目描述嗯嗯".into();
        r.stars = 3;
        assert_eq!(score(&r, now()), 0.0);
    }

    #[test]
    fn 时间解析失败不崩溃() {
        let r = repo(1000, "不是时间", "一个足够长的项目描述嗯嗯");
        assert!(score(&r, now()).is_finite());
    }
}
