import type { MessageNode } from './types'

/**
 * 会话消息树。编辑消息 = 在同一 parent 下加兄弟节点,重新生成 = 给 user
 * 节点加第二个 assistant 子节点;当前显示的对话 = 根到某个叶子的一条路径。
 */
export class MessageTree {
  #nodes = new Map<string, MessageNode>()
  #rootIds: string[] = []

  /** 从任意 provider 的历史数据归一化而来的平铺节点列表建树(childrenIds 在这里统一重算) */
  static fromNodes(nodes: Omit<MessageNode, 'childrenIds'>[]): MessageTree {
    const tree = new MessageTree()
    const sorted = [...nodes].sort((a, b) => a.createdAt - b.createdAt)
    for (const n of sorted) {
      tree.#nodes.set(n.id, { ...n, childrenIds: [] })
    }
    for (const n of tree.#nodes.values()) {
      if (n.parentId && tree.#nodes.has(n.parentId)) {
        tree.#nodes.get(n.parentId)!.childrenIds.push(n.id)
      } else {
        n.parentId = null
        tree.#rootIds.push(n.id)
      }
    }
    return tree
  }

  get isEmpty(): boolean {
    return this.#nodes.size === 0
  }

  node(id: string): MessageNode | undefined {
    return this.#nodes.get(id)
  }

  /** 根 → id 的路径;id 为 null 时返回空路径 */
  pathTo(id: string | null): MessageNode[] {
    const path: MessageNode[] = []
    let cur = id ? this.#nodes.get(id) : undefined
    while (cur) {
      path.push(cur)
      cur = cur.parentId ? this.#nodes.get(cur.parentId) : undefined
    }
    return path.reverse()
  }

  /** id 的兄弟列表(含自己)。根节点的兄弟是全部根节点 */
  siblings(id: string): string[] {
    const node = this.#nodes.get(id)
    if (!node) return []
    if (node.parentId === null) return this.#rootIds
    return this.#nodes.get(node.parentId)?.childrenIds ?? []
  }

  /** 从 id 一路沿"最新的孩子"下到叶子(切分支后用它决定显示到哪) */
  deepestFrom(id: string): string {
    let cur = id
    for (;;) {
      const children = this.#nodes.get(cur)?.childrenIds ?? []
      if (children.length === 0) return cur
      cur = children[children.length - 1]
    }
  }

  /** 没有任何指引时的默认叶子:最新的根分支一路到底 */
  defaultLeaf(): string | null {
    if (this.#rootIds.length === 0) return null
    return this.deepestFrom(this.#rootIds[this.#rootIds.length - 1])
  }
}
