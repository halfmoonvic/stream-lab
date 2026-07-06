import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const DB_FILE = join(dirname(fileURLToPath(import.meta.url)), 'data', 'db.json')

/**
 * 所有 provider 共用的一份存储。数据模型是一棵消息树:
 * 节点 = 一条消息,编辑/重新生成 = 在同一 parent 下追加兄弟节点,
 * currentNodeId 记录最近一次生成落在哪个叶子上。
 * 三个 provider 门面只是把这棵树翻译成各家的接口格式。
 */
export class ConversationStore {
  #conversations = new Map()
  #saveTimer = null

  constructor() {
    this.#load()
  }

  #load() {
    try {
      const raw = JSON.parse(readFileSync(DB_FILE, 'utf8'))
      for (const conv of raw.conversations) {
        conv.nodes = new Map(Object.entries(conv.nodes))
        this.#conversations.set(conv.id, conv)
      }
    } catch {
      // 首次运行,无历史文件
    }
  }

  /** 流式期间每个 token 都会触发写入,做个防抖避免高频落盘 */
  #saveSoon() {
    if (this.#saveTimer) return
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null
      this.#saveNow()
    }, 300)
  }

  #saveNow() {
    const raw = {
      conversations: [...this.#conversations.values()].map((c) => ({
        ...c,
        nodes: Object.fromEntries(c.nodes),
      })),
    }
    mkdirSync(dirname(DB_FILE), { recursive: true })
    writeFileSync(DB_FILE, JSON.stringify(raw, null, 2))
  }

  create(provider, id = randomUUID()) {
    const now = Date.now()
    const conv = {
      id,
      provider,
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      currentNodeId: null,
      nodes: new Map(),
    }
    this.#conversations.set(id, conv)
    this.#saveSoon()
    return conv
  }

  get(id) {
    return this.#conversations.get(id)
  }

  list(provider) {
    return [...this.#conversations.values()]
      .filter((c) => c.provider === provider)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** @returns 新建的消息节点 */
  addMessage(convId, { id = randomUUID(), parentId = null, role, text = '', status = 'complete' }) {
    const conv = this.#conversations.get(convId)
    const node = { id, parentId, childrenIds: [], role, text, status, createdAt: Date.now() }
    conv.nodes.set(id, node)
    const parent = parentId ? conv.nodes.get(parentId) : null
    if (parent) parent.childrenIds.push(id)
    if (role === 'user' && conv.title === 'New chat') {
      conv.title = text.slice(0, 40) || 'New chat'
    }
    conv.updatedAt = Date.now()
    this.#saveSoon()
    return node
  }

  appendText(convId, nodeId, text) {
    const conv = this.#conversations.get(convId)
    conv.nodes.get(nodeId).text += text
    conv.updatedAt = Date.now()
    this.#saveSoon()
  }

  /** 生成结束(complete)或客户端断开(interrupted)时定稿 */
  finish(convId, nodeId, status) {
    const conv = this.#conversations.get(convId)
    conv.nodes.get(nodeId).status = status
    conv.currentNodeId = nodeId
    conv.updatedAt = Date.now()
    this.#saveSoon()
  }

  /** 按创建顺序返回节点数组(各 provider 的历史接口都用它) */
  orderedNodes(convId) {
    const conv = this.#conversations.get(convId)
    return [...conv.nodes.values()].sort((a, b) => a.createdAt - b.createdAt)
  }
}
