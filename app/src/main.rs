//! 桌面外壳。这里**不放任何业务逻辑**：取数、排序、收藏全部在 flow-core 里。
//! 外壳只做三件事：算数据目录、把种子库落地、把命令转发给核心。
//!
//! 上一版就是死在这一层：窗口里注册了一堆登录命令、零个取数命令，
//! 前端拿不到数据就静默退回假数据，界面看着是好的。所以这次：
//! 取不到数据 → 命令返回 Err → 界面显示错误横幅，绝不回退到任何演示内容。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use flow_core::store::{Res, Store};
use flow_core::Repo;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// 首次启动时把种子库复制到用户目录。
///
/// 这里刻意**不用 `include_bytes!` 把库打进 exe**：试过，结果是 6.4MB 的
/// 未签名 exe 里塞着 1.5MB 二进制数据，被 Defender 判成加壳程序，
/// 编译出来几秒就被删掉，双击也起不来。改成从 exe 同目录取文件，
/// exe 里不含任何二进制载荷，杀软不再报，代价是要连着 seed.db 一起分发。
fn open_db() -> Res<Store> {
    let path = db_path();
    if !path.exists() {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        let seed = exe_dir.join("seed.db");
        if !seed.exists() {
            return Err(format!(
                "找不到种子库 seed.db（应在 {}）。请把 seed.db 和 flow.exe 放在同一目录。",
                exe_dir.display()
            )
            .into());
        }
        std::fs::create_dir_all(data_dir())?;
        std::fs::copy(&seed, &path)?;
    }
    Store::open(&path)
}

/// 数据目录。桌面端自己算，不交给 core——安卓端有另一套路径规则，
/// 核心层如果写死 `%APPDATA%`，将来搬到手机上就是第一个崩的地方。
fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    base.join("flow")
}

fn db_path() -> PathBuf {
    data_dir().join("flow.db")
}

struct AppState(Mutex<Store>);

#[tauri::command]
fn feed(state: State<AppState>, limit: Option<usize>) -> Result<Vec<Repo>, String> {
    let s = state.0.lock().map_err(|_| "数据库正忙".to_string())?;
    s.feed(limit.unwrap_or(800)).map_err(|e| e.to_string())
}

#[tauri::command]
fn detail(state: State<AppState>, id: i64) -> Result<Option<Repo>, String> {
    let s = state.0.lock().map_err(|_| "数据库正忙".to_string())?;
    s.get(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_save(state: State<AppState>, id: i64, on: bool) -> Result<(), String> {
    let mut s = state.0.lock().map_err(|_| "数据库正忙".to_string())?;
    s.set_saved(id, on).map_err(|e| e.to_string())
}

#[tauri::command]
fn saved_list(state: State<AppState>) -> Result<Vec<Repo>, String> {
    let s = state.0.lock().map_err(|_| "数据库正忙".to_string())?;
    s.saved().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_info(state: State<AppState>) -> Result<serde_json::Value, String> {
    let s = state.0.lock().map_err(|_| "数据库正忙".to_string())?;
    let total = s.count().map_err(|e| e.to_string())?;
    let saved = s.saved().map_err(|e| e.to_string())?.len();
    Ok(serde_json::json!({
        "total": total,
        "saved": saved,
        "db": db_path().display().to_string(),
    }))
}

/// README 全文 + 目录结构。本地库里只有首屏摘要，完整内容现拉 GitHub。
///
/// 故意做成同步命令：Tauri 会把它放到自己的线程池里跑，
/// ureq 是阻塞式客户端，塞进 async 里反而要绕。
/// 失败就返回 Err，界面显示「拉不到」——不编造内容。
///
/// `rename_all = "snake_case"`：Tauri 2 默认把参数名当驼峰（fullName），
/// 而前端一直传的是 full_name，不声明就是启动即报「missing required key」。
#[tauri::command(rename_all = "snake_case")]
fn repo_extra(full_name: String) -> Result<flow_core::source::RepoExtra, String> {
    // 匿名配额只有 60 次/小时，而打开一个仓库要发 3 个请求（meta + readme + 目录树），
    // 二十个仓库就见底。所以没登录也要先用本机凭据，别让用户先点「我的」才能正常用。
    static LOCAL: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let token = session()
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.token.clone()))
        .or_else(|| LOCAL.get_or_init(|| find_token().map(|(t, _)| t)).clone());
    let src = flow_core::source::Source::new(token);
    src.repo_extra(&full_name).map_err(|e| e.to_string())
}

/// 翻译服务。全局一份：引擎配置从数据目录读，只读一次。
/// 本地引擎是纯计算，没有连接池要维护，共享它纯粹是为了少解析一遍配置。
fn tr() -> &'static flow_core::translate::Service {
    static S: std::sync::OnceLock<flow_core::translate::Service> = std::sync::OnceLock::new();
    S.get_or_init(|| {
        flow_core::translate::Service::new(flow_core::translate::Config::load(&data_dir()))
    })
}

/// 批量翻短文本：卡片描述、仓库首段。
/// 前端滚到哪就发哪一批，没看到的永远不翻。
#[tauri::command(rename_all = "snake_case")]
fn tr_lines(state: tauri::State<AppState>, items: Vec<String>) -> Result<Vec<String>, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    tr().lines(&mut st, &items).map_err(|e| e.to_string())
}

/// 翻一整篇 markdown。代码块、HTML 行、图片地址会被原样留下，
/// 只翻正文段落。
#[tauri::command(rename_all = "snake_case")]
fn tr_md(state: tauri::State<AppState>, text: String) -> Result<String, String> {
    let mut st = state.0.lock().map_err(|e| e.to_string())?;
    tr().markdown(&mut st, &text).map_err(|e| e.to_string())
}

/// 引擎状态。给设置区显示「本地词典 / 云端 XXX」，不返回任何密钥。
#[tauri::command(rename_all = "snake_case")]
fn tr_status(state: tauri::State<AppState>) -> Result<flow_core::translate::Status, String> {
    let st = state.0.lock().map_err(|e| e.to_string())?;
    Ok(tr().status(&st))
}

/// 用系统浏览器打开仓库页。
/// 只放行 github.com 前缀 —— 这个命令的参数来自界面，
/// 不加限制的话，将来任何一处 XSS 都能变成任意程序启动。
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("只允许打开 GitHub 链接".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 当前登录的令牌。不放磁盘：每次启动重新从本机凭据里找，
/// 这样用户在 gh 里换了账号，这里下次打开就跟着换，不会拿旧令牌乱试。
struct Session {
    token: String,
    via: &'static str,
}

static SESSION: std::sync::OnceLock<Mutex<Option<Session>>> = std::sync::OnceLock::new();

fn session() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 问 gh CLI 要令牌。gh 会把凭据放进系统钥匙串，
/// 所以这是本机上最可靠的一处来源。
fn gh_token() -> Option<String> {
    let mut cmd = std::process::Command::new("gh");
    cmd.args(["auth", "token"]);
    #[cfg(target_os = "windows")]
    {
        // release 版没有控制台，子进程弹窗会很突兀
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// gh 的配置文件。新版默认把令牌放钥匙串，这里只是没有 gh 时的兜底。
fn hosts_yml_token() -> Option<String> {
    let base = std::env::var("APPDATA").ok()?;
    let path = PathBuf::from(base).join("GitHub CLI").join("hosts.yml");
    let txt = std::fs::read_to_string(path).ok()?;
    for line in txt.lines() {
        if let Some(rest) = line.trim().strip_prefix("oauth_token:") {
            let t = rest.trim().trim_matches('"').trim_matches('\'').to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

/// 本机凭据，按可靠性排序。
fn find_token() -> Option<(String, &'static str)> {
    for key in ["GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim().to_string();
            if !t.is_empty() {
                return Some((t, "env"));
            }
        }
    }
    if let Some(t) = gh_token() {
        return Some((t, "gh"));
    }
    hosts_yml_token().map(|t| (t, "hosts.yml"))
}

/// 登录：读本机凭据 → 换账号资料。不弹网页、不要求粘贴令牌。
#[tauri::command]
fn account_signin() -> Result<flow_core::account::Account, String> {
    let (token, via) = find_token().ok_or_else(|| {
        "没找到本机凭据。试过 GH_TOKEN 环境变量、`gh auth token`、GitHub CLI 的 hosts.yml。\
         在终端跑一次 `gh auth login` 就有了。"
            .to_string()
    })?;
    let me = flow_core::account::Account::fetch(&token, via).map_err(|e| e.to_string())?;
    let mut g = session().lock().map_err(|_| "登录状态锁坏了".to_string())?;
    *g = Some(Session { token, via });
    Ok(me)
}

#[tauri::command]
fn account_me() -> Result<flow_core::account::Account, String> {
    let g = session().lock().map_err(|_| "登录状态锁坏了".to_string())?;
    let s = g.as_ref().ok_or_else(|| "还没登录".to_string())?;
    flow_core::account::Account::fetch(&s.token, s.via).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
fn account_repos(limit: Option<usize>) -> Result<Vec<flow_core::account::OwnedRepo>, String> {
    let g = session().lock().map_err(|_| "登录状态锁坏了".to_string())?;
    let s = g.as_ref().ok_or_else(|| "还没登录".to_string())?;
    flow_core::account::repos(&s.token, limit.unwrap_or(12)).map_err(|e| e.to_string())
}

#[tauri::command]
fn account_signout() -> Result<(), String> {
    let mut g = session().lock().map_err(|_| "登录状态锁坏了".to_string())?;
    *g = None;
    Ok(())
}

/// 不开窗口、只跑一次真实取数，把结果写成 JSON。
/// 用来验证「发布版 exe 到底连没连上库」——上一版正是因为没这个，
/// 才让一堆假数据在界面上活了四天。
fn run_selftest(out: &str) -> ! {
    let result = (|| -> Res<serde_json::Value> {
        let mut store = open_db()?;
        let items = store.feed(12)?;
        let first = items.first().map(|r| r.full_name.clone()).unwrap_or_default();

        // 收藏写一遍再读回来，确认写路径也是通的，而不只是能读
        let mut roundtrip = false;
        if let Some(r) = items.first() {
            store.set_saved(r.id, true)?;
            roundtrip = store.get(r.id)?.map(|x| x.saved).unwrap_or(false);
            store.set_saved(r.id, false)?;
        }

        Ok(serde_json::json!({
            "ok": !items.is_empty() && roundtrip,
            "db": db_path().display().to_string(),
            "total": store.count()?,
            "feed": items.len(),
            "first": first,
            "saved_roundtrip": roundtrip,
            "sample": items.iter().take(6)
                .map(|r| format!("{} · {:.2}", r.full_name, r.score))
                .collect::<Vec<_>>(),
        }))
    })();

    let payload = match result {
        Ok(v) => v,
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let ok = payload["ok"].as_bool().unwrap_or(false);
    let _ = std::fs::write(out, serde_json::to_string_pretty(&payload).unwrap_or_default());
    std::process::exit(if ok { 0 } else { 1 });
}

fn main() {
    if let Ok(out) = std::env::var("FLOW_SELFTEST") {
        run_selftest(&out);
    }

    let store = match open_db() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("打不开数据库：{e}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(AppState(Mutex::new(store)))
        .invoke_handler(tauri::generate_handler![
            feed,
            detail,
            toggle_save,
            saved_list,
            app_info,
            repo_extra,
            tr_lines,
            tr_md,
            tr_status,
            open_url,
            account_signin,
            account_me,
            account_repos,
            account_signout
        ])
        .run(tauri::generate_context!())
        .expect("窗口启动失败");
}
