import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, Tabs, TabsList, TabsTrigger } from "@soda/ui"
import { cn } from "cn"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type SettingsNavItem = { value: string; label: ReactNode }

export type SettingsPageProps = {
  header?: PageHeaderProps
  nav: SettingsNavItem[]
  value?: string
  onValueChange?: (value: string) => void
  children: ReactNode
  className?: string
}

/**
 * 设置页：宽屏左导航右内容，窄屏导航降为横向 Tab 列表。
 * 布局决策在这里定死，AI 只负责填 SettingsSection。
 */
export function SettingsPage({
  header,
  nav,
  value,
  onValueChange,
  children,
  className,
}: SettingsPageProps) {
  return (
    <div className={cn("flex flex-col gap-md", className)}>
      {header ? <PageHeader {...header} /> : null}
      <Tabs value={value} onValueChange={onValueChange} className="gap-md">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          {nav.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex flex-col gap-lg">{children}</div>
      </Tabs>
    </div>
  )
}

export type SettingsSectionProps = {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  value?: string
  className?: string
}

export function SettingsSection({
  title,
  description,
  children,
  value,
  className,
}: SettingsSectionProps) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-md border-b py-sm">
        <div className="flex flex-col gap-2xs">
          <CardTitle className="text-lead">{title}</CardTitle>
          {description ? (
            <CardDescription className="text-caption">{description}</CardDescription>
          ) : null}
        </div>
        {value ? <span className="text-muted-foreground text-label">{value}</span> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-md py-md">{children}</CardContent>
    </Card>
  )
}

export function SettingsRow({
  label,
  description,
  control,
}: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
}) {
  return (
    <>
      <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between sm:gap-lg">
        <div className="flex min-w-0 flex-col gap-2xs">
          <span className="text-label">{label}</span>
          {description ? (
            <span className="text-muted-foreground text-caption">{description}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-xs">{control}</div>
      </div>
      <Separator />
    </>
  )
}
