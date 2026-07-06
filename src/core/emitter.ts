/** 极简订阅器:核心类不依赖 React,React 侧用 useSyncExternalStore 接上来 */
export class Emitter {
  #listeners = new Set<() => void>()

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  emit() {
    for (const fn of this.#listeners) fn()
  }
}
