import { createServer } from 'node:http'
import { ConversationStore } from './store.mjs'
import { chatgptRoutes } from './providers/chatgpt.mjs'
import { claudeRoutes } from './providers/claude.mjs'
import { grokRoutes } from './providers/grok.mjs'
import { sendJson } from './http-util.mjs'

const PORT = 8787

const store = new ConversationStore()
const routes = [...chatgptRoutes(store), ...claudeRoutes(store), ...grokRoutes(store)]

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname))
  if (!route) return sendJson(res, 404, { error: `no route: ${req.method} ${url.pathname}` })

  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined
    const match = url.pathname.match(route.re)
    await route.handler(req, res, match, body)
  } catch (err) {
    // 流式响应写到一半出错时无法再改状态码,只能断开
    if (res.headersSent) return res.destroy()
    sendJson(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, () => {
  console.log(`[stream-lab] mock server listening on http://localhost:${PORT}`)
  console.log('  POST /api/chatgpt/conversation            (SSE, delta_encoding v1)')
  console.log('  POST /api/claude/organizations/o1/chat_conversations/:id/completion  (SSE, named events)')
  console.log('  POST /api/grok/rest/app-chat/conversations/new                       (NDJSON)')
})
