import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@soda/ui"
import { cn } from "cn"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type Metric = {
  label: ReactNode
  value: ReactNode
  delta?: ReactNode
  trend?: "up" | "down" | "flat"
}

export type DashboardPageProps = {
  header?: PageHeaderProps
  metrics?: Metric[]
  /** 主区：ChartCard / TableCard / ActivityCard 按顺序铺满 12 栅 */
  children: ReactNode
  className?: string
}

export function DashboardPage({ header, metrics = [], children, className }: DashboardPageProps) {
  return (
    <div className={cn("flex flex-col gap-md", className)}>
      {header ? <PageHeader {...header} /> : null}
      {metrics.length ? (
        <div className="grid grid-cols-2 gap-sm xl:grid-cols-4 xl:gap-md">
          {metrics.map((metric) => (
            <MetricCard key={String(metric.label)} {...metric} />
          ))}
        </div>
      ) : null}
      <div className="grid gap-md lg:grid-cols-12">{children}</div>
    </div>
  )
}

export function MetricCard({ label, value, delta, trend = "flat" }: Metric) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-2xs py-sm">
        <span className="text-muted-foreground text-label">{label}</span>
        <span className="text-title">{value}</span>
        {delta ? (
          <span
            className={cn(
              "text-caption",
              trend === "up" && "text-ok",
              trend === "down" && "text-destructive",
              trend === "flat" && "text-muted-foreground"
            )}
          >
            {delta}
          </span>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function PanelCard({
  title,
  description,
  action,
  className,
  span = 6,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  span?: 4 | 6 | 8 | 12
  children: ReactNode
}) {
  return (
    <Card
      className={cn(
        "gap-0 py-0",
        span === 4 && "lg:col-span-4",
        span === 6 && "lg:col-span-6",
        span === 8 && "lg:col-span-8",
        span === 12 && "lg:col-span-12",
        className
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-sm border-b py-sm">
        <div className="flex flex-col gap-2xs">
          <CardTitle className="text-lead">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-caption">{description}</CardDescription>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="py-md">{children}</CardContent>
    </Card>
  )
}
