export type ProviderId = 'chatgpt' | 'claude' | 'grok'

export type Role = 'user' | 'assistant'

export type MessageStatus = 'complete' | 'in_progress' | 'interrupted'

/** 归一化后的消息节点:三家的树(mapping / parent_message_uuid / parentResponseId)都映射到这个结构 */
export interface MessageNode {
  id: string
  parentId: string | null
  childrenIds: string[]
  role: Role
  text: string
  status: MessageStatus
  createdAt: number
}

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: number
}

/** 协议适配器向上抛出的统一事件——协议差异到适配器为止,不再向上泄漏 */
export type StreamEvent =
  | { type: 'created'; conversationId: string } // 新会话在流里诞生(或流式前创建完成)
  | { type: 'delta'; text: string }
  | { type: 'raw'; frame: string } // 原始线上帧,供日志面板
  | { type: 'done'; finalText?: string } // finalText 为协议给出的权威全文(如 Grok 的 modelResponse)

export interface StreamRequest {
  conversationId: string | null // null = 尚无会话,由适配器负责创建
  parentId: string | null // 归一化树里的父节点(null = 树根)
  prompt: string
  /** regenerate 时 parentId 指向要重试的 user 消息,prompt 被忽略 */
  mode: 'send' | 'regenerate'
}
