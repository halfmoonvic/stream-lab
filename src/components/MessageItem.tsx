import { useState } from 'react'
import { controller } from '../controller'
import type { MessageNode } from '../core/types'
import { MessageTree } from '../core/message-tree'

interface Props {
  node: MessageNode
  tree: MessageTree
  /** 流式期间禁用编辑/重新生成/切分支 */
  disabled: boolean
}

/** 兄弟分支切换器:◀ 2/3 ▶,编辑或重新生成过的消息才会出现 */
function BranchSwitcher({ node, tree, disabled }: Props) {
  const sibs = tree.siblings(node.id)
  if (sibs.length <= 1) return null
  const idx = sibs.indexOf(node.id)
  return (
    <span className="branch-switcher">
      <button disabled={disabled || idx === 0} onClick={() => controller.switchBranch(node.id, -1)}>
        ◀
      </button>
      {idx + 1}/{sibs.length}
      <button
        disabled={disabled || idx === sibs.length - 1}
        onClick={() => controller.switchBranch(node.id, 1)}
      >
        ▶
      </button>
    </span>
  )
}

export function MessageItem({ node, tree, disabled }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(node.text)
    setEditing(true)
  }
  const submitEdit = () => {
    const text = draft.trim()
    setEditing(false)
    if (text && text !== node.text) controller.editAndResend(node.id, text)
  }

  if (editing) {
    return (
      <div className={`msg ${node.role} editing`}>
        <textarea
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitEdit()
            }
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <div className="msg-actions">
          <button onClick={submitEdit}>发送(生成新分支)</button>
          <button onClick={() => setEditing(false)}>取消</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`msg ${node.role}`}>
      <div className="msg-text">{node.text}</div>
      <div className="msg-meta">
        <BranchSwitcher node={node} tree={tree} disabled={disabled} />
        {node.status === 'interrupted' && <span className="badge interrupted">已打断</span>}
        {node.role === 'user' ? (
          <button className="msg-op" disabled={disabled} onClick={startEdit}>
            编辑
          </button>
        ) : (
          <button className="msg-op" disabled={disabled} onClick={() => controller.regenerate(node.id)}>
            重新生成
          </button>
        )}
      </div>
    </div>
  )
}
