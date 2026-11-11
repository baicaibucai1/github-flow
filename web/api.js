// 唯一的数据出口。
//
// 这里**没有 mock，也没有「连不上就退回演示数据」的分支**。
// 上一版正是因为有那条分支，界面看着一切正常，实际四天没显示过一条真数据。
// 拿不到库就抛错，让界面把错误显示出来——宁可难看，不可假装。

const T = window.__TAURI__;
const invoke = T?.core?.invoke;

export function available() {
  return typeof invoke === "function";
}

function need() {
  if (!invoke) {
    throw new Error("必须在 Flow 应用内运行：浏览器直接打开页面拿不到本地库");
  }
  return invoke;
}

export const info = () => need()("app_info");
export const feed = (limit = 800) => need()("feed", { limit });
export const detail = (id) => need()("detail", { id });
export const toggleSave = (id, on) => need()("toggle_save", { id, on });
export const saved = () => need()("saved_list");
export const openUrl = (url) => need()("open_url", { url });

// README 全文 + 文件树。这两个不在本地库里：库里只存了首屏摘要，
// 完整 README 和目录结构要现拉 GitHub。所以它们是可失败的——
// 失败了界面上就显示「拉不到」，卡片本身照常能看。
export const repoExtra = (fullName) => need()("repo_extra", { full_name: fullName });

// 翻译。默认走本地词典：不开网络、不用配 key，纯计算。
// 传进来的是一批文案，返回同序的中文，翻不动的原样返回。
export const trLines = (items) => need()("tr_lines", { items });
export const trMd = (text) => need()("tr_md", { text });
export const trStatus = () => need()("tr_status");

// 「我的」：令牌由外壳从本机凭据里取，界面从头到尾碰不到它。
// 登录失败会带出具体原因（没装 gh / 令牌过期 / 网络不通），直接显示在登录卡上。
export const accountSignin = () => need()("account_signin");
export const accountMe = () => need()("account_me");
export const accountSignout = () => need()("account_signout");
export const accountRepos = (limit = 12) => need()("account_repos", { limit });
