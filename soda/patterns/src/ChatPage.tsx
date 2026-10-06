import type { ReactNode } from "react"
import { cn } from "cn"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@soda/ui"
import { PageHeader, type PageHeaderProps } from "./PageHeader"

export type ChatPageProps = {
  header?: PageHeaderProps
  /** <Message> 列表，业务侧提供 */
  children: ReactNode
  /** 输入区：Composer / InputGroup / AttachmentGroup */
  composer: ReactNode
  className?: string
}

/**
 * 聊天页：滚动区与输入区的关系在这里定死——
 * 列表独立滚动、输入区常驻底部、窄屏不跟随内容高度。
 */
export function ChatPage({ header, children, composer, className }: ChatPageProps) {
  return (
    <MessageScrollerProvider>
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        {header ? <PageHeader {...header} /> : null}
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="py-md">
            <MessageScrollerContent className="gap-md">{children}</MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
        <div className="sticky bottom-0 border-t bg-background px-md py-sm safe-area-bottom">
          {composer}
        </div>
      </div>
    </MessageScrollerProvider>
  )
}

export { MessageScrollerItem }
