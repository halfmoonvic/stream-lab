import { useEffect } from 'react'
import { controller } from './controller'
import { useStore } from './hooks/use-store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { Composer } from './components/Composer'
import { RawLog } from './components/RawLog'
import './App.css'

function App() {
  const state = useStore(controller)

  useEffect(() => {
    void controller.init()
  }, [])

  return (
    <div className="app">
      <Sidebar />

      <main className="chat">
        <header className="chat-head">
          <span className="chat-title">{state.title || '新对话'}</span>
          {state.streaming && <span className="badge streaming-badge">生成中…</span>}
          {state.loading && <span className="badge">加载中…</span>}
        </header>

        {state.error && (
          <div className="error-banner" onClick={() => void controller.refreshConversations()}>
            {state.error}
          </div>
        )}

        <ChatView />
        <Composer />
      </main>

      <RawLog />
    </div>
  )
}

export default App
