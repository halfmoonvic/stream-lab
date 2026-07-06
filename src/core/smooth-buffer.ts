import { Emitter } from './emitter'

/**
 * 打字机平滑缓冲:网络增量先进缓冲区,rAF 循环按自适应速率逐字吐出。
 * 积压越多吐得越快(避免越落越远),快追平时放慢(保持打字感)。
 * 这就是三个网站"丝滑感"的真正来源——与协议无关,三家共用这一个类。
 */
export class SmoothStreamBuffer {
  #emitter = new Emitter()
  #target = '' // 已从网络收到的完整文本
  #shown = 0 // 已吐出的字符数
  #carry = 0 // 速率积分的小数残余
  #raf: number | null = null
  #lastTick = 0
  #finalized = false
  #drainResolvers: (() => void)[] = []

  subscribe = this.#emitter.subscribe

  /** React useSyncExternalStore 的 getSnapshot:当前应显示的文本 */
  getSnapshot = (): string => this.#target.slice(0, this.#shown)

  get isDrained(): boolean {
    return this.#finalized && this.#shown >= this.#target.length
  }

  reset() {
    this.#stopLoop()
    this.#target = ''
    this.#shown = 0
    this.#carry = 0
    this.#finalized = false
    this.#drainResolvers = []
    this.#emitter.emit()
  }

  push(text: string) {
    this.#target += text
    this.#ensureLoop()
  }

  /** 流结束:用协议给出的权威全文校正目标(防丢字),然后让循环自然追平 */
  finalize(finalText?: string) {
    if (finalText != null) {
      this.#target = finalText
      if (this.#shown > this.#target.length) this.#shown = this.#target.length
    }
    this.#finalized = true
    this.#ensureLoop()
  }

  /** 打断/切会话:立即吐完剩余文本 */
  flush() {
    this.#finalized = true
    this.#shown = this.#target.length
    this.#stopLoop()
    this.#emitter.emit()
    this.#resolveDrained()
  }

  /** 等待缓冲区吐完(finalize 或 flush 之后才会兑现) */
  drained(): Promise<void> {
    if (this.isDrained) return Promise.resolve()
    return new Promise((resolve) => this.#drainResolvers.push(resolve))
  }

  #ensureLoop() {
    if (this.#raf !== null) return
    this.#lastTick = performance.now()
    this.#raf = requestAnimationFrame(this.#tick)
  }

  #stopLoop() {
    if (this.#raf !== null) cancelAnimationFrame(this.#raf)
    this.#raf = null
  }

  #tick = (now: number) => {
    this.#raf = null
    const dt = Math.min((now - this.#lastTick) / 1000, 0.1)
    this.#lastTick = now

    const backlog = this.#target.length - this.#shown
    if (backlog > 0) {
      // 自适应速率:基础 40 字/秒,积压每多 1 字加速 8 字/秒,封顶 1500 字/秒
      const speed = Math.min(40 + backlog * 8, 1500)
      this.#carry += speed * dt
      const emit = Math.floor(this.#carry)
      if (emit > 0) {
        this.#carry -= emit
        this.#shown = Math.min(this.#shown + emit, this.#target.length)
        this.#emitter.emit()
      }
    }

    if (this.#shown < this.#target.length || !this.#finalized) {
      this.#raf = requestAnimationFrame(this.#tick)
    } else {
      this.#resolveDrained()
    }
  }

  #resolveDrained() {
    const resolvers = this.#drainResolvers
    this.#drainResolvers = []
    for (const r of resolvers) r()
  }
}
