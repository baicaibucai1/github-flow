/**
 * 第三方 HTML 的兜底清洗。README、issue 正文、PR 正文、评论——四处的 HTML 都不是我们生成的，
 * 全走这一个函数，免得哪天只补了其中一条路径。
 *
 * 真正该做的是 CSP（手册里挂着的那条待办），这里只是"不引脚本、不引 iframe、不让内联事件活"的底线。
 * 外链强制 target=_blank + noreferrer：在 Tauri 里这两个属性其实会被吞掉，链接点击由上层拦截后
 * 交给系统浏览器，这里的属性只是让"万一没拦住"也不至于在同一文档里导航走。
 */
export function sanitizeHtml(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<a /gi, '<a target="_blank" rel="noreferrer" ');
}
