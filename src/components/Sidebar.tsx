import { controller } from '../controller'
import { useStore } from '../hooks/use-store'
import type { ProviderId } from '../core/types'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'grok', label: 'Grok' },
]

function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

export function Sidebar() {
  const state = useStore(controller)

  return (
    <aside className="sidebar">
      <div className="provider-tabs">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={state.provider === p.id ? 'tab active' : 'tab'}
            onClick={() => void controller.switchProvider(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button className="new-chat" onClick={() => controller.newConversation()}>
        + 新对话
      </button>

      <div className="conv-list">
        {state.conversations.map((c) => (
          <button
            key={c.id}
            className={state.conversationId === c.id ? 'conv active' : 'conv'}
            onClick={() => void controller.openConversation(c.id)}
            title={c.title}
          >
            <span className="conv-title">{c.title}</span>
            <span className="conv-time">{timeAgo(c.updatedAt)}</span>
          </button>
        ))}
        {state.conversations.length === 0 && <div className="conv-empty">暂无历史会话</div>}
      </div>
    </aside>
  )
}
