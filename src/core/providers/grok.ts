import { NdjsonParser } from '../parsers/ndjson'
import { MessageTree } from '../message-tree'
import type { ConversationMeta, StreamEvent, StreamRequest } from '../types'
import { ProviderClient, type LoadedConversation } from './base'

const BASE = '/api/grok/rest/app-chat/conversations'

interface GrokResponseNode {
  responseId: string
  message: string
  sender: 'human' | 'assistant'
  parentResponseId: string | null
  partial: boolean
  createTime: string
}

interface GrokStreamLine {
  result?: {
    conversation?: { conversationId: string }
    response?: {
      userResponse?: { responseId: string }
      token?: string
      modelResponse?: { responseId: string; message: string }
    }
  }
}

/**
 * Grok 适配器:非 SSE——chunked HTTP 里一行一个 JSON(NDJSON)。
 * token 行是增量,末行 modelResponse 带权威全文。
 * 历史是 responses[] + parentResponseId 连成的树。
 */
export class GrokClient extends ProviderClient {
  readonly id = 'grok' as const
  readonly label = 'Grok'

  async listConversations(): Promise<ConversationMeta[]> {
    const data = await this.fetchJson<{
      conversations: { conversationId: string; title: string; modifyTime: string }[]
    }>(BASE)
    return data.conversations.map((c) => ({
      id: c.conversationId,
      title: c.title,
      updatedAt: Date.parse(c.modifyTime),
    }))
  }

  async loadConversation(id: string): Promise<LoadedConversation> {
    const data = await this.fetchJson<{
      responses: GrokResponseNode[]
      currentResponseId: string | null
    }>(`${BASE}/${id}/load-responses`)
    const nodes = data.responses.map((r) => ({
      id: r.responseId,
      parentId: r.parentResponseId,
      role: r.sender === 'human' ? ('user' as const) : ('assistant' as const),
      text: r.message,
      status: r.partial ? ('interrupted' as const) : ('complete' as const),
      createdAt: Date.parse(r.createTime),
    }))
    const meta = await this.fetchJson<{
      conversations: { conversationId: string; title: string }[]
    }>(BASE)
    return {
      tree: MessageTree.fromNodes(nodes),
      currentNodeId: data.currentResponseId,
      title: meta.conversations.find((c) => c.conversationId === id)?.title ?? 'Grok chat',
    }
  }

  async *streamReply(req: StreamRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    const url = req.conversationId ? `${BASE}/${req.conversationId}/responses` : `${BASE}/new`
    const body =
      req.mode === 'regenerate'
        ? { parentResponseId: req.parentId, regenerate: true }
        : { message: req.prompt, parentResponseId: req.parentId }

    const parser = new NdjsonParser()
    let acc = ''

    for await (const chunk of this.fetchTextStream(url, body, signal)) {
      for (const line of parser.push(chunk)) {
        yield { type: 'raw', frame: line.raw }

        const r = (line.json as GrokStreamLine | null)?.result
        if (!r) continue
        if (r.conversation) {
          yield { type: 'created', conversationId: r.conversation.conversationId }
        }
        if (typeof r.response?.token === 'string' && r.response.token) {
          acc += r.response.token
          yield { type: 'delta', text: r.response.token }
        }
        if (r.response?.modelResponse) {
          yield { type: 'done', finalText: r.response.modelResponse.message }
          return
        }
      }
    }
    yield { type: 'done', finalText: acc }
  }
}
