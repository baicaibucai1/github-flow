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
    // token 只走账号表这一条路：CLI 与界面的身份解析必须是同一个函数
    if let Some(t) = args.get(2) {
      match feed::add_pat_account(t) {
        Ok(v) => println!("验证通过：{}", v),
        Err(e) => println!("验证失败：{e}"),
      };
    }
    println!("{}", feed::auth_status(&mut |m| println!("{m}")).unwrap_or(serde_json::json!(null)));
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
  if args.get(1).map(|s| s.as_str()) == Some("me") {
    // "我的"那一页的数据：直接打 JSON，方便对着界面核
    let conn = feed::open_db().expect("打不开数据库");
    println!("{}", feed::me_report(&conn));
    return;
  }
  if args.get(1).map(|s| s.as_str()) == Some("profile") {
    // GitHub 侧的主页数据（会发请求；15 分钟内重复跑走缓存）
    let conn = feed::open_db().expect("打不开数据库");
    match feed::my_profile(&conn, &mut |m| println!("{m}")) {
      Ok(v) => println!("{}", v),
      Err(e) => println!("取不到：{e}"),
    }
    return;
  }
  // 本机没有 sqlite3 CLI，要看库里的 repo.id 只能靠这条（tree/file/list 都按 id 取）
  if args.get(1).map(|s| s.as_str()) == Some("repos") {
    let conn = feed::open_db().expect("打不开数据库");
    let n: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
    let mut st = conn.prepare("SELECT id, full_name, stars FROM repo ORDER BY stars DESC LIMIT ?1").unwrap();
    for r in st.query_map(rusqlite::params![n], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))).unwrap().flatten() {
      println!("  id={:<6} {:<44} star={}", r.0, r.1, r.2);
    }
    return;
  }
  // ---- 仓库视图与详情：文件树 / 单文件 / 列表 / issue / PR / 评论 / diff / Actions
  // 拿命令行先验一遍，是因为这些都要走网络与缓存；先看数据对不对，再去做界面，
  // 不然界面出问题时分不清是前端还是取数。id 用库里的 repo.id（上面 repos 命令能看到）。
  if ["tree", "file", "list", "issue", "pr", "comments", "files", "actions"]
    .contains(&args.get(1).map(|s| s.as_str()).unwrap_or(""))
  {
    let conn = feed::open_db().expect("打不开数据库");
    let id: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let sub = args.get(1).unwrap().as_str();
    let arg3 = args.get(3).map(|s| s.as_str()).unwrap_or("");
    let num: i64 = arg3.parse().unwrap_or(0);
    let emit = &mut |m: String| println!("{m}");
    let r = match sub {
      "tree" => feed::repo_tree(&conn, id, emit),
      "file" => feed::repo_file_read(&conn, id, if arg3.is_empty() { "README.md" } else { arg3 }, emit),
      "list" => feed::repo_list(&conn, id, if arg3.is_empty() { "issue" } else { arg3 }, emit),
      "issue" => feed::issue_detail(&conn, id, num, emit),
      "pr" => feed::pr_detail(&conn, id, num, emit),
      "comments" => feed::issue_comments(&conn, id, num, emit),
      "files" => feed::pr_files(&conn, id, num, emit),
      _ => feed::actions_runs(&conn, id, emit),
    };
    match r {
      Ok(v) => {
        match sub {
          "tree" => {
            println!("分支={} 条目={} 截断={}", v["branch"], v["count"], v["truncated"]);
            for e in v["entries"].as_array().unwrap_or(&vec![]).iter().take(15) {
              println!("  {}{}", e["path"].as_str().unwrap_or(""), if e["dir"].as_bool().unwrap_or(false) { "/" } else { "" });
            }
          }
          "file" => {
            println!("path={} 字节={} 二进制={} 截断={}", v["path"], v["bytes"], v["binary"], v["truncated"]);
            for l in v["text"].as_str().unwrap_or("").lines().take(12) { println!("  | {l}"); }
          }
          "list" => {
            println!("kind={} 条数={}", v["kind"], v["count"]);
            for it in v["items"].as_array().unwrap_or(&vec![]).iter().take(10) {
              println!("  #{} {} —— {}{} [{}]", it["number"], it["title"].as_str().unwrap_or(""),
                it["author"].as_str().unwrap_or(""), if it["draft"].as_bool().unwrap_or(false) { " (draft)" } else { "" },
                it["labels"].as_array().map(|a| a.len()).unwrap_or(0));
            }
          }
          "issue" => {
            println!("#{} [{}] {} —— {} | 正文 {} 字符 | 评论 {} | label {} 个{}",
              v["number"], v["state"], v["title"].as_str().unwrap_or(""), v["author"].as_str().unwrap_or(""),
              v["body_html"].as_str().map(|s| s.chars().count()).unwrap_or(0), v["comments"],
              v["labels"].as_array().map(|a| a.len()).unwrap_or(0),
              if v["is_pull"].as_bool().unwrap_or(false) { " | 这个号其实是 PR" } else { "" });
          }
          "pr" => {
            println!("#{} [{}]{} {} —— +{} -{} / {} 文件 / {} commit / review {} | 正文 {} 字符",
              v["number"], v["state"], if v["draft"].as_bool().unwrap_or(false) { "(draft)" } else { "" },
              v["title"].as_str().unwrap_or(""), v["additions"], v["deletions"], v["changed_files"], v["commits"],
              v["review_comments"], v["body_html"].as_str().map(|s| s.chars().count()).unwrap_or(0));
            println!("  {} → {} | merged={} mergeable={}", v["head"], v["base"], v["merged"], v["mergeable_state"]);
          }
          "comments" => {
            println!("评论 {} 条", v["count"]);
            for c in v["items"].as_array().unwrap_or(&vec![]).iter().take(5) {
              println!("  {} ({}) 正文 {} 字符", c["author"].as_str().unwrap_or(""),
                c["association"].as_str().unwrap_or(""), c["body_html"].as_str().map(|s| s.chars().count()).unwrap_or(0));
            }
          }
          "files" => {
            println!("变更 {} 个文件（截断={}）", v["count"], v["truncated"]);
            for f in v["items"].as_array().unwrap_or(&vec![]).iter().take(8) {
              println!("  [{}] {} +{} -{} patch {} 字符{}{}", f["status"].as_str().unwrap_or(""),
                f["filename"].as_str().unwrap_or(""), f["additions"], f["deletions"],
                f["patch"].as_str().map(|s| s.chars().count()).unwrap_or(0),
                if f["binary"].as_bool().unwrap_or(false) { " (无 patch：二进制或过大)" } else { "" },
                if f["patch_truncated"].as_bool().unwrap_or(false) { " [已截断]" } else { "" });
            }
          }
          _ => {
            println!("运行 {} 次，取回 {} 条", v["total"], v["count"]);
            for r0 in v["items"].as_array().unwrap_or(&vec![]).iter().take(8) {
              println!("  #{} {} [{}:{}] {} {} → {}", r0["run_number"], r0["name"].as_str().unwrap_or(""),
                r0["status"].as_str().unwrap_or(""), r0["conclusion"].as_str().unwrap_or(""),
                r0["event"].as_str().unwrap_or(""), r0["branch"].as_str().unwrap_or(""), r0["title"].as_str().unwrap_or(""));
            }
          }
        }
        // 机器可读的一行：check-skin.mjs --live 靠它做行为断言（人看的摘要在上面）
        println!("RAW {}", v);
      }
      Err(e) => println!("取不到：{e}"),
    }
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
