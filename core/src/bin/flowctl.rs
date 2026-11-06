//! 开发期用的命令行工具。产品运行时不需要它 —— 它的作用是让「采数据」
//! 这件事可以在没有界面的情况下单独跑通、单独验证。

use flow_core::{rank, source::Source, store::Store};
use std::path::PathBuf;
use std::time::Instant;

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter()
        .position(|x| x == name)
        .and_then(|i| a.get(i + 1).cloned())
}

fn db_path() -> PathBuf {
    PathBuf::from(arg("--db").unwrap_or_else(|| "flow.db".into()))
}

fn token() -> Option<String> {
    std::env::var("FLOW_GH_TOKEN").ok().filter(|s| !s.is_empty())
}

fn main() {
    if let Err(e) = run() {
        eprintln!("出错了：{e}");
        std::process::exit(1);
    }
}

fn run() -> flow_core::store::Res<()> {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    match cmd.as_str() {
        "harvest" => {
            let target: usize = arg("--target")
                .unwrap_or_else(|| "3000".into())
                .parse()
                .unwrap_or(3000);
            let path = db_path();
            let mut store = Store::open(&path)?;
            let src = Source::new(token());
            println!("开始采集，目标 {target} 条，库 {}", path.display());
            println!(
                "凭据：{}",
                if token().is_some() { "已提供令牌" } else { "匿名（很慢）" }
            );

            let t0 = Instant::now();
            let repos = src.harvest(target, |n| {
                println!("  已收 {n} 条（{}s）", t0.elapsed().as_secs());
            })?;
            println!("采集完成 {} 条，用时 {}s", repos.len(), t0.elapsed().as_secs());

            let n = store.upsert(&repos)?;
            println!("入库 {n} 条");
            let scored = store.rescore(chrono::Utc::now())?;
            println!("重算分数 {scored} 条");
            println!("库里现在共 {} 条", store.count()?);
        }
        "rescore" => {
            let mut store = Store::open(&db_path())?;
            let n = store.rescore(chrono::Utc::now())?;
            println!("重算 {n} 条");
        }
        "stats" => {
            let store = Store::open(&db_path())?;
            let total = store.count()?;
            let feed = store.feed(10_000)?;
            println!("总条数 {total}，可入流 {}", feed.len());
            println!("语言分布：");
            for (lang, n) in store.languages()? {
                println!("  {lang:<14} {n}");
            }
            println!("前 10 条：");
            let now = chrono::Utc::now();
            for r in feed.iter().take(10) {
                println!(
                    "  {:.3}  {:>7}★  {:<32} {}",
                    r.score,
                    r.stars,
                    r.full_name,
                    rank::reason(r, now)
                );
            }
        }
        "readme" => {
            let full = arg("--repo").unwrap_or_default();
            let src = Source::new(token());
            let txt = src.readme(&full)?;
            println!("{} 字\n---\n{}", txt.chars().count(), txt.chars().take(600).collect::<String>());
        }
        "export" => {
            // 把界面上要显示的东西原样导成 JSON。
            // 用途只有一个：不启动窗口也能拿真实数据核对版式。
            let store = Store::open(&db_path())?;
            let items = store.feed(800)?;
            let out = arg("--out").unwrap_or_else(|| "build/feed.json".into());
            let v = serde_json::json!({
                "total": store.count()?,
                "feed": items,
                "saved": store.saved()?,
            });
            std::fs::write(&out, serde_json::to_string(&v)?)?;
            println!("已导出 {} 条到 {}", items.len(), out);
        }
        "rate" => {
            let src = Source::new(token());
            let v = src.rate()?;
            for k in ["core", "search"] {
                let r = &v["resources"][k];
                println!("{k:<8} {}/{}", r["remaining"], r["limit"]);
            }
        }
        _ => {
            eprintln!("用法：flowctl <harvest|rescore|stats|readme|rate> [--db 路径] [--target N]");
            std::process::exit(2);
        }
    }
    Ok(())
}
