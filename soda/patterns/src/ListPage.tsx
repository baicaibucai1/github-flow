import type { ReactNode } from "react"
import { Card, CardContent, ScrollArea } from "@soda/ui"
import { cn } from "cn"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type ListPageProps = {
  header?: PageHeaderProps
  /** 搜索 / 筛选 / 主操作，按此顺序左对齐 */
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
  empty?: ReactNode
  className?: string
}

export function ListPage({
  header,
  toolbar,
  children,
  footer,
  empty,
  className,
}: ListPageProps) {
  return (
    <div className={cn("flex flex-col gap-md", className)}>
      {header ? <PageHeader {...header} /> : null}
      <Card className="gap-0 overflow-hidden py-0">
        {toolbar ? (
          <div className="flex flex-wrap items-center gap-xs border-b px-md py-sm">
            {toolbar}
          </div>
        ) : null}
        <CardContent className="p-0">
          <ScrollArea className="h-[min(60vh,520px)]">
            {children}
            {empty}
          </ScrollArea>
        </CardContent>
        {footer ? (
          <div className="flex flex-wrap items-center justify-between gap-xs border-t px-md py-sm">
            {footer}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
