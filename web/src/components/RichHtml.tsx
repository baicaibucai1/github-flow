import { useEffect, useRef, type ReactNode } from "react";
import { openInside } from "../lib/bridge";
import { sanitizeHtml } from "../lib/md";

/**
 * 第三方 HTML（README / 文件渲染版 / issue 正文 / PR 评论）的统一出口。
 *
 * 为什么要抽这一层：这三处的 HTML 都不是我们生成的，而"点了没反应"是同一个根因——
 * GitHub 把 README 里的链接留成相对路径（实测 href="README.zh-CN.md"），Tauri 又把
 * target=_blank 吞掉，于是点击既不走系统浏览器也不走应用内预览。逐处补会漏，集中一处补。
 *
 * ⚠️ 链接的三条路（他 2026-10-07 定的口径：能在应用里做的就别甩到系统浏览器）：
 * ① `#锚点` → 在本篇里滚过去（GitHub 渲染的 h1~h6 **不带 id**，得自己按标题文本补 slug）；
 * ② 指向本仓库文件的（相对路径，或补全后的 github.com/{o}/{r}/blob|tree|raw/{ref}/{path}）
 *    → 交给 onPick 在左栏预览，不出应用；
 * ③ 其余 http(s) → 应用内 WebView 窗口（openInside），还是不出应用。
 */

const GH_FILE = (fullName: string) =>
  new RegExp(`^https://github\\.com/${fullName.replace("/", "\\/")}/(?:blob|tree|raw)/[^/]+/(.+)$`, "i");

function dec(p: string) {
  return p
    .split("/")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

/** 按当前文件所在目录解相对路径，处理 ./ 和 ../（GitHub 的 README 链接就是这个规矩） */
export function resolveRelative(basePath: string, href: string): string {
  const target = href.split("#")[0].split("?")[0];
  const segs = (basePath ? basePath.split("/") : []).filter(Boolean);
  for (const part of target.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  return segs.join("/");
}

/** GitHub 的标题锚点：小写、非字母数字变 '-'、空格→'-'，中文原样保留 */
export function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function RichHtml({
  html,
  fullName,
  repoId,
  basePath = "",
  onPick,
  onNotice,
  className = "md px-md py-md",
}: {
  html: string;
  fullName: string;
  repoId: number;
  basePath?: string;
  onPick?: (path: string) => void;
  onNotice: (m: string) => void;
  className?: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // ① 补标题 id：GitHub 的 html+json 渲染出来是 <h2 class="heading-element">，没有 id，
    //    所以 README 的目录链接（href="#用法"）天生落不了地。
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      if (!h.id) h.id = slug(h.textContent ?? "");
    });
    // ② 代码块加一条"这是什么语言"的标注条：GitHub 的类名里有（highlight-source-shell），
    //    纯 ``` 围栏没声明语言时就标"代码"，总之不能让人对着一块等宽文字猜。
    root.querySelectorAll("pre").forEach((pre) => {
      const box: HTMLElement | null = pre.closest("div.highlight, div.snippet-clipboard-content");
      const target = box ?? pre;
      if (target.parentElement?.classList.contains("codebox")) return;
      const fromClass = (box?.className ?? "").match(/highlight-source-([\w.+-]+)/)?.[1] ?? "";
      const lang = pre.getAttribute("lang") || fromClass;
      const wrap = document.createElement("div");
      wrap.className = "codebox";
      const head = document.createElement("div");
      head.className = "codehead";
      head.textContent = lang || "代码";
      target.parentNode?.insertBefore(wrap, target);
      wrap.appendChild(head);
      wrap.appendChild(target);
    });
  }, [html]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      e.preventDefault();
      if (href.startsWith("#")) {
        const frag = href.slice(1);
        let el: HTMLElement | null = null;
        for (const cand of [frag, "user-content-" + frag]) {
          const id = decodeURIComponent(cand);
          el =
            (root.querySelector(`[id="${CSS.escape(id)}"]`) as HTMLElement | null) ??
            (root.querySelector(`[id="${CSS.escape(slug(id))}"]`) as HTMLElement | null);
          if (el) break;
        }
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else onNotice("这一篇里没有「" + decodeURIComponent(frag) + "」这个标题");
        return;
      }
      const m = href.match(GH_FILE(fullName));
      const rel = !/^https?:\/\//i.test(href) && !href.startsWith("/");
      const path = m ? dec(m[1]) : rel ? resolveRelative(basePath, href) : "";
      if (path && onPick) {
        onPick(path);
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        // 站外与图片类链接：应用内开一个窗口，不切走他的浏览器
        openInside(href, repoId).catch((x) => onNotice("打不开这个链接：" + String(x)));
        return;
      }
      onNotice("这个链接应用里打不开：" + href);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [html, fullName, basePath, repoId, onPick, onNotice]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html ? sanitizeHtml(html) : "<i>取不到内容</i>" }}
    />
  );
}
