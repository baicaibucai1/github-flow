//! 「看到才翻」的翻译通道。
//!
//! 这里没有预翻译：没人看到的内容，一个 token 都不该花。
//! 谁被滚进视口、谁被点开，谁才出去翻一次；翻完的结果落进本地 `tr` 表，
//! 下次再看到直接命中——这不是提前存，是花过钱的结果留下来。
//!
//! 引擎只实现了一种：OpenAI 兼容的 `/chat/completions`。
//! DeepSeek、通义、月之暗面、本地 vLLM 全都吃这套协议，换一家只改 base_url。
//! 之所以不接传统 MT 接口，是因为它们会把 `npm install` 翻成中文。

use crate::store::{Res, Store};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const UA: &str = "flow/0.1 (github discovery client)";
/// 一批 markdown 块之间的分隔符。挑这种形状是因为
/// 它不会出现在正常正文里，模型也不会自作主张改写它。
const SEP: &str = "\n<<<>>>\n";

// ─────────────────────────── 配置 ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// `openai` 走网络，`mock` 只做链路自检（把原文加个前缀返回）。
    #[serde(default = "d_engine")]
    pub engine: String,
    #[serde(default = "d_base")]
    pub base_url: String,
    #[serde(default = "d_model")]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

fn d_engine() -> String {
    // 默认本地。不开网络、不填 key、不花钱，装完就能用。
    "local".into()
}
fn d_base() -> String {
    "https://api.deepseek.com/v1".into()
}
fn d_model() -> String {
    "deepseek-chat".into()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            engine: d_engine(),
            base_url: d_base(),
            model: d_model(),
            api_key: String::new(),
        }
    }
}

impl Config {
    pub fn path(dir: &Path) -> PathBuf {
        dir.join("translate.json")
    }

    /// 文件里有的听文件，环境变量优先级更高——
    /// 这样临时换一家试效果不用改文件，也不会把 key 写进仓库。
    pub fn load(dir: &Path) -> Self {
        let mut c: Config = std::fs::read_to_string(Self::path(dir))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if let Ok(v) = std::env::var("FLOW_TR_ENGINE") {
            if !v.trim().is_empty() {
                c.engine = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var("FLOW_TR_BASE") {
            if !v.trim().is_empty() {
                c.base_url = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var("FLOW_TR_MODEL") {
            if !v.trim().is_empty() {
                c.model = v.trim().to_string();
            }
        }
        if let Ok(v) = std::env::var("FLOW_TR_KEY") {
            if !v.trim().is_empty() {
                c.api_key = v.trim().to_string();
            }
        }
        c
    }

    pub fn save(&self, dir: &Path) -> Res<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(Self::path(dir), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn ready(&self) -> bool {
        matches!(self.engine.as_str(), "local" | "mock") || !self.api_key.trim().is_empty()
    }

    pub fn is_local(&self) -> bool {
        self.engine == "local"
    }
}

/// 给界面看的引擎状态。**不含 api_key**，它不该离开本机。
#[derive(Debug, Serialize)]
pub struct Status {
    pub ready: bool,
    pub engine: String,
    pub model: String,
    pub base_url: String,
    pub cached: i64,
}

// ─────────────────────────── 引擎 ───────────────────────────

pub struct Engine {
    cfg: Config,
    agent: ureq::Agent,
}

impl Engine {
    pub fn new(cfg: Config) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .user_agent(UA)
            .build();
        Self { cfg, agent }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    fn chat(&self, system: &str, user: &str) -> Res<String> {
        if self.cfg.engine == "mock" {
            // 自检用：原样回显，用来验证分块、缓存、界面替换这一整条链路。
            return Ok(user.to_string());
        }
        if !self.cfg.ready() {
            return Err("没有配置翻译引擎（缺 api_key）".into());
        }
        let url = format!(
            "{}/chat/completions",
            self.cfg.base_url.trim_end_matches('/')
        );
        let payload = serde_json::json!({
            "model": self.cfg.model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        });
        let resp = self
            .agent
            .post(&url)
            .set("Content-Type", "application/json")
            .set("Authorization", &format!("Bearer {}", self.cfg.api_key))
            .send_string(&payload.to_string());

        let body = match resp {
            Ok(r) => r.into_string().map_err(|e| format!("读取响应失败：{e}"))?,
            Err(ureq::Error::Status(code, r)) => {
                let t = r.into_string().unwrap_or_default();
                let cut: String = t.chars().take(240).collect();
                return Err(format!("翻译接口返回 {code}：{cut}").into());
            }
            Err(e) => return Err(format!("连不上翻译接口：{e}").into()),
        };

        let v: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
            format!("翻译接口返回的不是 JSON：{}", body.chars().take(200).collect::<String>())
        })?;
        let text = v["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| {
                format!(
                    "翻译接口缺少 content：{}",
                    body.chars().take(200).collect::<String>()
                )
            })?;
        Ok(text.to_string())
    }
}

// ─────────────────────────── 服务 ───────────────────────────

const SYS_LINES: &str = "\
你是技术文档翻译器。把用户给出的编号英文条目逐条翻译成简体中文。

规则：
1. 严格保持编号和顺序，一条一行，格式为「1. 译文」
2. 不翻译：产品名、仓库名、命令行、包名、URL、标识符
3. 不添加解释、不合并条目、不省略条目
4. 译文简洁，接近原文长度
5. 只输出译文列表，不要任何前后缀或说明";

const SYS_MD: &str = "\
你是技术文档翻译器。把用户给出的 markdown 片段翻译成简体中文。

规则：
1. 完整保留 markdown 语法：标题 #、列表 -、表格 |、引用 >、加粗 **、反引号
2. 反引号里的内容（代码、命令、变量名、文件名）一律不翻译，连反引号一起原样保留
3. 链接和图片的地址不要改动，只翻译方括号里给人看的文字
4. ⟦0⟧ 这样的占位符原样保留，位置不变，不要改成别的字符
5. 技术术语用通行译法：repository 仓库、commit 提交、pull request 拉取请求、fork 派生、branch 分支
6. 不加解释、不加前后缀，直接输出译文";

pub struct Service {
    engine: Engine,
}

impl Service {
    pub fn new(cfg: Config) -> Self {
        Self {
            engine: Engine::new(cfg),
        }
    }

    pub fn status(&self, store: &Store) -> Status {
        let c = self.engine.config();
        Status {
            ready: c.ready(),
            engine: c.engine.clone(),
            model: c.model.clone(),
            base_url: c.base_url.clone(),
            cached: store.tr_count().unwrap_or(0),
        }
    }

    /// 短文本批量翻译（卡片描述、仓库首段）。
    /// 输入顺序与输出顺序一一对应；翻不动的原样返回，绝不返回空串。
    pub fn lines(&self, store: &mut Store, items: &[String]) -> Res<Vec<String>> {
        // 本地引擎是纯计算：0.05ms 一条，不用缓存、不用并发、不用等网络。
        // 看到哪条算哪条，翻完就显示。
        if self.engine.config().is_local() {
            return Ok(items
                .iter()
                .map(|t| {
                    if worth(t) {
                        crate::glossary::paragraph(t).text
                    } else {
                        t.clone()
                    }
                })
                .collect());
        }

        let mut out: Vec<String> = items.to_vec();
        // 空串、纯数字、纯符号不值得发请求
        let want: Vec<usize> = items
            .iter()
            .enumerate()
            .filter(|(_, t)| worth(t))
            .map(|(i, _)| i)
            .collect();
        if want.is_empty() || !self.engine.config().ready() {
            return Ok(out);
        }

        let keys: Vec<String> = want.iter().map(|&i| key(&items[i])).collect();
        let hit = store.tr_get(&keys)?;

        let mut todo: Vec<usize> = Vec::new();
        for (n, &i) in want.iter().enumerate() {
            match hit.get(&keys[n]) {
                Some(zh) => out[i] = zh.clone(),
                None => todo.push(i),
            }
        }
        if todo.is_empty() {
            return Ok(out);
        }

        // 一条一条发太慢，全塞一起又容易漏；12 条 / 2400 字符是实测比较稳的粒度。
        for group in pack(&todo, &|i| items[i].len(), 12, 2400) {
            let body: String = group
                .iter()
                .enumerate()
                .map(|(n, &i)| format!("{}. {}", n + 1, squash(&items[i])))
                .collect::<Vec<_>>()
                .join("\n");
            let reply = match self.engine.chat(SYS_LINES, &body) {
                Ok(t) => t,
                // 整组失败就直接放弃这一组，界面照常显示原文。
                Err(_) => continue,
            };
            let got = parse_numbered(&reply);
            let mut fresh = Vec::new();
            for (n, &i) in group.iter().enumerate() {
                if let Some(zh) = got.get(&(n + 1)) {
                    let zh = zh.trim();
                    if !zh.is_empty() && zh.chars().count() >= 1 {
                        out[i] = zh.to_string();
                        fresh.push((
                            key(&items[i]),
                            items[i].clone(),
                            zh.to_string(),
                            self.engine.config().engine.clone(),
                        ));
                    }
                }
            }
            store.tr_put(&fresh)?;
        }
        Ok(out)
    }

    /// README 全文翻译。代码块整块跳过，图片先遮罩，翻完拼回原样。
    pub fn markdown(&self, store: &mut Store, src: &str) -> Res<String> {
        if !self.engine.config().ready() {
            return Ok(src.to_string());
        }
        if self.engine.config().is_local() {
            let chunks = split_md(src);
            let out: Vec<String> = chunks
                .iter()
                .map(|c| match c {
                    Chunk::Keep(t) => t.clone(),
                    Chunk::Tr(t) => {
                        let (m, imgs) = mask_images(t);
                        unmask_images(&crate::glossary::paragraph(&m).text, &imgs)
                    }
                    Chunk::Html(t) => crate::glossary::html_line(t),
                })
                .collect();
            return Ok(out.join("\n\n"));
        }

        let chunks = split_md(src);
        let tr_idx: Vec<usize> = chunks
            .iter()
            .enumerate()
            .filter(|(_, c)| matches!(c, Chunk::Tr(_) | Chunk::Html(_)))
            .map(|(i, _)| i)
            .collect();
        if tr_idx.is_empty() {
            return Ok(src.to_string());
        }

        // 遮罩：图片语法整段换成 ⟦n⟧，徽章墙和截图地址一个字都不能让模型碰。
        let mut masked: Vec<(usize, String, Vec<String>)> = Vec::new();
        for &i in &tr_idx {
            let t = match &chunks[i] {
                Chunk::Tr(t) | Chunk::Html(t) => t,
                _ => continue,
            };
            let (m, imgs) = mask_images(t);
            masked.push((i, m, imgs));
        }

        let keys: Vec<String> = masked.iter().map(|(_, t, _)| key(t)).collect();
        let hit = store.tr_get(&keys)?;
        let mut done: Vec<Option<String>> = masked
            .iter()
            .enumerate()
            .map(|(n, _)| hit.get(&keys[n]).cloned())
            .collect();

        let todo: Vec<usize> = (0..masked.len()).filter(|&n| done[n].is_none()).collect();
        // 按 3 块 / 4000 字符打包。太碎会把一句话的上下文切散。
        let groups = pack(&todo, &|n| masked[n].1.len(), 3, 4000);

        let mut fresh: Vec<(String, String, String, String)> = Vec::new();
        for batch in groups {
            let body = batch
                .iter()
                .map(|&n| masked[n].1.as_str())
                .collect::<Vec<_>>()
                .join(SEP);
            let reply = match self.engine.chat(SYS_MD, &body) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let parts: Vec<&str> = reply.split(SEP.trim()).collect();
            let parts: Vec<String> = if parts.len() == batch.len() {
                parts.into_iter().map(|s| s.to_string()).collect()
            } else if batch.len() == 1 {
                // 单块时模型可能顺手把分隔符吃掉，这不算错。
                vec![reply.clone()]
            } else {
                // 块数对不上就整批作废，宁可显示英文，也不能把两段拼成一段。
                continue;
            };
            for (k, &n) in batch.iter().enumerate() {
                let zh = parts[k].trim();
                if zh.is_empty() || !sane(&masked[n].1, zh) {
                    continue;
                }
                done[n] = Some(zh.to_string());
                fresh.push((
                    keys[n].clone(),
                    masked[n].1.clone(),
                    zh.to_string(),
                    self.engine.config().engine.clone(),
                ));
            }
        }
        store.tr_put(&fresh)?;

        // 拼回：只替换真正翻成功的块，其余保留英文原文。
        let mut out: Vec<String> = Vec::with_capacity(chunks.len());
        for (n, c) in chunks.iter().enumerate() {
            match c {
                Chunk::Keep(t) => out.push(t.clone()),
                Chunk::Tr(t) | Chunk::Html(t) => {
                    let pos = masked.iter().position(|(ci, _, _)| *ci == n);
                    match pos.and_then(|p| done[p].clone()) {
                        Some(zh) => out.push(unmask_images(&zh, &masked[pos.unwrap()].2)),
                        None => out.push(t.clone()),
                    }
                }
            }
        }
        Ok(out.join("\n\n"))
    }
}

// ─────────────────────────── 工具 ───────────────────────────

/// FNV-1a。用它而不是 DefaultHasher，是因为后者不保证跨版本稳定，
/// 换了编译器缓存就全失效，而这个 key 要长期留在库里。
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn key(text: &str) -> String {
    format!("{:016x}", fnv1a(&format!("zh\u{0}{text}")))
}

/// 值不值得发一次请求。纯符号、纯数字、已经很短的中文都跳过。
fn worth(t: &str) -> bool {
    let t = t.trim();
    if t.is_empty() {
        return false;
    }
    let cjk = t.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count();
    let letters = t.chars().filter(|c| c.is_alphabetic()).count();
    // 已经是中文，或根本没有字母，都不用翻
    letters > 0 && cjk * 2 < letters
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 把下标按「每组 N 条、总量不超过 M 字符」切开，保持原顺序。
fn pack(idx: &[usize], size: &dyn Fn(usize) -> usize, n: usize, m: usize) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut len = 0;
    for &i in idx {
        let s = size(i);
        if !cur.is_empty() && (cur.len() >= n || len + s > m) {
            out.push(std::mem::take(&mut cur));
            len = 0;
        }
        cur.push(i);
        len += s;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn lead_num(s: &str) -> Option<(usize, &str)> {
    let s = s.trim_start();
    let mut n = 0usize;
    let mut end = 0usize;
    for (i, c) in s.char_indices() {
        if let Some(d) = c.to_digit(10) {
            n = n * 10 + d as usize;
            end = i + c.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        return None;
    }
    let rest = s[end..].trim_start_matches(['.', '、', ')', '）', ':', '：', ' ', '\t']);
    Some((n, rest))
}

/// 解析「1. 译文」这种编号列表。同一编号下的续行会被接回去，
/// 因为模型偶尔会在一条里换行。
fn parse_numbered(s: &str) -> std::collections::HashMap<usize, String> {
    let mut out: std::collections::HashMap<usize, String> = Default::default();
    let mut cur: Option<usize> = None;
    for line in s.lines() {
        match lead_num(line) {
            Some((n, rest)) => {
                out.insert(n, rest.to_string());
                cur = Some(n);
            }
            None => {
                if let Some(n) = cur {
                    if !line.trim().is_empty() {
                        if let Some(v) = out.get_mut(&n) {
                            v.push(' ');
                            v.push_str(line.trim());
                        }
                    }
                }
            }
        }
    }
    out
}

/// 译文的基本体检。反引号数量对不上，说明模型把代码标记弄坏了；
/// 长度掉到原文一成，说明它没在翻。
fn sane(src: &str, zh: &str) -> bool {
    if zh.trim().is_empty() {
        return false;
    }
    if zh.matches('`').count() < src.matches('`').count() {
        return false;
    }
    let a = src.chars().count();
    let b = zh.chars().count();
    b * 10 >= a
}

// ─────────────────────── markdown 分块 ───────────────────────

pub enum Chunk {
    /// 原样保留：代码块。
    Keep(String),
    /// 需要翻译的正文。
    Tr(String),
    /// 一行裸 HTML：标签不动，只翻标签之间的文字。
    /// 单独成一类是因为全文翻译会把标签里的属性拆散，
    /// `<p align="center">` 变成 `< p align = " center " >`，HTML 直接废掉。
    Html(String),
}

fn flush(out: &mut Vec<Chunk>, buf: &mut Vec<String>) {
    if buf.is_empty() {
        return;
    }
    let text = buf.join("\n");
    buf.clear();
    if text.trim().is_empty() {
        return;
    }
    // 相邻小段合并，避免一句一个请求。
    if let Some(Chunk::Tr(prev)) = out.last_mut() {
        if prev.chars().count() + text.chars().count() < 900 {
            prev.push_str("\n\n");
            prev.push_str(&text);
            return;
        }
    }
    out.push(Chunk::Tr(text));
}



/// 这一行自己就是一个 markdown 块的开头吗（标题、列表项、表格行、引用、
/// 图片、链接块、有序列表）。是的话就不能并进上一行。
fn starts_structure(t: &str) -> bool {
    let t = t.trim_start();
    let Some(first) = t.chars().next() else {
        return true;
    };
    if matches!(first, '#' | '-' | '*' | '+' | '>' | '|' | '<' | '!' | '[') {
        return true;
    }
    // 标题的下划线（=== / ---）
    if t.chars().all(|c| c == '=' || c == '-') && !t.is_empty() {
        return true;
    }
    // 有序列表：1. / 1) / 1、
    if first.is_ascii_digit() {
        let rest: String = t.chars().skip_while(|c| c.is_ascii_digit()).take(2).collect();
        if rest.starts_with('.') || rest.starts_with(')') {
            return true;
        }
    }
    false
}

/// 这一行里有没有 HTML 标签。`<` 后面必须是字母或 `/`，
/// 否则 `a < b` 这种比较式会被误判，`< b` 之后的内容全被当成标签属性吞掉。
fn has_tag(line: &str) -> bool {
    let ch: Vec<char> = line.chars().collect();
    ch.iter().enumerate().any(|(i, c)| {
        *c == '<' && ch.get(i + 1).map(|n| n.is_ascii_alphabetic() || *n == '/').unwrap_or(false)
    })
}

/// 切块。三条铁律：
/// 围栏代码块整块不动；以 `<` 开头的行整行不动；正文按空行分段。
pub fn split_md(src: &str) -> Vec<Chunk> {
    let lines: Vec<&str> = src.lines().collect();
    let mut out: Vec<Chunk> = Vec::new();
    let mut buf: Vec<String> = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let t = lines[i].trim_start();

        if t.starts_with("```") || t.starts_with("~~~") {
            let mark: String = t.chars().take(3).collect();
            let start = i;
            i += 1;
            while i < lines.len() {
                let closed = lines[i].trim_start().starts_with(&mark);
                i += 1;
                if closed {
                    break;
                }
            }
            flush(&mut out, &mut buf);
            out.push(Chunk::Keep(lines[start..i].join("\n")));
            continue;
        }

        // 只要这行里有标签就交给 html_line：`Just type <a href="...">go</a>`
        // 这种行不全是 HTML，但整行拿去逐词翻，`<a href>` 的 `a` 会被当成
        // 冠词删掉，标签就成了 `< href>`，链接直接断。
        if has_tag(t) {
            flush(&mut out, &mut buf);
            out.push(Chunk::Html(lines[i].to_string()));
            i += 1;
            continue;
        }

        if t.trim().is_empty() {
            flush(&mut out, &mut buf);
            i += 1;
            continue;
        }

        // README 大多是手工折行的：一句话被硬换行切成三行。
        // 要是逐行翻，一句就被掰成三段，主语和宾语各翻各的，读起来是断的。
        // 所以续行并进上一行——markdown 渲染时段落本来就是连着的，
        // 并完只是把源码的换行挪走，观感不变。
        let cont = !buf.is_empty()
            && !starts_structure(t)
            && !buf.last().map(|l| l.trim_end().ends_with("  ")).unwrap_or(false);
        if cont {
            buf.last_mut().unwrap().push(' ');
            buf.last_mut().unwrap().push_str(t.trim_end());
        } else {
            buf.push(lines[i].to_string());
        }
        // 没有空行的长列表也不能攒成一大块
        if buf.iter().map(|l| l.len()).sum::<usize>() > 900 {
            flush(&mut out, &mut buf);
        }
        i += 1;
    }
    flush(&mut out, &mut buf);
    out
}

// ─────────────────────── 图片遮罩 ───────────────────────

fn scan_img(b: &[char], at: usize) -> Option<usize> {
    // at 指向 '!'
    if at + 1 >= b.len() || b[at + 1] != '[' {
        return None;
    }
    let mut i = at + 2;
    while i + 1 < b.len() {
        if b[i] == ']' && b[i + 1] == '(' {
            let mut depth = 0i32;
            let mut j = i + 1;
            while j < b.len() {
                match b[j] {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(j);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            return None;
        }
        i += 1;
    }
    None
}

pub fn mask_images(s: &str) -> (String, Vec<String>) {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut imgs: Vec<String> = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == '!' {
            if let Some(end) = scan_img(&b, i) {
                out.push_str(&format!("⟦{}⟧", imgs.len()));
                imgs.push(b[i..=end].iter().collect());
                i = end + 1;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    (out, imgs)
}

pub fn unmask_images(s: &str, imgs: &[String]) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == '⟦' {
            let mut j = i + 1;
            while j < b.len() && b[j] != '⟧' && j - i <= 8 {
                j += 1;
            }
            if j < b.len() && b[j] == '⟧' {
                let num: String = b[i + 1..j].iter().filter(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = num.parse::<usize>() {
                    if let Some(orig) = imgs.get(n) {
                        out.push_str(orig);
                        i = j + 1;
                        continue;
                    }
                }
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// 并发跑一组任务，保持顺序。翻译是纯网络等待，并发能把手感从
/// 「十几秒」压到「两三秒」，但开太多会被接口限流，所以固定小并发。
pub fn parallel<F>(n: usize, workers: usize, f: F) -> Vec<Option<String>>
where
    F: Fn(usize) -> Option<String> + Sync,
{
    let out: Mutex<Vec<Option<String>>> = Mutex::new(vec![None; n]);
    let next = AtomicUsize::new(0);
    let workers = workers.min(n).max(1);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= n {
                    break;
                }
                if let Some(v) = f(i) {
                    out.lock().unwrap()[i] = Some(v);
                }
            });
        }
    });
    out.into_inner().unwrap()
}


/// 去掉围栏代码块、HTML 标签、URL、markdown 链接目标，
/// 剩下的才是「读者真正要读的正文」。
fn strip_noise(s: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for line in s.lines() {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut depth = 0usize;
        for c in line.chars() {
            match c {
                '<' => depth += 1,
                '>' => depth = depth.saturating_sub(1),
                _ if depth > 0 => {}
                _ => out.push(c),
            }
        }
        out.push('\n');
    }
    // 链接目标 `](...)` 全丢
    let mut clean = String::new();
    let ch: Vec<char> = out.chars().collect();
    let mut i = 0;
    while i < ch.len() {
        if ch[i] == ']' && ch.get(i + 1) == Some(&'(') {
            let mut d = 0i32;
            let mut j = i + 1;
            while j < ch.len() {
                match ch[j] {
                    '(' => d += 1,
                    ')' => {
                        d -= 1;
                        if d == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            i = j + 1;
            continue;
        }
        clean.push(ch[i]);
        i += 1;
    }
    clean
}

/// README 实测：拿真实语料跑一遍，看结构有没有被弄坏。
/// `cargo test -p flow-core md_real -- --ignored --nocapture`
#[test]
#[ignore]
fn md_real() {
    use std::fs;
    let dir = "../build/_md";
    let names = match fs::read_dir(dir) {
        Ok(d) => d
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".md"))
            .collect::<Vec<_>>(),
        Err(e) => {
            println!("没有语料目录 {dir}: {e}");
            return;
        }
    };
    let svc = Service::new(Config {
        engine: "local".into(),
        ..Default::default()
    });
    for n in names {
        let src = fs::read_to_string(format!("{dir}/{n}")).unwrap_or_default();
        if src.len() < 400 {
            continue;
        }
        let t0 = std::time::Instant::now();
        let zh = svc.markdown(&mut Store::open_memory().unwrap(), &src).unwrap_or_default();
        let ms = t0.elapsed().as_millis();

        // 只看正文：代码块和标签属性本来就该是英文，算进去会把比例压得没意义
        let prose = strip_noise(&zh);
        let cjk = prose.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count();
        let latin = prose.chars().filter(|c| c.is_ascii_alphabetic()).count();
        let ratio = cjk as f64 * 100.0 / (cjk + latin).max(1) as f64;

        // 结构体检：代码块、HTML 标签数量必须前后一致
        let fences = |t: &str| t.matches("```").count();
        let tags = |t: &str| {
            let mut n = 0;
            let mut inside = false;
            for c in t.chars() {
                if c == '<' { n += 1; inside = true; }
                else if c == '>' { inside = false; }
                let _ = inside;
            }
            n
        };
        // 标签被拆散的特征：出现 `< p` 或 ` <` 后面跟空格
        let broken = zh.matches("< ").count() + zh.matches(" >").count();

        println!(
            "{n:32} {:>6}字节 → {:>6}字节  {ms:>4}ms  中文 {ratio:>4.0}%  围栏 {}→{}  标签 {}→{}  可疑空格 {}",
            src.len(),
            zh.len(),
            fences(&src),
            fences(&zh),
            tags(&src),
            tags(&zh),
            broken
        );
    }
}

/// 看一眼真实 README 翻出来的头部长什么样。
/// `cargo test -p flow-core md_peek -- --ignored --nocapture`
#[test]
#[ignore]
fn md_peek() {
    let name = std::env::var("MD").unwrap_or_else(|_| "justrach_nanoui".into());
    let src = std::fs::read_to_string(format!("../build/_md/{name}.md")).unwrap_or_default();
    let svc = Service::new(Config { engine: "local".into(), ..Default::default() });
    let zh = svc.markdown(&mut Store::open_memory().unwrap(), &src).unwrap_or_default();
    for line in zh.lines().take(60) {
        println!("{line}");
    }


}

/// 把译文整篇落盘，方便和原文 diff。
/// `MD=sindresorhus_awesome cargo test -p flow-core md_dump -- --ignored --nocapture`
#[test]
#[ignore]
fn md_dump() {
    let name = std::env::var("MD").unwrap_or_else(|_| "justrach_nanoui".into());
    let src = std::fs::read_to_string(format!("../build/_md/{name}.md")).unwrap_or_default();
    let svc = Service::new(Config { engine: "local".into(), ..Default::default() });
    let zh = svc.markdown(&mut Store::open_memory().unwrap(), &src).unwrap_or_default();
    std::fs::write(format!("../build/_md/{name}.zh.md"), zh).unwrap();
}
