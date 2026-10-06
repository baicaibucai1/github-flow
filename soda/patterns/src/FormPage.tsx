import type { ReactNode } from "react"
import { Card, CardContent } from "@soda/ui"
import { cn } from "cn"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type FormPageProps = {
  header?: PageHeaderProps
  /** FieldGroup 列表，业务侧提供 */
  children: ReactNode
  /** 底部动作区；窄屏自动全宽堆叠 */
  actions?: ReactNode
  className?: string
}

export function FormPage({ header, children, actions, className }: FormPageProps) {
  return (
    <div className={cn("flex flex-col gap-md", className)}>
      {header ? <PageHeader {...header} /> : null}
      <Card className={cn("max-w-2xl gap-0 py-0", className)}>
        <CardContent className="flex flex-col gap-lg py-lg">{children}</CardContent>
        {actions ? (
          <div className="flex flex-col-reverse gap-xs border-t px-lg py-md sm:flex-row sm:justify-end sm:gap-sm">
            {actions}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
