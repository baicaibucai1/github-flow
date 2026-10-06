// 候选 B：直接用 GitHub 官方的 @primer/react（38.40.1，peer 支持 React 19）。
// 同一份真数据：probe/profile.json
//
// 这一行是踩出来的：v38 的组件样式是逐组件静态 CSS，但**主题变量不在包里**，
// 必须自己引 @primer/primitives 的 token（官方 README 也是这么写的）。
// 不引的后果是组件照样渲染、但全是浏览器默认样式，看起来像没接上。
import "@primer/primitives/dist/css/primitives.css";
import { createRoot } from "react-dom/client";
import { Avatar, BaseStyles, Button, Heading, Label, Link, Stack, Text, ThemeProvider } from "@primer/react";
import d from "./profile.json";

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
const LVL = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];

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

const box: React.CSSProperties = {
  background: "var(--bgColor-default, #fff)",
  border: "1px solid var(--borderColor-default, #d0d7da)",
  borderRadius: 6,
};
const rowHead: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--borderColor-default, #d0d7da)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
const row: React.CSSProperties = { padding: 16, borderTop: "1px solid var(--borderColor-default,#d0d7da)" };

export default function B() {
  return (
    <ThemeProvider colorScheme="light" noDefaultStyles={false}>
      <BaseStyles>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "296px minmax(0,1fr)",
              gap: 24,
              alignItems: "start",
            }}
          >
            <div>
              <Avatar src={d.avatar ?? ""} alt={d.login} size={260} sx={{ borderRadius: 2 }} />
              <Heading as="h1" style={{ fontSize: 24, fontWeight: 600, marginTop: 12 }}>
                {d.name}
              </Heading>
              <Text as="p" sx={{ color: "fg.muted", fontSize: 3, mt: 1, fontWeight: "light" }}>
                {d.login}
              </Text>
              <Text as="p" sx={{ display: "block", mt: 2 }}>
                {d.bio}
              </Text>
              <Link href={d.url ?? "#"} sx={{ display: "block", mt: 3 }}>
                <Button sx={{ width: "100%" }}>在 GitHub 打开</Button>
              </Link>
              <Text as="p" sx={{ display: "block", mt: 3, color: "fg.muted" }}>
                📍 {d.location}
              </Text>
              <Text as="p" sx={{ display: "block", color: "fg.muted" }}>
                🕒 {d.created_at?.slice(0, 10)} 加入
              </Text>
              <Text as="p" sx={{ display: "block", mt: 3, color: "fg.muted" }}>
                <strong style={{ color: "var(--fgColor-default,#1f2328)" }}>{d.following}</strong> following ·{" "}
                <strong style={{ color: "var(--fgColor-default,#1f2328)" }}>{d.followers}</strong> followers
              </Text>
            </div>

            <Stack gap={3} sx={{ minWidth: 0 }}>
              <div style={box}>
                <div style={rowHead}>
                  <Heading as="h2" sx={{ fontSize: 1, fontWeight: "semibold" }}>
                    Popular repositories
                  </Heading>
                  <Text sx={{ color: "fg.muted", fontSize: 0 }}>{d.repo_count} 个非 fork 仓库</Text>
                </div>
                <div style={{ borderTop: 0 }}>
                  {d.popular.map((r, i) => (
                    <div key={r.full_name} style={{ ...row, borderTop: i ? row.borderTop : 0 }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                        <Link href={r.url} style={{ fontWeight: 600, fontSize: 16 }}>
                          {r.name}
                        </Link>
                        <Label>Public</Label>
                      </div>
                      <Text as="p" sx={{ display: "block", color: "fg.muted", my: 1 }}>
                        {r.description}
                      </Text>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--fgColor-muted,#59636e)" }}>
                        {r.language ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: LANG_COLOR[r.language] ?? "#8b949e",
                              }}
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
              </div>

              <div style={box}>
                <div style={rowHead}>
                  <Heading as="h2" sx={{ fontSize: 1, fontWeight: "semibold" }}>
                    Contribution activity
                  </Heading>
                  <Text sx={{ color: "fg.muted", fontSize: 0 }}>
                    {d.event_count} contributions in the last 90 days
                  </Text>
                </div>
                <div style={{ display: "flex", gap: 3, padding: 16, overflowX: "auto" }}>
                  {weeks.map((w, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateRows: "repeat(7,10px)", gap: 3 }}>
                      {w.map((day, j) => (
                        <span
                          key={j}
                          title={day || ""}
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 2,
                            background:
                              day === null
                                ? "transparent"
                                : LVL[levelOf(d.activity.find((a) => a.date === day)?.count ?? 0)],
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <Text as="p" sx={{ display: "block", px: 2, pb: 2, fontSize: 0, color: "fg.muted" }}>
                  口径说明：数据来自 REST 的 events/public（近 90 天、最多 300 条公开事件），与
                  GitHub 页面上那个 contributions 数不是同一个统计（那个走 GraphQL、含私有仓库）。
                </Text>
              </div>
            </Stack>
          </div>
        </div>
      </BaseStyles>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<B />);
