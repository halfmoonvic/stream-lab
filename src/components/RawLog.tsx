import { useEffect, useRef } from 'react'
import { controller } from '../controller'
import { useStore } from '../hooks/use-store'

/** 原始线上帧日志:对比三种协议在网络上的真实长相 */
export function RawLog() {
  const entries = useStore(controller.log)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries])

  return (
    <aside className="rawlog">
      <div className="rawlog-head">
        <span>原始帧日志(wire format)</span>
        <button onClick={() => controller.log.clear()}>清空</button>
      </div>
      <div className="rawlog-body" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="rawlog-empty">发送一条消息后,这里会逐帧显示 SSE / NDJSON 原文</div>
        )}
        {entries.map((e) => (
          <pre key={e.id} className={`frame ${e.provider}`}>
            <span className="frame-tag">{e.provider}</span>
            {e.frame}
          </pre>
        ))}
      </div>
    </aside>
  )
}
