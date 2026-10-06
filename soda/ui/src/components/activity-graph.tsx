import * as React from "react"
import { cn } from "cn"

export type ActivityDay = {
  /** ISO 日期 yyyy-MM-dd */
  date: string
  count: number
}

export type ActivityGraphProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  days: ActivityDay[]
  /** 分级上限；默认取最大值，再四档取整 */
  max?: number
  months?: string[]
  weekPrefix?: string
  showLegend?: boolean
}

const WEEKDAYS = ["", "一", "", "三", "", "五", ""]

/**
 * 活跃度图（GitHub 贡献图那种 7 × N 网格）。官方 registry 没有，Soda 自研。
 *
 * 输入是一维日期序列，分桶按周排布；色阶同样走 color-mix，
 * 所以换主题集/风格包都跟随。单元格带 data-slot=activity-cell。
 */
function ActivityGraph({
  className,
  days,
  max,
  months,
  weekPrefix = "周",
  showLegend = true,
  ...props
}: ActivityGraphProps) {
  const peak = React.useMemo(
    () => max ?? (days.length ? Math.max(...days.map((d) => d.count)) : 1),
    [max, days]
  )

  // 起点对齐到周一：把首日前的空格补掉
  const weeks = React.useMemo(() => {
    if (!days.length) return [] as (ActivityDay | null)[][]
    const first = new Date(`${days[0].date}T00:00:00`)
    const offset = (first.getDay() + 6) % 7
    const cells: (ActivityDay | null)[] = Array.from({ length: offset }, () => null)
    for (const d of days) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    const out: (ActivityDay | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [days])

  const levelOf = (count: number) => {
    if (!count || peak <= 0) return 0
    const ratio = count / peak
    return ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1
  }

  const colorOf = (level: number) =>
    level === 0
      ? "var(--muted)"
      : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--muted))`

  const total = React.useMemo(() => days.reduce((sum, d) => sum + d.count, 0), [days])

  return (
    <div data-slot="activity-graph" className={cn("flex flex-col gap-sm", className)} {...props}>
      {months?.length ? (
        <div className="flex min-w-max gap-xs ps-[3.25rem] text-caption text-muted-foreground">
          {months.map((m) => (
            <span key={m} data-slot="activity-month">
              {m}
            </span>
          ))}
        </div>
      ) : null}

      <div className="w-full overflow-x-auto">
        <div className="flex min-w-max gap-2xs" role="grid" aria-label="活跃度">
          <div className="flex flex-col gap-2xs pe-xs">
            {WEEKDAYS.map((w, i) => (
              <span
                key={i}
                className="flex h-3.5 items-center text-[0.625rem] leading-none text-muted-foreground"
              >
                {w ? `${weekPrefix}${w}` : ""}
              </span>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-2xs" role="row">
              {week.map((day, di) => {
                if (!day) {
                  return <span key={di} className="size-3.5" aria-hidden />
                }
                const level = levelOf(day.count)
                return (
                  <span
                    key={di}
                    role="gridcell"
                    tabIndex={0}
                    data-slot="activity-cell"
                    data-level={level}
                    title={`${day.date}：${day.count}`}
                    aria-label={`${day.date} ${day.count}`}
                    className="size-3.5 rounded-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ backgroundColor: colorOf(level) }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {showLegend ? (
        <div className="flex items-center gap-xs text-caption text-muted-foreground">
          <span className="tabular-nums">共 {total}</span>
          <span className="ms-auto">少</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              data-slot="activity-legend-cell"
              className="size-3.5 rounded-2xs"
              style={{ backgroundColor: colorOf(l) }}
            />
          ))}
          <span>多</span>
        </div>
      ) : null}
    </div>
  )
}

export { ActivityGraph }
