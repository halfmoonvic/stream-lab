import { Emitter } from './emitter'
import { MessageTree } from './message-tree'
import { RingLog } from './ring-log'
import { SmoothStreamBuffer } from './smooth-buffer'
import { ChatGPTClient } from './providers/chatgpt'
import { ClaudeClient } from './providers/claude'
import { GrokClient } from './providers/grok'
import type { ProviderClient } from './providers/base'
import type { ConversationMeta, ProviderId } from './types'

const PROVIDER_KEY = 'stream-lab:provider'

export interface StreamingInfo {
  /** 本次生成挂在树上的父节点(null = 树根) */
  parentId: string | null
  /** send 模式下乐观显示的用户消息;regenerate 时为 null */
  pendingUserText: string | null
  mode: 'send' | 'regenerate'
}

export interface AppState {
  provider: ProviderId
  conversations: ConversationMeta[]
  conversationId: string | null
  title: string
  tree: MessageTree
  currentLeafId: string | null
  streaming: StreamingInfo | null
  loading: boolean
  error: string | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 应用状态中枢(纯 TS,不依赖 React)。
 * 树是服务端权威的:流式期间用"乐观 pending 消息 + 平滑缓冲"渲染,
 * 一轮生成结束(含被打断)后重新拉取会话做 reconcile,拿回真实的
 * 节点 id / 分支结构 / interrupted 状态。
 */
export class ChatController {
  readonly buffer = new SmoothStreamBuffer()
  readonly log = new RingLog()

  #emitter = new Emitter()
  #clients: Record<ProviderId, ProviderClient> = {
    chatgpt: new ChatGPTClient(),
    claude: new ClaudeClient(),
    grok: new GrokClient(),
  }
  #abort: AbortController | null = null
  /** 导航纪元:切会话/切 provider 时 +1,过期的 reconcile 直接丢弃 */
  #epoch = 0

  state: AppState = {
    provider: (localStorage.getItem(PROVIDER_KEY) as ProviderId) || 'chatgpt',
    conversations: [],
    conversationId: null,
    title: '',
    tree: MessageTree.fromNodes([]),
    currentLeafId: null,
    streaming: null,
    loading: false,
    error: null,
  }

  subscribe = this.#emitter.subscribe
  getSnapshot = (): AppState => this.state

  get providers(): ProviderClient[] {
    return Object.values(this.#clients)
  }

  #client(): ProviderClient {
    return this.#clients[this.state.provider]
  }

  #set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    this.#emitter.emit()
  }

  async init() {
    await this.refreshConversations()
  }

  async refreshConversations() {
    try {
      const conversations = await this.#client().listConversations()
      this.#set({ conversations })
    } catch (err) {
      this.#set({ error: `拉取会话列表失败: ${String(err)}` })
    }
  }

  async switchProvider(provider: ProviderId) {
    if (provider === this.state.provider) return
    this.stop()
    this.#epoch++
    localStorage.setItem(PROVIDER_KEY, provider)
    this.#set({
      provider,
      conversations: [],
      conversationId: null,
      title: '',
      tree: MessageTree.fromNodes([]),
      currentLeafId: null,
      streaming: null,
      error: null,
    })
    await this.refreshConversations()
  }

  /** 从历史列表恢复会话 */
  async openConversation(id: string) {
    this.stop()
    this.#epoch++
    const epoch = this.#epoch
    this.#set({ loading: true, error: null })
    try {
      const loaded = await this.#client().loadConversation(id)
      if (epoch !== this.#epoch) return
      this.#set({
        conversationId: id,
        title: loaded.title,
        tree: loaded.tree,
        currentLeafId: loaded.currentNodeId ?? loaded.tree.defaultLeaf(),
        loading: false,
        streaming: null,
      })
    } catch (err) {
      if (epoch !== this.#epoch) return
      this.#set({ loading: false, error: `加载会话失败: ${String(err)}` })
    }
  }

  newConversation() {
    this.stop()
    this.#epoch++
    this.#set({
      conversationId: null,
      title: '',
      tree: MessageTree.fromNodes([]),
      currentLeafId: null,
      streaming: null,
      error: null,
    })
  }

  /** 在当前路径末尾继续对话 */
  send(text: string) {
    void this.#run(this.state.currentLeafId, text, 'send')
  }

  /** 编辑历史上的某条用户消息 → 在同一父节点下生成新分支 */
  editAndResend(messageId: string, newText: string) {
    const node = this.state.tree.node(messageId)
    if (!node || node.role !== 'user') return
    void this.#run(node.parentId, newText, 'send')
  }

  /** 重新生成某条 assistant 回复 → 给它的 user 父节点加第二个回复分支 */
  regenerate(assistantMessageId: string) {
    const node = this.state.tree.node(assistantMessageId)
    if (!node || node.role !== 'assistant' || !node.parentId) return
    void this.#run(node.parentId, '', 'regenerate')
  }

  /** 在兄弟分支间切换(◀ ▶),切到目标分支下最新的叶子 */
  switchBranch(nodeId: string, dir: -1 | 1) {
    const { tree } = this.state
    const sibs = tree.siblings(nodeId)
    const next = sibs[sibs.indexOf(nodeId) + dir]
    if (!next) return
    this.#set({ currentLeafId: tree.deepestFrom(next) })
  }

  /** 打断当前生成:fetch abort → 服务端感知断开,把部分内容标记 interrupted */
  stop() {
    this.#abort?.abort()
  }

  async #run(parentId: string | null, prompt: string, mode: 'send' | 'regenerate') {
    if (this.state.streaming) return
    const client = this.#client()
    const epoch = this.#epoch
    const ac = new AbortController()
    this.#abort = ac
    this.buffer.reset()
    this.#set({
      streaming: { parentId, pendingUserText: mode === 'send' ? prompt : null, mode },
      error: null,
    })

    let convId = this.state.conversationId
    try {
      const events = client.streamReply(
        { conversationId: convId, parentId, prompt, mode },
        ac.signal,
      )
      for await (const ev of events) {
        switch (ev.type) {
          case 'created':
            convId = ev.conversationId
            if (epoch === this.#epoch) this.#set({ conversationId: convId })
            break
          case 'delta':
            this.buffer.push(ev.text)
            break
          case 'raw':
            this.log.push(client.id, ev.frame)
            break
          case 'done':
            this.buffer.finalize(ev.finalText)
            break
        }
      }
      this.buffer.finalize() // 流意外结束、没收到 done 时的兜底
      await this.buffer.drained() // 等平滑缓冲吐完再定稿,避免文字跳变
    } catch (err) {
      this.buffer.flush()
      if (!ac.signal.aborted && epoch === this.#epoch) {
        this.#set({ error: `生成失败: ${String(err)}` })
      }
    } finally {
      if (this.#abort === ac) this.#abort = null
      if (ac.signal.aborted) {
        this.buffer.flush()
        await sleep(200) // 给服务端一点时间处理断开、落库 interrupted
      }
      if (epoch === this.#epoch) await this.#reconcile(client, convId)
    }
  }

  /** 生成结束后拉回服务端权威的树(真实 id、分支、interrupted 状态) */
  async #reconcile(client: ProviderClient, convId: string | null) {
    const epoch = this.#epoch
    try {
      if (convId) {
        const loaded = await client.loadConversation(convId)
        if (epoch !== this.#epoch) return
        this.#set({
          conversationId: convId,
          title: loaded.title,
          tree: loaded.tree,
          currentLeafId: loaded.currentNodeId ?? loaded.tree.defaultLeaf(),
          streaming: null,
        })
      } else {
        this.#set({ streaming: null })
      }
      await this.refreshConversations()
    } catch (err) {
      if (epoch !== this.#epoch) return
      this.#set({ streaming: null, error: `同步会话失败: ${String(err)}` })
    }
  }
}
