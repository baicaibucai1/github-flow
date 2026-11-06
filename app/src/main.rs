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
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("窗口启动失败");
}
