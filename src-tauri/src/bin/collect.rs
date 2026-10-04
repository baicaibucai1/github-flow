// CLI 入口：跑一轮采集并打印榜单。与 Tauri command 共用 src/feed.rs。
// 用法：cargo run --bin collect -- [每查询取几页] [拉多少条曲线]

#[path = "../feed.rs"]
mod feed;

fn main() {
  let args: Vec<String> = std::env::args().collect();
  let pages: i64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
  let curves: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(12);

  println!("[db] {}", feed::db_path());
  if args.get(1).map(|s| s.as_str()) == Some("token") {
    if let Some(t) = args.get(2) {
      match feed::store_token(t) { Ok(()) => println!("token 已存本机（{} 字节）", t.len()), Err(e) => println!("存失败 {e}") };
    }
    println!("当前状态：{}", feed::load_token().map(|t| format!("已存，长度 {}", t.len())).unwrap_or_else(|| "未存".into()));
    println!("{}", feed::whoami(&mut |m| println!("{m}")));
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("device") {
    let cid = args.get(2).cloned().unwrap_or_default();
    match feed::device_start(&cid, "read:user public_repo") {
      Ok(v) => println!("设备码申请成功 user_code={} 打开 {} interval={}s expires={}s",
        v["user_code"], v["verification_uri"], v["interval"], v["expires_in"]),
      Err(e) => println!("设备码流程报错（这是预期内的分支测试）：{e}"),
    }
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("wipe-docs") {
    let conn = feed::open_db().expect("打不开数据库");
    let n = conn.execute("DELETE FROM doc_cache", []).unwrap_or(0);
    println!("已清掉 {n} 条 README/附属缓存，下次点开会重新联网");
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("detail") {
    let conn = feed::open_db().expect("打不开数据库");
    let id: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let v = feed::repo_detail(&conn, id, &mut |m| println!("{m}"));
    let s = v.to_string();
    println!("详情 JSON 字节 = {}", s.len());
    {
      let rd = v["readme_html"].as_str().unwrap_or("");
      let mut n = 0; let mut pos = 0usize;
      while n < 4 {
        match rd[pos..].find("<img") { Some(o) => {
            let s = pos + o; pos = s + 4;
            let seg = &rd[s..];
            if let Some(a) = seg.find("src=\"") {
              let u = &seg[a+5..]; let u = &u[..u.find('"').unwrap_or(60).min(u.len())];
              println!("  img{n}: {}", &u[..u.len().min(96)]); n += 1;
            }
          }
          None => break }
      }
      println!("  残留指向本站的 img = {}", rd.matches("tauri.localhost").count());
    }
    println!("  full_name={} readme字符={} releases={} langs={}",
      v["full_name"], v["readme_html"].as_str().map(|x|x.len()).unwrap_or(0),
      v["releases"].as_str().map(|x| x.lines().count()).unwrap_or(0), v["langs"]);
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("explore") {
    let conn = feed::open_db().expect("打不开数据库");
    let n: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(2);
    feed::run_explore(&conn, n, &mut |m| println!("{m}")).ok();
    let c2: i64 = conn.query_row("SELECT COUNT(1) FROM repo WHERE window_kind='explore'", [], |r| r.get(0)).unwrap_or(0);
    println!("探索池现有 {c2} 条");
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("setting") {
    let conn = feed::open_db().expect("打不开数据库");
    if let (Some(k), Some(v)) = (args.get(2), args.get(3)) {
      feed::set_setting(&conn, k, v).map_err(|e| e.to_string()).ok();
      println!("已设置 {k} = {v}");
    }
    println!("当前设置 {}", feed::get_settings(&conn));
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("tr") {
    let conn = feed::open_db().expect("打不开数据库");
    let s = feed::get_settings(&conn);
    let texts: Vec<String> = args.iter().skip(2).cloned().collect();
    println!("{}", feed::translate(&conn, s["translate_url"].as_str().unwrap_or(""), s["lang"].as_str().unwrap_or("zh-CN"), &texts));
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("calibrate") {
    let conn = feed::open_db().expect("打不开数据库");
    println!("{}", feed::calibrate(&conn).unwrap_or_else(|e| format!("校准失败 {e}")));
    for c in feed::load_feed(&conn, &feed::current_login(&conn), 8, 0) {
      println!("  {:<40} {:.3}  {}", c.full_name, c.score, c.why.iter().filter(|w| w.starts_with("校准")).cloned().collect::<Vec<_>>().join(" · "));
    }
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("stats") {
    let conn = feed::open_db().expect("打不开数据库");
    feed::ensure_event_tables(&conn);
    println!("统计 {}", feed::stats(&conn));
    let mut st = conn.prepare("SELECT kind, COUNT(1) FROM event GROUP BY kind ORDER BY 2 DESC").unwrap();
    for r in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).unwrap().flatten() {
      println!("  event {:<16} {}", r.0, r.1);
    }
    let mut st2 = conn.prepare("SELECT repo_id, slot, channel FROM impression ORDER BY id DESC LIMIT 8").unwrap();
    println!("  最近曝光(repo/slot/通道): {:?}", st2.query_map([], |r| Ok(format!("{}/{}/{}", r.get::<_,i64>(0)?, r.get::<_,i64>(1)?, r.get::<_,String>(2)?))).unwrap().flatten().collect::<Vec<_>>());
    return;
  }
  let conn = feed::open_db().expect("打不开数据库");
  if let Err(e) = feed::run_collect(&conn, pages, curves, &mut |m| println!("{m}")) {
    println!("[collect 失败] {e}");
  }

  // 可选：collect.exe profile <login>  —— 只跑画像通道，不重跑热度
  let who: Option<String> = if args.get(1).map(|s| s.as_str()) == Some("profile") {
    args.get(2).cloned()
  } else { None };
  if let Some(login) = who {
    if let Err(e) = feed::build_profile(&conn, &login, 3, &mut |m| println!("{m}")) { println!("画像失败 {e}"); }
    if let Err(e) = feed::run_profile_search(&conn, &login, &mut |m| println!("{m}")) { println!("画像检索失败 {e}"); }
    // 粗排之后补测曲线：不然画像候选永远没有斜率
    if let Err(e) = feed::measure_top(&conn, 12, &mut |m| println!("{m}")) { println!("补测失败 {e}"); }
  }
  let rows = feed::load_feed(&conn, &feed::current_login(&conn), 40, 0);
  println!(
    "\n[pool] 候选池 {} 条，参与排序 {} 条",
    feed::pool_size(&conn),
    rows.len()
  );
  println!("[top12]");
  for (i, c) in rows.iter().take(12).enumerate() {
    println!(
      " {:>2}. {:<40} score={:.3} slope={:>6.1} {:<7} {}{}",
      i + 1,
      c.full_name,
      c.score,
      c.slope.unwrap_or(0.0),
      c.window,
      if c.spam { "[降权] " } else { "" },
      c.why.join(" · ")
    );
  }
}
