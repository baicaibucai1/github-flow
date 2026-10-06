// 候选 C：手写 GitHub 复刻（无组件库）。同一份真数据：probe/profile.json
import { createRoot } from "react-dom/client";
import d from "./profile.json";
import "./c.css";

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Rust: "#dea584",
  Go: "#00add8",
  Python: "#3572a5",
  Shell: "#89e051",
};

const maxCount = Math.max(1, ...d.activity.map((a) => a.count));
const levelOf = (c: number) =>
  c === 0 ? 0 : c / maxCount > 0.75 ? 4 : c / maxCount > 0.5 ? 3 : c / maxCount > 0.25 ? 2 : 1;

// 按 GitHub 的排法：列是周、行是周一到周日；起点补到周一
function buildWeeks() {
  const byDate = new Map(d.activity.map((a) => [a.date, a.count]));
  if (!d.activity.length) return { weeks: [] as (string | null)[][], span: 0 };
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
  return { weeks, span: d.activity.length };
}

const { weeks } = buildWeeks();

export default function C() {
  return (
    <>
      <div className="Header">
        <span className="Header-link">baicaibucai1</span>
        <span style={{ color: "#7d8590" }}> / 我的（候选 C：手写复刻 Primer）</span>
      </div>

      <div className="page">
        <div className="layout">
          <div>
            <img className="Avatar" src={d.avatar ?? ""} alt={d.login} />
            <h1 className="h1">{d.name}</h1>
            <p className="login">{d.login}</p>
            <p className="bio">{d.bio}</p>

            <a className="btn" href={d.url ?? "#"} target="_blank" rel="noreferrer">
              在 GitHub 打开
            </a>

            <div className="user-stat">
              <span>📍</span>
              <span>{d.location}</span>
            </div>
            <div className="user-stat">
              <span>🕒</span>
              <span>{d.created_at?.slice(0, 10)} 加入</span>
            </div>
            <div className="follow">
              <span>
                <strong>{d.following}</strong> following
              </span>
              ·
              <span>
                <strong>{d.followers}</strong> followers
              </span>
            </div>
          </div>

          <div>
            <h2 className="section-title" style={{ marginTop: 0 }}>
              Popular repositories
            </h2>
            <div className="Box">
              {d.popular.map((r) => (
                <div className="Box-row" key={r.full_name}>
                  <div className="repo-head">
                    <a className="repo-name" href={r.url} target="_blank" rel="noreferrer">
                      {r.name}
                    </a>
                    <span className="Label">Public</span>
                  </div>
                  <p className="repo-desc">{r.description}</p>
                  <div className="repo-meta">
                    {r.language ? (
                      <span className="lang">
                        <span
                          className="dot"
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
            </div>

            <h2 className="section-title">Contribution activity</h2>
            <div className="Box">
              <div className="Box-header">
                <h3 className="Box-title">{d.event_count} contributions in the last 90 days</h3>
                <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>
                  Learn how we count contributions
                </span>
              </div>
              <div className="calendar">
                {weeks.map((w, i) => (
                  <div className="week" key={i}>
                    {w.map((day, j) =>
                      day === null ? (
                        <span className="cell empty" key={j} />
                      ) : (
                        <span
                          className="cell"
                          key={j}
                          data-l={levelOf(d.activity.find((a) => a.date === day)?.count ?? 0)}
                          title={day || ""}
                        />
                      )
                    )}
                  </div>
                ))}
              </div>
              <div className="legend">
                <span>Less</span>
                {[0, 1, 2, 3, 4].map((l) => (
                  <span className="cell" key={l} data-l={l} />
                ))}
                <span>More</span>
              </div>
              <div className="note">
                口径说明：这里的数据来自 REST 的 events/public（近 90 天、最多 300 条公开事件），
                与 GitHub 页面上那个 contributions 数不是同一个统计（那个走 GraphQL、含私有仓库）。
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<C />);
