// Windows 发布版不要弹出那个黑色控制台窗口。
// 注意只在非 debug 下生效 —— 开发时要留着它看 panic 信息。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod feed;

/// 界面拿榜单：每次调用都现读 SQLite，所以刷新数据不需要重编译应用。
#[tauri::command]
fn get_feed(limit: Option<i64>, offset: Option<i64>) -> Result<Vec<feed::Card>, String> {
  let conn = feed::open_db()?;
  Ok(feed::load_feed(&conn, &feed::current_login(&conn), limit.unwrap_or(40), offset.unwrap_or(0)))
}

#[tauri::command]
fn feed_stats() -> Result<serde_json::Value, String> {
  let conn = feed::open_db()?;
  let n: i64 = conn
    .query_row("SELECT COUNT(1) FROM repo WHERE slope IS NOT NULL", [], |r| r.get(0))
    .unwrap_or(0);
  let terms = feed::profile_terms(&conn, &feed::current_login(&conn));
  Ok(serde_json::json!({
    "pool": feed::pool_size(&conn), "ranked": n,
    "login": feed::current_login(&conn),
    "terms": terms.iter().map(|(t, w)| format!("{t} {w:.2}")).collect::<Vec<_>>()
  }))
}

#[tauri::command]
async fn run_collect(pages: i64, curve_n: i64) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || match feed::open_db() {
    Ok(conn) => feed::run_collect(&conn, pages, curve_n, &mut |m| println!("{m}")),
    Err(e) => Err(e),
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_profile(login: String, pages: i64) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let conn = feed::open_db()?;
    let mut log = String::new();
    for step in [
      feed::build_profile(&conn, &login, pages, &mut |m| println!("{m}")),
      feed::run_profile_search(&conn, &login, &mut |m| println!("{m}")),
    ] {
      match step { Ok(s) => log.push_str(&s), Err(e) => return Err(e) }
      log += "
";
    }
    Ok(log)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
fn log_impression(repo_id: i64, slot: i64, channel: String, session: String) -> Result<i64, String> {
  let conn = feed::open_db()?;
  feed::log_impression(&conn, repo_id, slot, &channel, &session)
}

#[tauri::command]
fn log_event(kind: String, repo_id: i64, payload: Option<String>, impression_id: Option<i64>) -> Result<serde_json::Value, String> {
  let conn = feed::open_db()?;
  feed::log_event(&conn, &kind, repo_id, payload.clone(), impression_id)?;
  let learned = feed::apply_feedback(&conn, &feed::current_login(&conn), repo_id, &kind, payload.as_deref());
  Ok(serde_json::json!({ "learned": learned }))
}

#[tauri::command]
fn get_stats() -> Result<serde_json::Value, String> {
  let conn = feed::open_db()?;
  Ok(feed::stats(&conn))
}

/// 界面里的 JS 把关键事件写进这个文件，否则我隔着 WebView 什么都看不见
#[tauri::command]
fn js_log(msg: String) -> Result<(), String> {
  use std::io::Write;
  let path = feed::log_path();
  if let Some(p) = std::path::Path::new(&path).parent() { std::fs::create_dir_all(p).ok(); }
  let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
  writeln!(f, "{msg}").map_err(|e| e.to_string())
}

#[tauri::command]
fn calibrate_now() -> Result<String, String> {
  let conn = feed::open_db()?;
  feed::calibrate(&conn)
}

#[tauri::command]
fn get_channel(channel: String, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<feed::Card>, String> {
  let conn = feed::open_db()?;
  Ok(feed::load_channel(&conn, &feed::current_login(&conn), &channel, limit.unwrap_or(40), offset.unwrap_or(0)))
}

#[tauri::command]
async fn do_explore(per_lang: Option<i64>) -> Result<String, String> {
  let n = per_lang.unwrap_or(2);
  tauri::async_runtime::spawn_blocking(move || {
    let conn = feed::open_db()?;
    feed::run_explore(&conn, n, &mut |s| println!("{s}"))
  }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn do_search(query: String) -> Result<String, String> {
  let q = query.clone();
  tauri::async_runtime::spawn_blocking(move || {
    let conn = feed::open_db()?;
    let login = feed::current_login(&conn);
    feed::search_repos(&conn, &q, &login, &mut |s| println!("{s}"))
  }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn settings_json() -> Result<serde_json::Value, String> { let c = feed::open_db()?; Ok(feed::get_settings(&c)) }

#[tauri::command]
fn set_setting_cmd(key: String, value: String) -> Result<(), String> {
  let c = feed::open_db()?; feed::set_setting(&c, &key, &value)
}

#[tauri::command]
fn do_translate(texts: Vec<String>) -> Result<serde_json::Value, String> {
  let c = feed::open_db()?;
  let s = feed::get_settings(&c);
  Ok(feed::translate(&c, s["translate_url"].as_str().unwrap_or(""), s["lang"].as_str().unwrap_or("zh-CN"), &texts))
}

#[tauri::command]
fn get_detail(repo_id: i64) -> Result<serde_json::Value, String> {
  let c = feed::open_db()?;
  Ok(feed::repo_detail(&c, repo_id, &mut |s| println!("{s}")))
}

#[tauri::command]
fn open_in_app_window(app: tauri::AppHandle, url: String, repo_id: i64) -> Result<String, String> {
  feed::open_webview(&app, &url, repo_id)
}

#[tauri::command]
fn open_url(url: String) -> Result<String, String> {
  feed::open_external(&url)
}

#[tauri::command]
fn auth_status() -> Result<serde_json::Value, String> {
  // Rust 侧的话也写进同一份磁盘日志，否则 GUI 里 println 出来的东西没人看得见
  let mut sink = |s: String| { let _ = js_log(s); };
  feed::auth_status(&mut sink)
}

#[tauri::command]
fn build_my_profile(pages: Option<i64>) -> Result<String, String> {
  let conn = feed::open_db()?;
  // 必须以"真的带着 token 的那个账号"的身份来建。用 active_login() 会退回 profile_term 里的
  // 词表归属，而那是原型阶段借来的公开账号——用户点"按我自己的口味建画像"却建出陌生人的画像，
  // 而且匿名态读公开的 starred 连报错都不会有，错得很安静。
  let acct = feed::current_acct(&conn).ok_or("还没有带 token 的账号：先去「设置 → 账号」登录")?;
  let login = acct.login;
  let mut log = String::new();
  let mut sink = |s: String| { let _ = js_log(s); };
  let r1 = feed::build_profile(&conn, &login, pages.unwrap_or(5), &mut sink);
  log.push_str(&r1?);
  log.push('\n');
  let r2 = feed::run_profile_search(&conn, &login, &mut sink);
  log.push_str(&r2?);
  log.push('\n');
  let r3 = feed::measure_top(&conn, 40, &mut sink);
  log.push_str(&r3?);
  log.push('\n');
  let _ = feed::set_setting(&conn, "active_login", &login);
  Ok(log)
}

#[tauri::command]
fn login_start(client_id: String, scopes: Option<String>) -> Result<serde_json::Value, String> {
  feed::device_start(&client_id, scopes.unwrap_or_else(|| "read:user public_repo".into()).as_str())
}

#[tauri::command]
fn login_poll(client_id: String, device_code: String) -> Result<serde_json::Value, String> {
  feed::device_poll(&client_id, &device_code)
}

#[tauri::command]
fn accounts_list() -> serde_json::Value { feed::accounts_json() }

#[tauri::command]
fn account_activate(login: String) -> Result<(), String> {
  let c = feed::open_db()?; feed::set_setting(&c, "active_login", &login)
}

#[tauri::command]
fn account_remove(login: String) -> Result<(), String> { feed::remove_account(&login) }

#[tauri::command]
fn add_pat(token: String) -> Result<serde_json::Value, String> { feed::add_pat_account(&token) }

/// "我的"这一页的数据：本地读，不发任何请求
#[tauri::command]
fn me_report() -> Result<serde_json::Value, String> {
  let c = feed::open_db()?;
  Ok(feed::me_report(&c))
}

#[tauri::command]
fn get_counts() -> Result<serde_json::Value, String> {  let c = feed::open_db()?;
  Ok(feed::channel_counts(&c))
}

fn main() {
  tauri::Builder::default()
    // 自动更新。没有这两个插件注册，前端调 check() 会报
    // "command not found"，而不是给出任何有用的提示。
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![get_feed, feed_stats, run_collect, run_profile, log_impression, log_event, get_stats, js_log, calibrate_now, get_channel, do_explore, do_search, settings_json, set_setting_cmd, do_translate, get_detail, open_in_app_window, open_url, auth_status, build_my_profile, login_start, login_poll, accounts_list, account_activate, account_remove, add_pat, get_counts, me_report])
    .run(tauri::generate_context!())
    .expect("启动 Tauri 应用失败");
}
