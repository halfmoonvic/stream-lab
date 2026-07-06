import { useSyncExternalStore } from 'react'

interface ExternalStore<T> {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => T
}

/** 把核心层的任意订阅源(ChatController / SmoothStreamBuffer / RingLog)接进 React */
export function useStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
