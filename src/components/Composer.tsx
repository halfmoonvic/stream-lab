import { useState } from 'react'
import { controller } from '../controller'
import { useStore } from '../hooks/use-store'

export function Composer() {
  const state = useStore(controller)
  const [text, setText] = useState('')
  const streaming = !!state.streaming

  const send = () => {
    const t = text.trim()
    if (!t || streaming) return
    setText('')
    controller.send(t)
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={`给 ${state.provider} 发消息…(Enter 发送,Shift+Enter 换行)`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      {streaming ? (
        <button className="send stop" onClick={() => controller.stop()}>
          ⏹ 停止
        </button>
      ) : (
        <button className="send" disabled={!text.trim()} onClick={send}>
          发送
        </button>
      )}
    </div>
  )
}
