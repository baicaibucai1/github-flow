import * as React from "react"
import { cn } from "cn"

export type HeatmapColumn = {
  key: string
  label: React.ReactNode
}

export type HeatmapRow = {
  label: React.ReactNode
  cells: Record<string, number | null | undefined>
}

export type HeatmapProps = Omit<React.ComponentProps<"div">, "onChange"> & {
  columns: HeatmapColumn[]
  rows: HeatmapRow[]
  /** 值域上限；默认取数据里的最大值 */
  max?: number
  /** 单元格点击；用于下钻 */
  onCellClick?: (rowIndex: number, columnKey: string, value: number) => void
  /** 单元格悬浮与 aria 文案 */
  formatValue?: (value: number, rowLabel: React.ReactNode, colLabel: React.ReactNode) => string
  /** 色相：从 muted 到 primary 的插值步数 */
  steps?: number
  showLegend?: boolean
  density?: "default" | "compact"
}

/**
 * 矩阵热力图。官方 registry 没有这一档，所以是 Soda 自研组件。
 *
 * 约束（为了将来能被风格包覆盖、被 Pattern 复用）：
 * - 只用语义 token，颜色通过 color-mix 在 --primary 与 --muted 之间插值，
 *   因此换主题集/换风格包都自动跟随；
 * - 根节点与单元格都带 data-slot，覆盖层按 [data-slot=heatmap-cell] 定位。
 */
function Heatmap({
  className,
  columns,
  rows,
  max,
  onCellClick,
  formatValue,
  steps = 5,
  showLegend = true,
  density = "default",
  ...props
}: HeatmapProps) {
  const peak = React.useMemo(() => {
    if (max != null) return max
    const all = rows.flatMap((r) => columns.map((c) => r.cells[c.key] ?? 0))
    return all.length ? Math.max(...all) : 1
  }, [max, rows, columns])

  const levelOf = (value: number) => {
    if (!value || peak <= 0) return 0
    return Math.min(steps, Math.max(1, Math.ceil((value / peak) * steps)))
  }

  const colorOf = (level: number) =>
    level === 0
      ? "var(--muted)"
      : `color-mix(in oklch, var(--primary) ${Math.round((level / steps) * 100)}%, var(--muted))`

  return (
    <div
      data-slot="heatmap"
      data-density={density}
      className={cn("flex flex-col gap-sm", className)}
      {...props}
    >
      <div className="w-full overflow-x-auto">
        <div
          role="grid"
          aria-label="热力图"
          className="grid min-w-max gap-2xs"
          style={{
            gridTemplateColumns: `minmax(5rem,auto) repeat(${columns.length}, minmax(2.25rem,1fr))`,
          }}
        >
          <div role="columnheader" className="px-xs text-caption text-muted-foreground" />
          {columns.map((col) => (
            <div
              key={col.key}
              role="columnheader"
              className="px-xs text-center text-caption text-muted-foreground"
            >
              {col.label}
            </div>
          ))}

          {rows.map((row, rowIndex) => (
            <React.Fragment key={rowIndex}>
              <div
                role="rowheader"
                className="flex items-center truncate px-xs text-label"
                title={String(row.label)}
              >
                {row.label}
              </div>
              {columns.map((col) => {
                const value = row.cells[col.key] ?? 0
                const level = levelOf(value)
                const label = formatValue
                  ? formatValue(value, row.label, col.label)
                  : `${row.label} · ${col.label}：${value}`
                return (
                  <button
                    key={col.key}
                    type="button"
                    role="gridcell"
                    aria-label={label}
                    title={label}
                    data-slot="heatmap-cell"
                    data-level={level}
                    onClick={onCellClick ? () => onCellClick(rowIndex, col.key, value) : undefined}
                    className={cn(
                      "rounded-md border border-input/60 outline-none transition-colors",
                      "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                      onCellClick ? "cursor-pointer hover:brightness-95" : "cursor-default",
                      density === "compact" ? "h-5" : "h-8"
                    )}
                    style={{ backgroundColor: colorOf(level) }}
                  />
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {showLegend ? (
        <div className="flex items-center gap-xs text-caption text-muted-foreground">
          <span>低</span>
          {Array.from({ length: steps + 1 }).map((_, i) => (
            <span
              key={i}
              data-slot="heatmap-legend-cell"
              className="size-4 rounded-md border border-input/60"
              style={{ backgroundColor: colorOf(i) }}
            />
          ))}
          <span>高</span>
          <span className="ms-auto tabular-nums">峰值 {peak}</span>
        </div>
      ) : null}
    </div>
  )
}

export { Heatmap }
