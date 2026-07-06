import { SseParser } from '../parsers/sse'
import { MessageTree } from '../message-tree'
import type { ConversationMeta, MessageStatus, StreamEvent, StreamRequest } from '../types'
import { ProviderClient, type LoadedConversation } from './base'

const ROOT_UUID = '00000000-0000-4000-8000-000000000000'
const BASE = '/api/claude/organizations/o1/chat_conversations'

interface ChatMessage {
  uuid: string
  text: string
  sender: 'human' | 'assistant'
  parent_message_uuid: string
  status: string
  created_at: string
}

/**
 * Claude 适配器:SSE 命名事件(message_start / content_block_delta /
 * message_stop,与 Anthropic Messages API 同一套语法)。
 * 历史是 chat_messages[] + parent_message_uuid 连成的树;
 * 新会话需要先 POST chat_conversations 创建,再调 :id/completion。
 */
export class ClaudeClient extends ProviderClient {
  readonly id = 'claude' as const
  readonly label = 'Claude'

  async listConversations(): Promise<ConversationMeta[]> {
    const data = await this.fetchJson<{ uuid: string; name: string; updated_at: string }[]>(BASE)
    return data.map((c) => ({ id: c.uuid, title: c.name, updatedAt: Date.parse(c.updated_at) }))
  }

  async loadConversation(id: string): Promise<LoadedConversation> {
    const data = await this.fetchJson<{
      uuid: string
      name: string
      chat_messages: ChatMessage[]
      current_leaf_message_uuid: string | null
    }>(`${BASE}/${id}`)
    const nodes = data.chat_messages.map((m) => ({
      id: m.uuid,
      parentId: m.parent_message_uuid === ROOT_UUID ? null : m.parent_message_uuid,
      role: m.sender === 'human' ? ('user' as const) : ('assistant' as const),
      text: m.text,
      status: (m.status === 'complete' ? 'complete' : m.status) as MessageStatus,
      createdAt: Date.parse(m.created_at),
    }))
    return {
      tree: MessageTree.fromNodes(nodes),
      currentNodeId: data.current_leaf_message_uuid,
      title: data.name,
    }
  }

  async *streamReply(req: StreamRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    let convId = req.conversationId
    if (!convId) {
      const created = await this.fetchJson<{ uuid: string }>(BASE, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      convId = created.uuid
      yield { type: 'created', conversationId: convId }
    }

    const url =
      req.mode === 'regenerate' ? `${BASE}/${convId}/retry_completion` : `${BASE}/${convId}/completion`
    const body =
      req.mode === 'regenerate'
        ? { parent_message_uuid: req.parentId }
        : { prompt: req.prompt, parent_message_uuid: req.parentId ?? ROOT_UUID }

    const parser = new SseParser()
    let acc = ''

    for await (const chunk of this.fetchTextStream(url, body, signal)) {
      for (const frame of parser.push(chunk)) {
        yield { type: 'raw', frame: frame.raw }

        if (frame.event === 'content_block_delta') {
          try {
            const payload = JSON.parse(frame.data) as { delta?: { type: string; text?: string } }
            if (payload.delta?.type === 'text_delta' && payload.delta.text) {
              acc += payload.delta.text
              yield { type: 'delta', text: payload.delta.text }
            }
          } catch {
            // 忽略坏帧
          }
        } else if (frame.event === 'message_stop') {
          yield { type: 'done', finalText: acc }
          return
        }
        // message_start / content_block_start / ping / message_delta 不产生正文
      }
    }
    yield { type: 'done', finalText: acc }
  }
}
