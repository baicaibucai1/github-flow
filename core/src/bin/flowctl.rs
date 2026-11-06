//! 开发期用的命令行工具。产品运行时不需要它 —— 它的作用是让「采数据」
//! 这件事可以在没有界面的情况下单独跑通、单独验证。

use flow_core::{rank, source::Source, store::Store};
use std::path::PathBuf;
use std::time::{Duration, Instant};

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
            let (done, cov) = store.count_enriched()?;
            println!("README 摘要 {done}/{total}，其中带封面 {cov}");
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
            let head = flow_core::readme::parse(&txt, &full);
            println!("{} 字", txt.chars().count());
            println!("标题：{}", head.title);
            println!("首段：{}", head.text);
            println!("封面：{}（{:?}）", head.cover, head.kind);
        }
        "enrich" => {
            // 补齐每个仓库的 README 首屏。这是造种子库时才跑的步骤，
            // 产品运行时读的只是结果（标题 / 首段 / 封面地址）。
            //
            // 为什么有并发又有限速：3500 个仓库、每个一次 API，
            // 串着跑要一个多小时；而令牌的额度是 5000 次/小时，
            // 所以真正卡住速度的是「每小时次数」，不是并发数。
            // 多开几个线程只为了把网络往返的等待叠起来，全局仍然守在 1.3 次/秒以内。
            let path = db_path();
            let mut store = Store::open(&path)?;
            if std::env::args().any(|a| a == "--redo") {
                store.rewind_enrich()?;
                println!("已把所有条目标记为待补");
            }
            let cap: usize = arg("--limit").unwrap_or_else(|| "5000".into()).parse().unwrap_or(5000);
            let tom = match token() {
                Some(t) => t,
                None => {
                    eprintln!("需要 FLOW_GH_TOKEN：补 README 要逐仓库调一次 API，匿名额度不够用");
                    std::process::exit(2);
                }
            };

            let jobs = store.pending_enrich(cap)?;
            if jobs.is_empty() {
                println!("没有待补的条目");
            }
            let total = jobs.len();
            let jobs = std::sync::Arc::new(jobs);
            let cursor = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let gate = std::sync::Arc::new(Gate::new(Duration::from_millis(760)));
            let (tx, rx) = std::sync::mpsc::channel::<(i64, Option<Job>)>();

            let t0 = Instant::now();
            let mut workers = Vec::new();
            for _ in 0..4 {
                let jobs = jobs.clone();
                let cursor = cursor.clone();
                let stop = stop.clone();
                let gate = gate.clone();
                let tx = tx.clone();
                let tom = tom.clone();
                workers.push(std::thread::spawn(move || {
                    let src = Source::new(Some(tom));
                    loop {
                        if stop.load(std::sync::atomic::Ordering::Relaxed) {
                            break;
                        }
                        let i = cursor.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        if i >= jobs.len() {
                            break;
                        }
                        let (id, full) = &jobs[i];
                        gate.wait();
                        let out = match src.readme(full) {
                            Ok(text) => {
                                let mut head = flow_core::readme::parse(&text, full);
                                let (mut cw, mut ch) = (0u32, 0u32);
                                if !head.cover.is_empty() {
                                    match src.probe_image(&head.cover) {
                                        Ok(p) if good_cover(&p) => {
                                            cw = p.w;
                                            ch = p.h;
                                        }
                                        // 太小、太扁、太大、不是栅格图：宁可不放
                                        _ => {
                                            head.cover.clear();
                                            head.kind = flow_core::readme::CoverKind::None;
                                        }
                                    }
                                }
                                Some((head, cw, ch))
                            }
                            Err(e) => {
                                let msg = e.to_string();
                                // 404 就是这仓库没有 README，不是失败：标记掉，别每次重试。
                                if msg.contains("404") {
                                    Some((flow_core::readme::Head::default(), 0, 0))
                                } else {
                                    // 拉不到不等于「没有 README」：这一条不标记，
                                    // 下次跑还会再试。但配额打满就没必要继续了。
                                    eprintln!("  跳过 {full}：{msg}");
                                    if msg.contains("403") || msg.contains("429") {
                                        stop.store(true, std::sync::atomic::Ordering::Relaxed);
                                    }
                                    None
                                }
                            }
                        };
                        if tx.send((*id, out)).is_err() {
                            break;
                        }
                    }
                }));
            }
            drop(tx);

            let mut done = 0usize;
            let mut with_cover = 0usize;
            let mut failed = 0usize;
            for (id, out) in rx {
                match out {
                    Some((head, w, h)) => {
                        if !head.cover.is_empty() {
                            with_cover += 1;
                        }
                        store.set_readme(id, &head, w, h)?;
                        done += 1;
                    }
                    None => failed += 1,
                }
                if (done + failed) % 50 == 0 && done + failed > 0 {
                    let el = t0.elapsed().as_secs_f64();
                    let rate = done as f64 / el.max(1.0);
                    println!(
                        "  {}/{total}  封面 {with_cover}  失败 {failed}  {:.1} 条/秒  剩余约 {:.0} 分",
                        done + failed,
                        rate,
                        (total - done - failed) as f64 / rate.max(0.1) / 60.0
                    );
                }
            }
            for w in workers {
                let _ = w.join();
            }
            let (all, cov) = store.count_enriched()?;
            println!(
                "本轮补 {done} 条（失败 {failed}），用时 {:?}；库里已补 {all} 条，其中有封面 {cov} 条",
                t0.elapsed()
            );
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
            eprintln!("用法：flowctl <harvest|enrich|rescore|stats|readme|rate|export> [--db 路径]");
            eprintln!("  harvest --target N        按语言/星数档采项目");
            eprintln!("  enrich  [--limit N|--redo] 逐仓库补 README 首屏");
            eprintln!("  rescore                   重算排序分");
            eprintln!("  stats                     看库里现在有什么");
            eprintln!("  readme --repo o/r         看单个仓库抽出来的首屏");
            eprintln!("  rate                      看 API 配额");
            eprintln!("  export --out 路径          把界面要用的数据导成 JSON");
            std::process::exit(2);
        }
    }
    Ok(())
}

/// 一张图配不配当封面。
///
/// 太小的图铺满 280px 宽的卡片会糊，太扁的图裁出来只剩一条色带，
/// 太大的图会让整个流卡住 —— 三条都得卡住，不然列表里会混进一堆破图。
fn good_cover(p: &flow_core::source::Probe) -> bool {
    if !p.ctype.starts_with("image/") {
        return false;
    }
    if p.w < 320 || p.h < 160 {
        return false;
    }
    let ratio = p.w as f32 / p.h as f32;
    if !(0.55..=3.2).contains(&ratio) {
        return false;
    }
    let cap = if p.ctype.contains("gif") { 8_000_000 } else { 4_000_000 };
    p.bytes == 0 || p.bytes <= cap
}

/// 一个仓库补完之后的成品：解析结果 + 封面宽高。
type Job = (flow_core::readme::Head, u32, u32);

/// 所有线程共用的节流闸。
///
/// 它保证的是「两次请求的*发起*间隔不小于 gap」，而不是每个线程各自 sleep——
/// 各自 sleep 的话，4 个线程加起来速率就是 4 倍，配额一小时就烧穿了。
struct Gate {
    next: std::sync::Mutex<Instant>,
    gap: Duration,
}

impl Gate {
    fn new(gap: Duration) -> Self {
        Self {
            next: std::sync::Mutex::new(Instant::now()),
            gap,
        }
    }

    fn wait(&self) {
        // 持锁睡觉是故意的：锁活着，后来的线程就排在后面，节奏才是全局的。
        let mut next = self.next.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        if *next > now {
            std::thread::sleep(*next - now);
        }
        *next = Instant::now() + self.gap;
    }
}
