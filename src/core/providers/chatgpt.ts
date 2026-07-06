import { SseParser } from '../parsers/sse'
import { MessageTree } from '../message-tree'
import type { ConversationMeta, MessageStatus, StreamEvent, StreamRequest } from '../types'
import { ProviderClient, type LoadedConversation } from './base'

const ROOT_ID = 'client-created-root'

interface MappingNode {
  id: string
  parent: string | null
  children: string[]
  message: {
    id: string
    author: { role: 'user' | 'assistant' }
    content: { content_type: string; parts: string[] }
    status: string
  } | null
}

interface ConversationDetail {
  conversation_id: string
  title: string
  mapping: Record<string, MappingNode>
  current_node: string | null
}

function toStatus(s: string): MessageStatus {
  if (s === 'finished_successfully') return 'complete'
  if (s === 'interrupted') return 'interrupted'
  return 'in_progress'
}

/**
 * ChatGPT 适配器:SSE + delta_encoding v1。
 * 增量是 JSON-Patch 风格:{"p":"/message/content/parts/0","o":"append","v":"..."},
 * 后续帧可省略 p/o(沿用上一帧),结束时 data: [DONE]。
 * 历史是 mapping 树 + current_node。
 */
export class ChatGPTClient extends ProviderClient {
  readonly id = 'chatgpt' as const
  readonly label = 'ChatGPT'

  async listConversations(): Promise<ConversationMeta[]> {
    const data = await this.fetchJson<{ items: { id: string; title: string; update_time: string }[] }>(
      '/api/chatgpt/conversations',
    )
    return data.items.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: Date.parse(c.update_time),
    }))
  }

  async loadConversation(id: string): Promise<LoadedConversation> {
    const data = await this.fetchJson<ConversationDetail>(`/api/chatgpt/conversation/${id}`)
    const nodes = Object.values(data.mapping)
      .filter((n) => n.message !== null)
      .map((n, i) => ({
        id: n.id,
        parentId: n.parent === ROOT_ID ? null : n.parent,
        role: n.message!.author.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: n.message!.content.parts[0] ?? '',
        status: toStatus(n.message!.status),
        createdAt: i, // mapping 无时间戳,以对象顺序(即插入顺序)为准
      }))
    return {
      tree: MessageTree.fromNodes(nodes),
      currentNodeId: data.current_node,
      title: data.title,
    }
  }

  async *streamReply(req: StreamRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    const body =
      req.mode === 'regenerate'
        ? {
            action: 'variant',
            conversation_id: req.conversationId,
            parent_message_id: req.parentId,
            model: 'gpt-mock',
          }
        : {
            action: 'next',
            conversation_id: req.conversationId ?? undefined,
            parent_message_id: req.parentId ?? ROOT_ID,
            messages: [
              {
                id: crypto.randomUUID(),
                author: { role: 'user' },
                content: { content_type: 'text', parts: [req.prompt] },
              },
            ],
            model: 'gpt-mock',
          }

    const parser = new SseParser()
    // delta_encoding v1 的压缩规则:省略 p/o 的帧沿用上一帧的 path 和 op
    let lastPath = ''
    let lastOp = ''
    let acc = ''

    for await (const chunk of this.fetchTextStream('/api/chatgpt/conversation', body, signal)) {
      for (const frame of parser.push(chunk)) {
        yield { type: 'raw', frame: frame.raw }

        if (frame.data === '[DONE]') {
          yield { type: 'done', finalText: acc }
          return
        }
        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(frame.data)
        } catch {
          continue // "v1" 等非对象帧
        }
        if (frame.event === 'delta') {
          const p = (payload.p as string) ?? lastPath
          const o = (payload.o as string) ?? lastOp
          lastPath = p
          lastOp = o
          if (o === 'append' && p === '/message/content/parts/0' && typeof payload.v === 'string') {
            acc += payload.v
            yield { type: 'delta', text: payload.v }
          }
          // o === 'patch' 的收尾状态补丁不影响正文,忽略
        } else if (payload.v && typeof payload.v === 'object') {
          // 首帧:message 骨架 + conversation_id
          const v = payload.v as { conversation_id?: string }
          if (v.conversation_id) yield { type: 'created', conversationId: v.conversation_id }
        }
      }
    }
    // 服务器中断(未见 [DONE]):把已累计文本作为结果返回
    yield { type: 'done', finalText: acc }
  }
}
