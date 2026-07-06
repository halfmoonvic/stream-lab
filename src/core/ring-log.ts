import { Emitter } from './emitter'
import type { ProviderId } from './types'

export interface LogEntry {
  id: number
  provider: ProviderId
  frame: string
  at: number
}

/** 原始线上帧的环形日志,供侧栏面板对比三种协议的真实格式 */
export class RingLog {
  #emitter = new Emitter()
  #entries: LogEntry[] = []
  #nextId = 1
  #cap: number

  constructor(cap = 400) {
    this.#cap = cap
  }

  subscribe = this.#emitter.subscribe

  getSnapshot = (): LogEntry[] => this.#entries

  push(provider: ProviderId, frame: string) {
    const next = [...this.#entries, { id: this.#nextId++, provider, frame, at: Date.now() }]
    this.#entries = next.length > this.#cap ? next.slice(next.length - this.#cap) : next
    this.#emitter.emit()
  }

  clear() {
    this.#entries = []
    this.#emitter.emit()
  }
}
