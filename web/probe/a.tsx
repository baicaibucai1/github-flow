// 候选 A：Soda 组件箱 + github 风格包 + 按 GitHub 的密度与连续流重排。
// 同一份真数据：probe/profile.json
import { createRoot } from "react-dom/client";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Card, CardContent, Separator } from "@soda/ui";
import d from "./profile.json";
import "./a.css";

document.documentElement.dataset.style = "github";
document.documentElement.dataset.set = "github";

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Rust: "#dea584",
  Go: "#00add8",
  Python: "#3572a5",
};

const maxCount = Math.max(1, ...d.activity.map((a) => a.count));
const levelOf = (c: number) =>
  c === 0 ? 0 : c / maxCount > 0.75 ? 4 : c / maxCount > 0.5 ? 3 : c / maxCount > 0.25 ? 2 : 1;

function buildWeeks() {
  const byDate = new Map(d.activity.map((a) => [a.date, a.count]));
  if (!d.activity.length) return [];
  const first = new Date(d.activity[0].date + "T00:00:00");
  const last = new Date(d.activity[d.activity.length - 1].date + "T00:00:00");
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

const weeks = buildWeeks();

export default function A() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b bg-card px-6 py-3 text-label">
        <b>{d.login}</b>
        <span className="text-muted-foreground"> / 我的（候选 A：Soda + github 风格包）</span>
      </div>

      <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-6 p-6 lg:grid-cols-[296px_minmax(0,1fr)]">
        {/* 左列：GitHub 的侧栏没有盒子，就是页面底上的连续内容 */}
        <div className="flex flex-col gap-2xs">
          <Avatar className="aspect-auto h-auto w-full rounded-md">
            <AvatarImage src={d.avatar ?? ""} alt={d.login} />
            <AvatarFallback>{d.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <h1 className="mt-md text-title">{d.name}</h1>
          <p className="text-muted-foreground text-lead">{d.login}</p>
          <p className="mt-xs text-body">{d.bio}</p>
          <Button className="mt-md w-full" onClick={() => window.open(d.url ?? "", "_blank")}>
            在 GitHub 打开
          </Button>
          <p className="mt-md text-muted-foreground text-body">📍 {d.location}</p>
          <p className="text-muted-foreground text-body">🕒 {d.created_at?.slice(0, 10)} 加入</p>
          <p className="mt-md text-muted-foreground text-body">
            <b className="text-foreground">{d.following}</b> following ·{" "}
            <b className="text-foreground">{d.followers}</b> followers
          </p>
        </div>

        {/* 右列：一块一块的连续流，不是并排的浮块面板 */}
        <div className="flex min-w-0 flex-col gap-lg">
          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center justify-between border-b px-md py-sm">
              <h2 className="text-lead">Popular repositories</h2>
              <span className="text-muted-foreground text-caption">{d.repo_count} 个非 fork 仓库</span>
            </div>
            <CardContent className="p-0">
              {d.popular.map((r) => (
                <div key={r.full_name} className="flex flex-col gap-2xs px-md py-md [&:not(:first-child)]:border-t">
                  <div className="flex flex-wrap items-center gap-sm">
                    <a
                      className="text-lead font-semibold text-primary underline-offset-4 hover:underline"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.name}
                    </a>
                    <Badge>Public</Badge>
                  </div>
                  <p className="text-muted-foreground text-body">{r.description}</p>
                  <div className="flex flex-wrap items-center gap-md text-muted-foreground text-caption">
                    {r.language ? (
                      <span className="flex items-center gap-2xs">
                        <span
                          className="gh-dot"
                          style={{ background: LANG_COLOR[r.language] ?? "#8b949e" }}
                        />
                        {r.language}
                      </span>
                    ) : null}
                    <span>★ {r.stars}</span>
                    <span>⑂ {r.forks}</span>
                    <span>更新于 {r.pushed_at.slice(0, 10)}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center justify-between border-b px-md py-sm">
              <h2 className="text-lead">Contribution activity</h2>
              <span className="text-muted-foreground text-caption">
                {d.event_count} contributions in the last 90 days
              </span>
            </div>
            <CardContent className="flex flex-col gap-sm px-md py-md">
              <div className="gh-calendar">
                {weeks.map((w, i) => (
                  <div className="gh-week" key={i}>
                    {w.map((day, j) =>
                      day === null ? (
                        <span className="gh-cell gh-empty" key={j} />
                      ) : (
                        <span
                          className="gh-cell"
                          key={j}
                          data-l={levelOf(d.activity.find((a) => a.date === day)?.count ?? 0)}
                          title={day || ""}
                        />
                      )
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-2xs text-caption text-muted-foreground">
                Less
                {[0, 1, 2, 3, 4].map((l) => (
                  <span className="gh-cell" key={l} data-l={l} />
                ))}
                More
              </div>
              <Separator />
              <p className="text-caption text-muted-foreground">
                口径说明：数据来自 REST 的 events/public（近 90 天、最多 300 条公开事件），
                与 GitHub 页面上那个 contributions 数不是同一个统计（那个走 GraphQL、含私有仓库）。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<A />);
