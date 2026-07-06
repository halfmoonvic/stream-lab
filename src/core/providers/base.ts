import { MessageTree } from '../message-tree'
import type { ConversationMeta, ProviderId, StreamEvent, StreamRequest } from '../types'

export interface LoadedConversation {
  tree: MessageTree
  currentNodeId: string | null
  title: string
}

/**
 * 协议适配器基类。三家网站的接口差异(端点、请求体、线上帧格式、
 * 历史数据结构)全部封装在子类里,向上只暴露统一的树 + 事件流。
 */
export abstract class ProviderClient {
  abstract readonly id: ProviderId
  abstract readonly label: string

  abstract listConversations(): Promise<ConversationMeta[]>
  /** 拉取历史并归一化成 MessageTree(会话恢复的入口) */
  abstract loadConversation(id: string): Promise<LoadedConversation>
  /** 发起一次生成,把本家协议翻译成统一的 StreamEvent 流 */
  abstract streamReply(req: StreamRequest, signal: AbortSignal): AsyncGenerator<StreamEvent>

  protected async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}`)
    return res.json() as Promise<T>
  }

  /** POST 并以文本块流读回响应体(SSE / NDJSON 的共同底座:fetch + ReadableStream) */
  protected async *fetchTextStream(
    url: string,
    body: unknown,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`POST ${url} → ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        yield decoder.decode(value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }
  }
}
