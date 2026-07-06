import { useEffect, useRef } from 'react'
import { controller } from '../controller'
import { useStore } from '../hooks/use-store'
import { MessageItem } from './MessageItem'

/** 流式中的 assistant 气泡:直接订阅平滑缓冲,60fps 的文字更新只重渲染这一个组件 */
function StreamingAssistant({ onGrow }: { onGrow: () => void }) {
  const text = useStore(controller.buffer)
  useEffect(onGrow, [text, onGrow])
  return (
    <div className="msg assistant streaming">
      <div className="msg-text">
        {text}
        <span className="cursor" />
      </div>
    </div>
  )
}

export function ChatView() {
  const state = useStore(controller)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // 流式期间只显示到生成的挂载点,pending 消息接在后面
  const path = state.streaming
    ? state.tree.pathTo(state.streaming.parentId)
    : state.tree.pathTo(state.currentLeafId)

  useEffect(scrollToBottom, [path.length, state.conversationId])

  return (
    <div className="chat-scroll" ref={scrollRef}>
      <div className="chat-inner">
        {path.length === 0 && !state.streaming && (
          <div className="chat-empty">
            <h2>Stream Lab</h2>
            <p>
              同一个聊天前端,三种真实的流式协议:ChatGPT(SSE + delta_encoding v1)、Claude(SSE
              命名事件)、Grok(NDJSON)。发一条消息,在右侧日志面板观察线上原始帧。
            </p>
          </div>
        )}

        {path.map((node) => (
          <MessageItem key={node.id} node={node} tree={state.tree} disabled={!!state.streaming} />
        ))}

        {state.streaming?.pendingUserText != null && (
          <div className="msg user pending">
            <div className="msg-text">{state.streaming.pendingUserText}</div>
          </div>
        )}
        {state.streaming && <StreamingAssistant onGrow={scrollToBottom} />}
      </div>
    </div>
  )
}
