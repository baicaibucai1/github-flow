import type { ReactNode } from "react"
import { cn } from "cn"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ScrollArea,
  Separator,
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@soda/ui"

export type FileManagerPageProps = {
  /** SidebarContent：位置 / 收藏 / 标签 */
  nav: ReactNode
  /** 搜索 + 视图切换 + 主操作 */
  toolbar: ReactNode
  breadcrumb: ReactNode
  /** FileList：Table 或网格 */
  children: ReactNode
  /** 右属性栏；< xl 不渲染，改由 Sheet 承载 */
  details?: ReactNode
  className?: string
}

/**
 * 文件管理器型三栏工作台。8 个 Pattern 里官方 registry 没有现成件的一档，
 * 所以价值最高：AI 只填三块内容，不决定三栏怎么分配。
 *
 * 注意 SidebarProvider/Sidebar 的上下文由本 Pattern 自带——
 * 业务侧只传 SidebarContent，自己包会炸（脱离 provider 时 SidebarMenuButton 抛错）。
 */
export function FileManagerPage({
  nav,
  toolbar,
  breadcrumb,
  children,
  details,
  className,
}: FileManagerPageProps) {
  return (
    <SidebarProvider className={cn("min-h-0 gap-0", className)}>
      <Sidebar collapsible="icon" className="hidden lg:flex">
        {nav}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            "grid min-h-0 flex-1",
            details ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : ""
          )}
        >
          <main className="flex min-h-0 min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-xs border-b px-md py-xs">{toolbar}</div>
            <div className="flex items-center gap-xs border-b px-md py-xs text-caption">
              {breadcrumb}
            </div>
            <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
          </main>

          {details ? (
            <aside className="hidden min-h-0 border-l xl:block">
              <Card className="h-full gap-0 rounded-none border-0 py-0 shadow-none">
                <CardHeader className="border-b py-sm">
                  <CardTitle className="text-lead">详细信息</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-sm py-md">
                  <Separator />
                  {details}
                </CardContent>
              </Card>
            </aside>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
