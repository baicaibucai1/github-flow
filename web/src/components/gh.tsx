import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge, Button } from "@soda/ui";

/**
 * GitHub 版式的公共词汇：一个带表头的盒子（Box）、盒子里的一行（BoxRow）、
 * 左侧导航（SideNav）、贡献格（Calendar）、语言点（LangDot）。
 *
 * 为什么自己拼而不用 @soda/patterns 的骨架：那些骨架定的是"顶部标签 + 12 栏面板"
 * 那套 dashboard 摆法，而这轮的目标是 GitHub 的连续流。组件箱（Card/Button/Badge…）
 * 照用，页面骨架换成这里这一层。
 */

export function Box({
  title,
  aside,
  children,
  footer,
  className,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-md border bg-card", className)}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-xs border-b bg-secondary px-md py-sm">
          <h2 className="text-label">{title}</h2>
          {aside ? <div className="flex items-center gap-xs text-caption text-muted-foreground">{aside}</div> : null}
        </header>
      ) : null}
      <div>{children}</div>
      {footer ? <div className="border-t">{footer}</div> : null}
    </section>
  );
}

/** Box 里的一行：自带分隔线，第一行不加。 */
export function BoxRow({
  children,
  className,
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className={cn("px-md py-md [&:not(:first-child)]:border-t", className)}
    >
      {children}
    </div>
  );
}

export function BoxEmpty({ children }: { children: ReactNode }) {
  return <div className="px-md py-2xl text-center text-body text-muted-foreground">{children}</div>;
}

/** 左侧导航（设置页用）：一个 Box 里的一列链接，选中项加粗 + 左描边。 */
export function SideNav({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <nav className="overflow-hidden rounded-md border bg-card">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex w-full items-center gap-xs px-md py-sm text-left text-label hover:bg-secondary",
              on && "border-l-2 border-primary bg-secondary font-semibold"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Rust: "#dea584",
  Go: "#00add8",
  Python: "#3572a5",
  Shell: "#89e051",
  HTML: "#e34c26",
  C: "#555555",
  "C++": "#f34b7d",
  Java: "#b07219",
};

export function LangDot({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2xs text-caption text-muted-foreground">
      <span className="gh-dot" style={{ background: LANG_COLOR[name] ?? "#8b949e" }} />
      {name}
    </span>
  );
}

/** 把离散的"日期→次数"排成 GitHub 那种 7×N 格子；起点补到周一。 */
export function buildWeeks(days: { date: string; count: number }[]) {
  if (!days.length) return [];
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const first = new Date(days[0].date + "T00:00:00");
  const last = new Date(days[days.length - 1].date + "T00:00:00");
  const offset = (first.getDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let t = first.getTime(); t <= last.getTime(); t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    cells.push(byDate.has(iso) ? iso : "");
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function Calendar({ days }: { days: { date: string; count: number }[] }) {
  const weeks = buildWeeks(days);
  const peak = Math.max(1, ...days.map((d) => d.count));
  const level = (c: number) => (c === 0 ? 0 : c / peak > 0.75 ? 4 : c / peak > 0.5 ? 3 : c / peak > 0.25 ? 2 : 1);
  if (!weeks.length) return <p className="text-caption text-muted-foreground">这段时间没有公开活动。</p>;
  return (
    <div className="flex flex-col gap-xs">
      <div className="gh-calendar">
        {weeks.map((w, i) => (
          <div className="gh-week" key={i}>
            {w.map((day, j) => (
              <span
                key={j}
                className={cn("gh-cell", day === null && "gh-none")}
                data-l={day ? level(days.find((a) => a.date === day)?.count ?? 0) : 0}
                title={day || undefined}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2xs text-caption text-muted-foreground">
        少
        {[0, 1, 2, 3, 4].map((l) => (
          <span className="gh-cell" key={l} data-l={l} />
        ))}
        多
      </div>
    </div>
  );
}

/** GitHub 仓库页那条下划线导航：选中项加粗 + 主题色下划线，计数放在胶囊里。 */
export function UnderlineNav({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: ReactNode; count?: number | null }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-sm border-b">
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              "-mb-px flex items-center gap-2xs border-b-2 px-sm py-sm text-label hover:underline",
              on ? "border-primary font-semibold" : "border-transparent text-muted-foreground"
            )}
          >
            {it.label}
            {it.count != null ? (
              <Badge variant="secondary" className="rounded-full tabular-nums">
                {it.count.toLocaleString()}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/** GitHub 的"显示更多"是整宽的一行按钮，不是浮在中间的小胶囊。 */
export function MoreRow({ onClick, label, busy }: { onClick: () => void; label: string; busy?: boolean }) {
  return (
    <Button variant="ghost" className="h-9 w-full rounded-none text-label" disabled={busy} onClick={onClick}>
      {label}
    </Button>
  );
}

export function isoDay(iso?: string | null) {
  return iso ? String(iso).slice(0, 10) : "—";
}
