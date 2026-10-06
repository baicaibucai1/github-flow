import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from "@soda/ui"
import { cn } from "cn"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type DetailPageProps = {
  header?: PageHeaderProps
  /** 顶部关键信息条：Badge / Avatar / 状态 */
  summary?: ReactNode
  sections?: { title: ReactNode; description?: ReactNode; content: ReactNode }[]
  children?: ReactNode
  className?: string
}

export function DetailPage({
  header,
  summary,
  sections = [],
  children,
  className,
}: DetailPageProps) {
  return (
    <div className={cn("flex flex-col gap-md", className)}>
      {header ? <PageHeader {...header} /> : null}
      {summary ? (
        <div className="flex flex-wrap items-center gap-sm text-muted-foreground text-body">
          {summary}
        </div>
      ) : null}
      <div className="grid gap-lg lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-lg">
          {sections.map((section) => (
            <section key={String(section.title)} className="flex flex-col gap-sm">
              <div className="flex flex-col gap-2xs">
                <h2 className="text-heading">{section.title}</h2>
                {section.description ? (
                  <p className="text-muted-foreground text-caption">{section.description}</p>
                ) : null}
              </div>
              <Separator />
              <div className="text-body">{section.content}</div>
            </section>
          ))}
          {children}
        </div>
        <aside className="flex flex-col gap-md">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-sm">
              <CardTitle className="text-lead">属性</CardTitle>
              <CardDescription className="text-caption">元数据面板</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-sm py-md">
              <dl className="grid grid-cols-[auto_1fr] gap-xs text-label">
                <dt className="text-muted-foreground">状态</dt>
                <dd className="text-right">—</dd>
                <dt className="text-muted-foreground">更新</dt>
                <dd className="text-right">—</dd>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
