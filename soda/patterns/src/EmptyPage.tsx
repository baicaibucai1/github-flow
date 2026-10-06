import type { ReactNode } from "react"
import { cn } from "cn"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@soda/ui"

export type SodaEmptyProps = {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  className?: string
}

/** 空/错误/无权限三态的统一表达，避免每个页面自造“暂无数据”。 */
export function EmptyPage({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: SodaEmptyProps) {
  return (
    <Empty className={cn("border py-2xl", className)}>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action || secondaryAction ? (
        <EmptyContent className="flex-row justify-center gap-xs">
          {action}
          {secondaryAction}
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
