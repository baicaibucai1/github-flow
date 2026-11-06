//! 从 README 原文里取出「首屏那一眼」。
//!
//! 卡片头部要展示的不是仓库元数据（那种信息卡片底部已经有了），
//! 而是这个项目自己在 README 开头写的那句话和那张图。
//! 所以这里只做三件事：抽标题、抽第一段、抽第一张能当封面的图。
//!
//! 规则全都偏向保守：拿不准就返回空，让界面退回纯文字形态，
//! 而不是把「## Installation」当成项目名糊到用户脸上。

/// 抽出来的首屏三件套。
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Head {
    pub title: String,
    pub text: String,
    pub cover: String,
    pub kind: CoverKind,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CoverKind {
    #[default]
    None,
    /// 截图 / 演示图，适合铺满裁切
    Shot,
    /// 图标 / logo，适合留白居中
    Logo,
    /// 动图，值得给但体积大
    Gif,
}

impl CoverKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CoverKind::None => "",
            CoverKind::Shot => "shot",
            CoverKind::Logo => "logo",
            CoverKind::Gif => "gif",
        }
    }
}

/// 这些域名下的图一律是徽章/状态条，不是封面。
const BADGE_HOSTS: &[&str] = &[
    "img.shields.io",
    "badgen.net",
    "badge.fury.io",
    "travis-ci",
    "codecov.io",
    "coveralls.io",
    "app.fossa.com",
    "snyk.io",
    "goreportcard.com",
    "api.codacy.com",
    "opencollective.com",
    "discord.com",
    "discordapp.com",
    "trendshift.io",
    "api.netlify.com",
    "awesomecode.io",
    "pepy.tech",
    "star-history.com",
    "contrib.rocks",
    "gitpod.io",
    "vercel.com",
    "producthunt.com",
    "badge.buildkite.com",
    "ci.appveyor.com",
    "microsoft.com/azure",
];

/// 一级标题里出现这些词，说明它写的是流程，不是项目名。
const GENERIC_TITLE: &[&str] = &[
    "install", "installation", "download", "downloads", "getting started", "usage", "about",
    "announcements", "news", "build", "building", "quick start", "quickstart", "setup",
    "安装", "下载", "使用", "简介", "介绍", "快速开始", "快速上手", "构建", "说明", "更新",
    "公告", "文档", "目录", "特性", "功能",
];

/// 拆成「去掉围栏代码块之后」的正文行。
///
/// 代码块必须先整块丢掉：一是里面全是 `#` 注释会被当成标题，
/// 二是很多 README 一上来就是一段 ASCII art 的 logo，
/// 只按行过滤挡不住跨行的图案。
fn body_lines(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut fence: Option<&str> = None;
    for line in text.lines() {
        let t = line.trim_start();
        if let Some(f) = fence {
            if t.starts_with(f) {
                fence = None;
            }
            continue;
        }
        if let Some(f) = fence_of(t) {
            fence = Some(f);
            continue;
        }
        out.push(line);
    }
    out
}

/// 把跨行的 HTML 标签合并成一行。
///
/// README 里的 `<img>` 经常是这么写的：
/// ```html
/// <img
///   src="https://..."
///   width="600" />
/// ```
/// 逐行解析时第一行会变成 `", width="600" />` 这种碎片，最后当成正文显示出来。
/// 这里先把 `<` 到 `>` 之间的东西（含换行）整段抹掉，换行本身保留，
/// 免得两段本来分开的说明粘成一行。
fn drop_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        if in_tag {
            if c == '>' {
                in_tag = false;
            } else if c == '\n' {
                out.push('\n');
            }
            continue;
        }
        if c == '<' {
            in_tag = true;
            continue;
        }
        out.push(c);
    }
    out
}

fn fence_of(t: &str) -> Option<&'static str> {
    for f in ["```", "~~~"] {
        if t.starts_with(f) {
            return Some(f);
        }
    }
    None
}

/// 去掉 Markdown 与 HTML 的标记，只留下人话。
fn plain(line: &str) -> String {
    let mut s = String::with_capacity(line.len());
    let bytes: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        // ![alt](url) 与 [text](url)：只保留方括号里的字
        if bytes[i] == '!' && i + 1 < bytes.len() && bytes[i + 1] == '[' {
            i += 2;
            let mut alt = String::new();
            while i < bytes.len() && bytes[i] != ']' {
                alt.push(bytes[i]);
                i += 1;
            }
            while i < bytes.len() && bytes[i] != ')' {
                i += 1;
            }
            i += 1;
            continue;
        }
        if bytes[i] == '[' {
            let mut j = i + 1;
            let mut label = String::new();
            while j < bytes.len() && bytes[j] != ']' {
                label.push(bytes[j]);
                j += 1;
            }
            if j + 1 < bytes.len() && bytes[j + 1] == '(' {
                while j < bytes.len() && bytes[j] != ')' {
                    j += 1;
                }
                s.push_str(&label);
                i = j + 1;
                continue;
            }
        }
        // 行内 HTML 标签
        if bytes[i] == '<' {
            if let Some(end) = bytes[i..].iter().position(|&c| c == '>') {
                i += end + 1;
                continue;
            }
        }
        s.push(bytes[i]);
        i += 1;
    }
    s.replace("**", "")
        .replace("__", "")
        .replace('`', "")
        .replace("\\", "")
}

/// 一整行是不是徽章（`[![alt](img)](link)` 这类）。
fn is_badge(line: &str) -> bool {
    let l = line.trim();
    l.starts_with("[![") || l.starts_with("[![!") || (l.starts_with("![") && l.matches("![").count() >= 2)
}

/// ASCII art：方块字符、制表线、大段整行符号。
fn is_art(line: &str) -> bool {
    let n = line.chars().count();
    if n < 6 {
        return false;
    }
    let art = line
        .chars()
        .filter(|c| ('\u{2500}'..='\u{259f}').contains(c) || matches!(c, '█' | '▓' | '▒' | '░' | '▄' | '▀'))
        .count();
    if art * 4 >= n {
        return true;
    }
    // 纯符号铺出来的分隔线
    let sym = line
        .chars()
        .filter(|c| !c.is_alphanumeric() && !c.is_whitespace())
        .count();
    sym * 2 > n && line.chars().filter(|c| c.is_alphanumeric()).count() < 3
}

fn is_heading(line: &str) -> Option<(usize, String)> {
    let t = line.trim_start();
    if !t.starts_with('#') {
        return None;
    }
    let level = t.chars().take_while(|&c| c == '#').count();
    if level > 4 {
        return None;
    }
    let rest = t[level..].trim_start();
    if rest.is_empty() {
        return None;
    }
    Some((level, rest.to_string()))
}

fn clean_title(raw: &str) -> Option<String> {
    let t = plain(raw);
    // emoji 与装饰符号去掉，只留字
    let t: String = t
        .chars()
        .filter(|c| !c.is_ascii_punctuation() || matches!(c, '-' | '.' | '/' | '+'))
        .filter(|c| !is_decoration(*c))
        .collect();
    let t = t.trim().trim_matches(|c: char| !c.is_alphanumeric()).trim().to_string();
    if t.chars().count() < 2 || t.chars().count() > 60 {
        return None;
    }
    // 标题行里塞了徽章或链接时，剥完标记会剩下网址碎片，这种标题不能要
    let low = t.to_lowercase();
    if low.contains("http") || low.contains("//") || low.contains("](") || low.contains("![") {
        return None;
    }
    if GENERIC_TITLE.iter().any(|g| low == *g) {
        return None;
    }
    Some(t)
}

fn is_decoration(c: char) -> bool {
    // emoji 与各种图形符号
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0xFE0F)
}

/// 这一段像不像正经说明。
fn looks_like_prose(s: &str) -> bool {
    let n = s.chars().count();
    if n < 12 {
        return false;
    }
    let first = s.chars().next().unwrap_or(' ');
    // 以这些字符开头的行基本是上一行没写完的碎片（跨行链接、表格、代码残留）
    if "|#>-=*])(".contains(first) {
        return false;
    }
    // 几乎就是个网址
    if s.contains("://") && s.split_whitespace().count() <= 3 {
        return false;
    }
    // 纯链接 / 一两句被空格切开的短词堆
    if s.starts_with("http") && s.split_whitespace().count() <= 2 {
        return false;
    }
    // 目录页那种「A | B | C」的长链接行
    if s.matches('|').count() >= 3 {
        return false;
    }
    // 中文没有空格，按字数算；英文按词数算。
    // 两套阈值都要有，否则一句正经中文说明会被当成空行。
    let words = s.split_whitespace().count();
    let cjk = s.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count();
    words >= 4 || cjk >= 10 || n >= 30
}

/// 抽首屏。`full_name` 用来把相对路径的图拼成 raw 地址。
pub fn parse(text: &str, full_name: &str) -> Head {
    // 两份行：raw 用来找图（`<img>` 本身就得留着），txt 是抹掉标签后的正文。
    // `drop_tags` 保留了换行，所以两边行号一一对应。
    let cleaned = drop_tags(text);
    let raw_lines = body_lines(text);
    let txt_lines = body_lines(&cleaned);

    let mut title = String::new();
    let mut body = String::new();
    // 只看开头这一段。有些 README 前面有几百行更新日志，
    // 那不是「一眼能看出这是什么」的东西。
    let head_lines: Vec<&str> = raw_lines.iter().take(120).cloned().collect();
    let joined = head_lines.join("\n");

    // 截图比 logo 有信息量：README 常常先放个图标再放截图，
    // 所以不是「取第一张」，而是「取第一张截图，没有截图才退回图标」。
    let imgs = images_in(&joined, full_name);
    let picked = imgs
        .iter()
        .find(|(_, k)| !matches!(k, CoverKind::Logo))
        .or_else(|| imgs.first());

    for txt in txt_lines.iter().take(120) {
        if title.is_empty() {
            if let Some((1, raw_title)) = is_heading(txt) {
                if let Some(t) = clean_title(&raw_title) {
                    title = t;
                    continue;
                }
            }
        }
        if body.is_empty() {
            if is_heading(txt).is_some()
                || is_badge(txt)
                || is_art(txt)
                || is_link_bar(txt)
                || is_link_def(txt)
            {
                continue;
            }
            let mut p = plain(txt).trim().to_string();
            // 列表项的「- 」「1. 」不是说明的一部分
            p = strip_list_marker(&p);
            if looks_like_prose(&p) {
                body = p.chars().take(260).collect();
            }
        }
    }

    let (cover, kind) = match picked {
        Some((u, k)) => (u.clone(), *k),
        None => (String::new(), CoverKind::None),
    };

    Head {
        title,
        text: body,
        cover,
        kind,
    }
}

/// 引用式链接的定义行：`[image]: https://cdn.../a.png`。
/// 它不是正文，只是给正文里的 `![x][image]` 提供地址；
/// 不过滤的话会变成「image: https://...」这样一行怪字。
fn is_link_def(line: &str) -> bool {
    let t = line.trim();
    // RST 的指令与注释（`.. image:: x`、`.. note::`）
    if t.starts_with(".. ") || t == ".." {
        return true;
    }
    if !t.starts_with('[') {
        return false;
    }
    match t.find("]:") {
        Some(i) => i > 1 && i < 80,
        None => false,
    }
}

/// 语言切换条、导航条：「English · 简体中文 · 日本語」或「Docs | API | Blog」。
/// 这一类行字都对，但完全没有说明这个项目是干什么的。
fn is_link_bar(line: &str) -> bool {
    let links = line.matches("](").count();
    if links >= 2 {
        return true;
    }
    let seps = line.matches('·').count() + line.matches('｜').count();
    if seps >= 3 {
        return true;
    }
    let pipes = line.matches('|').count();
    pipes >= 3
}

fn strip_list_marker(s: &str) -> String {
    let t = s.trim_start();
    if let Some(rest) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
        return rest.to_string();
    }
    // 1. / 1) 这种
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        if let Some(rest) = t[digits.len()..].trim_start().strip_prefix(['.', ')']) {
            return rest.trim_start().to_string();
        }
    }
    t.to_string()
}

/// 从一段文本里按出现顺序列出所有能用的图。
///
/// 传进来的是开头若干行拼成的一整段，而不是单行：README 里的
/// `<img\n src="...">` 跨行写法很常见，逐行扫会整张漏掉。
fn images_in(text: &str, full_name: &str) -> Vec<(String, CoverKind)> {
    let mut cands: Vec<(usize, String)> = Vec::new();

    let bytes: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == '!' && bytes[i + 1] == '[' {
            // ![alt](url "title")
            let mut j = i + 2;
            while j < bytes.len() && bytes[j] != ']' {
                j += 1;
            }
            if j + 1 < bytes.len() && bytes[j + 1] == '(' {
                let start = j + 2;
                let mut k = start;
                while k < bytes.len() && bytes[k] != ')' {
                    k += 1;
                }
                let raw: String = bytes[start..k].iter().collect();
                let url = raw
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches(['<', '>'])
                    .to_string();
                if !url.is_empty() {
                    cands.push((i, url));
                }
                i = k;
            }
        }
        i += 1;
    }
    // <img src="...">
    let lower = text.to_lowercase();
    let mut from = 0;
    while let Some(p) = lower[from..].find("<img") {
        let at = from + p;
        let rest = &text[at..];
        if let Some(src) = attr(rest, "src") {
            cands.push((at, src));
        }
        from = at + 4;
        if from >= text.len() {
            break;
        }
    }
    // reStructuredText 的图：`.. image:: https://.../a.png`
    // Python 系项目大量用 README.rst，不认这条就会一张图都取不到。
    for key in ["image::", "figure::"] {
        let mut at = 0;
        while let Some(p) = lower[at..].find(key) {
            let pos = at + p;
            let after = &text[pos + key.len()..];
            if let Some(tok) = after.split_whitespace().next() {
                if tok.starts_with("http") || tok.ends_with(".png") || tok.ends_with(".jpg") {
                    cands.push((pos, tok.to_string()));
                }
            }
            at = pos + key.len();
            if at >= text.len() {
                break;
            }
        }
    }

    cands.sort_by_key(|(pos, _)| *pos);
    cands
        .into_iter()
        .filter_map(|(_, url)| usable(&url).map(|k| (resolve(&url, full_name), k)))
        .collect()
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let p = lower.find(&format!("{name}="))?;
    let after = &tag[p + name.len() + 1..];
    let q = after.chars().next()?;
    if q == '"' || q == '\'' {
        let end = after[1..].find(q)?;
        Some(after[1..1 + end].to_string())
    } else {
        Some(after.split_whitespace().next()?.trim_end_matches('>').to_string())
    }
}

/// 这张图有没有资格当封面。
fn usable(url: &str) -> Option<CoverKind> {
    let low = url.to_lowercase();
    if low.starts_with("data:") {
        return None;
    }
    if BADGE_HOSTS.iter().any(|h| low.contains(h)) {
        return None;
    }
    // 视频/附件不是图
    if low.contains("user-attachments") || low.ends_with(".mp4") || low.ends_with(".webm") {
        return None;
    }
    // 路径部分才是真正的文件名，#gh-dark-mode-only 这类锚点不能当成后缀
    let path = low.split(['?', '#']).next().unwrap_or(&low);
    if path.ends_with(".svg") {
        return None; // 矢量图多用于 logo/徽章，栅格化后经常糊，且常有明暗两版
    }
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.split('.').next().unwrap_or(file);
    let is_gif = path.ends_with(".gif");
    let is_logo = ["logo", "icon", "favicon", "avatar", "mark"]
        .iter()
        .any(|w| stem.contains(w));
    Some(match (is_gif, is_logo) {
        (true, _) => CoverKind::Gif,
        (false, true) => CoverKind::Logo,
        _ => CoverKind::Shot,
    })
}

/// 相对路径统一拼到 raw.githubusercontent 的 HEAD 上。
/// 用 HEAD 而不是某条分支名：仓库默认分支叫 master 还是 main，采集时并不知道。
fn resolve(url: &str, full_name: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        // github.com/o/r/raw/branch/path 是网页入口，换成 CDN 直链更稳
        if let Some(rest) = url
            .strip_prefix("https://github.com/")
            .or_else(|| url.strip_prefix("http://github.com/"))
        {
            let mut it = rest.splitn(4, '/');
            if let (Some(o), Some(r), Some(raw), Some(path)) =
                (it.next(), it.next(), it.next(), it.next())
            {
                if raw == "raw" {
                    return format!("https://raw.githubusercontent.com/{o}/{r}/{path}");
                }
            }
        }
        return url.to_string();
    }
    let u = url.trim_start_matches("./").trim_start_matches('/');
    format!("https://raw.githubusercontent.com/{full_name}/HEAD/{u}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAURI: &str = r#"<img src=".github/splash.png" alt="Tauri" />

[![status](https://img.shields.io/badge/status-stable-blue.svg)](https://tauri.app)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](https://x)

## Introduction

Tauri is a framework for building tiny, blazingly fast binaries for all major
operating systems.
"#;

    #[test]
    fn 徽章不算封面_相对路径要拼成_raw() {
        let h = parse(TAURI, "tauri-apps/tauri");
        assert_eq!(h.cover, "https://raw.githubusercontent.com/tauri-apps/tauri/HEAD/.github/splash.png");
        assert_eq!(h.kind, CoverKind::Shot);
        assert_eq!(h.text, "Tauri is a framework for building tiny, blazingly fast binaries for all major");
    }

    #[test]
    fn 没有一级标题就不硬凑标题() {
        let h = parse("## Installation\n\n- run npm i\n", "a/b");
        assert_eq!(h.title, "");
    }

    #[test]
    fn 一级标题里的流程图不当项目名() {
        let h = parse("# Download\n\nSomething useful goes here for sure.\n", "a/b");
        assert_eq!(h.title, "");
    }

    #[test]
    fn 代码块里的井号不会被当成标题() {
        let h = parse("```sh\n# install me\nnpm i x\n```\n\n# Real Name\n\nA real description of the thing here.\n", "a/b");
        assert_eq!(h.title, "Real Name");
        assert_eq!(h.text, "A real description of the thing here.");
    }

    #[test]
    fn ascii_画会被跳过() {
        let h = parse("░██    ░██     ░████    ░██\n░██    ░██     ░██      ░██\n\n真的一句话说明这个项目是干什么的。\n", "a/b");
        assert_eq!(h.text, "真的一句话说明这个项目是干什么的。");
    }

    #[test]
    fn svg_和视频附件不算图() {
        let h = parse("![x](https://raw.githubusercontent.com/a/b/main/docs/a.svg#gh-dark-mode-only)\n\nNothing here at all\n", "a/b");
        assert_eq!(h.cover, "");
    }

    #[test]
    fn icon_归为图标() {
        let h = parse("![](build/icon.png)\n", "a/b");
        assert_eq!(h.kind, CoverKind::Logo);
    }

    #[test]
    fn github_raw_网页地址转成_cdn() {
        let h = parse("![s](https://github.com/o/r/raw/main/docs/a.png)\n", "o/r");
        assert_eq!(h.cover, "https://raw.githubusercontent.com/o/r/main/docs/a.png");
    }

    #[test]
    fn 徽章在前_正经图在后_要取正经图() {
        let line = "[![b](https://img.shields.io/x.svg)](https://x) ![shot](docs/shot.png)";
        let h = parse(line, "a/b");
        assert!(h.cover.ends_with("docs/shot.png"), "{}", h.cover);
    }

    #[test]
    fn 有截图时优先截图而不是图标() {
        let h = parse("![](assets/logo.png)\n\n![](docs/main-window.png)\n", "a/b");
        assert!(h.cover.ends_with("docs/main-window.png"), "{}", h.cover);
        assert_eq!(h.kind, CoverKind::Shot);
    }

    #[test]
    fn 语言切换条不算说明() {
        let h = parse(
            "# rea\n\n[English](en.md) · [简体中文](zh.md) · [繁體中文](tw.md) · [日本語](ja.md)\n\nReverse engineer anything on your machine.\n",
            "a/b",
        );
        assert_eq!(h.text, "Reverse engineer anything on your machine.");
    }

    #[test]
    fn 引用式链接的定义行不算正文() {
        let h = parse(
            "[image]: https://cdn.jsdelivr.net/gh/x/y@main/a.png\n\nPyMC is a probabilistic programming library for Python.\n",
            "a/b",
        );
        assert_eq!(h.text, "PyMC is a probabilistic programming library for Python.");
    }

    #[test]
    fn 只有图标时退而用图标() {
        let h = parse("![](assets/logo.png)\n", "a/b");
        assert_eq!(h.kind, CoverKind::Logo);
        assert!(h.cover.ends_with("assets/logo.png"));
    }

    #[test]
    fn 标题里带链接碎片就不要() {
        let h = parse(
            "# OpenAI Agents SDK [![PyPI](https://x/b.svg)](https://pypi.org/project/x)\n\nA real description of the agent sdk.\n",
            "a/b",
        );
        assert_eq!(h.title, "");
        assert_eq!(h.text, "A real description of the agent sdk.");
    }

    #[test]
    fn 跨行写的_img_既能量到封面也不漏进正文() {
        let t = "<p align=\"center\">\n<img\n  src=\"docs/hero.png\"\n  width=\"600\" />\n</p>\n\nA real sentence describing this project well enough.\n";
        let h = parse(t, "a/b");
        assert!(h.cover.ends_with("docs/hero.png"), "{}", h.cover);
        assert_eq!(h.text, "A real sentence describing this project well enough.");
    }

    #[test]
    fn 上一行没写完的链接碎片不算正文() {
        let h = parse(
            "[![sonar](https://x/badge.svg)]\n(https://sonarcloud.io/dashboard?id=x)\n\nActual prose that explains the project.\n",
            "a/b",
        );
        assert_eq!(h.text, "Actual prose that explains the project.");
    }
}
