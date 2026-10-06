import type { ReactNode } from "react"
import { ChevronLeftIcon } from "lucide-react"
import { Button } from "@soda/ui"
import { cn } from "cn"

export type PageHeaderProps = {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  onBack?: () => void
  backLabel?: string
  className?: string
}

/** 每个 Pattern 的头部：标题 + 说明 + 右侧动作区。窄屏自动堆叠。 */
export function PageHeader({
  title,
  description,
  actions,
  onBack,
  backLabel = "返回",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-xs border-b py-lg sm:flex-row sm:items-center sm:justify-between sm:gap-md",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-2xs">
        {onBack ? (
          <Button
            variant="ghost"
            size="xs"
            className="-ms-2 self-start text-muted-foreground"
            onClick={onBack}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            {backLabel}
          </Button>
        ) : null}
        <h1 className="truncate text-title">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-body">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-xs">{actions}</div>
      ) : null}
    </header>
  )
}
