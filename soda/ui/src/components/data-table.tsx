import * as React from "react"
import { cn } from "cn"
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { Badge } from "./badge"
import { Button } from "./button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty"
import { Input } from "./input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table"

export type DataTableColumn<T> = {
  key: string
  header: React.ReactNode
  /** 渲染单元格；默认取 row[key] */
  cell?: (row: T) => React.ReactNode
  /** 排序与搜索用的原始值 */
  value?: (row: T) => string | number | null | undefined
  sortable?: boolean
  className?: string
  headClassName?: string
  align?: "start" | "end" | "center"
  /** 窄屏隐藏优先级：mobile 表示 <sm 就收起来 */
  hide?: "mobile" | "md"
}

export type DataTableProps<T> = Omit<React.ComponentProps<"div">, "onChange"> & {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  searchable?: boolean
  searchPlaceholder?: string
  pageSize?: number
  emptyTitle?: React.ReactNode
  emptyDescription?: React.ReactNode
  onRowClick?: (row: T) => void
}

const rawOf = <T,>(row: T, col: DataTableColumn<T>) =>
  col.value ? col.value(row) : (row as Record<string, unknown>)[col.key]

/**
 * 表格 + 搜索 + 排序 + 分页的组合件。官方只有 Table（纯视觉），
 * 这一档 AI 每次都自己拼一遍且每次拼错，所以收进 @soda/ui。
 */
function DataTable<T>({
  className,
  columns,
  rows,
  rowKey,
  searchable = true,
  searchPlaceholder = "搜索…",
  pageSize = 8,
  emptyTitle = "没有匹配结果",
  emptyDescription = "换个关键词，或清空搜索。",
  onRowClick,
  ...props
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("")
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(null)
  const [page, setPage] = React.useState(0)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      columns.some((col) => String(rawOf(row, col) ?? "").toLowerCase().includes(q))
    )
  }, [rows, query, columns])

  const sorted = React.useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return filtered
    const dir = sort.dir === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = rawOf(a, col)
      const bv = rawOf(b, col)
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir
    })
  }, [filtered, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize)

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortable) return
    setSort((prev) =>
      prev?.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: "asc" }
    )
  }

  return (
    <div data-slot="data-table" className={cn("flex flex-col gap-0", className)} {...props}>
      {searchable ? (
        <div className="flex flex-wrap items-center gap-xs border-b px-md py-sm">
          <div className="relative w-full max-w-60">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder={searchPlaceholder}
              className="ps-8"
              aria-label={searchPlaceholder}
            />
          </div>
          <span className="ms-auto text-caption text-muted-foreground tabular-nums">
            {sorted.length} / {rows.length}
          </span>
        </div>
      ) : null}

      <div className="min-w-0 overflow-x-auto">
        <Table data-slot="data-table-table">
          <TableHeader>
            <TableRow className="border-0">
              {columns.map((col) => {
                const active = sort?.key === col.key
                return (
                  <TableHead
                    key={col.key}
                    className={cn(
                      col.hide === "mobile" && "hidden sm:table-cell",
                      col.hide === "md" && "hidden md:table-cell",
                      col.align === "end" && "text-end",
                      col.align === "center" && "text-center",
                      col.headClassName
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        data-slot="data-table-sort"
                        aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                        className="inline-flex items-center gap-2xs rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {col.header}
                        {active ? (
                          sort?.dir === "asc" ? (
                            <ArrowUpIcon className="size-3.5" />
                          ) : (
                            <ArrowDownIcon className="size-3.5" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={rowKey(row)}
                data-slot="data-table-row"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer")}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(
                      col.hide === "mobile" && "hidden sm:table-cell",
                      col.hide === "md" && "hidden md:table-cell",
                      col.align === "end" && "text-end",
                      col.align === "center" && "text-center",
                      col.className
                    )}
                  >
                    {col.cell
                      ? col.cell(row)
                      : String(rawOf(row, col) ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!visible.length ? (
        <Empty className="border-0 py-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-xs border-t px-md py-sm">
        <span className="text-caption text-muted-foreground tabular-nums">
          第 {current + 1} / {pageCount} 页
        </span>
        <div className="flex items-center gap-xs">
          <Button
            size="xs"
            variant="outline"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </Button>
          <Badge variant="outline" className="tabular-nums">
            {sorted.length}
          </Badge>
          <Button
            size="xs"
            variant="outline"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}

export { DataTable }
