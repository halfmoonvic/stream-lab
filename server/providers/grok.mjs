import { driveGeneration } from '../mock.mjs'
import { sendJson, ndjsonHead, ndjsonWrite } from '../http-util.mjs'

/**
 * Grok 门面:模仿 grok.com 的 /rest/app-chat 接口。
 * 流式协议不是 SSE,而是 NDJSON:chunked HTTP 响应里一行一个 JSON:
 *   {"result":{"conversation":{...}}}            (仅新会话首行)
 *   {"result":{"response":{"userResponse":{...}}}}
 *   {"result":{"response":{"token":"...","isThinking":false}}}
 *   {"result":{"response":{"modelResponse":{...完整全文...}}}}
 * 历史接口返回 responses[] + parentResponseId 连成的树。
 */

const PROVIDER = 'grok'
const BASE = '/api/grok/rest/app-chat/conversations'

export function grokRoutes(store) {
  return [
    {
      method: 'GET',
      re: new RegExp(`^${BASE}$`),
      handler: (req, res) => listConversations(store, res),
    },
    {
      method: 'POST',
      re: new RegExp(`^${BASE}/new$`),
      handler: (req, res, m, body) => streamResponse(store, req, res, null, body),
    },
    {
      method: 'POST',
      re: new RegExp(`^${BASE}/([\\w-]+)/responses$`),
      handler: (req, res, m, body) => streamResponse(store, req, res, m[1], body),
    },
    {
      method: 'GET',
      re: new RegExp(`^${BASE}/([\\w-]+)/load-responses$`),
      handler: (req, res, m) => loadResponses(store, res, m[1]),
    },
  ]
}

function listConversations(store, res) {
  sendJson(res, 200, {
    conversations: store.list(PROVIDER).map((c) => ({
      conversationId: c.id,
      title: c.title,
      createTime: new Date(c.createdAt).toISOString(),
      modifyTime: new Date(c.updatedAt).toISOString(),
    })),
  })
}

function loadResponses(store, res, id) {
  const conv = store.get(id)
  if (!conv) return sendJson(res, 404, { error: 'not found' })
  sendJson(res, 200, {
    responses: store.orderedNodes(id).map((n) => ({
      responseId: n.id,
      message: n.text,
      sender: n.role === 'user' ? 'human' : 'assistant',
      parentResponseId: n.parentId ?? null,
      partial: n.status === 'interrupted' || n.status === 'in_progress',
      createTime: new Date(n.createdAt).toISOString(),
    })),
    currentResponseId: conv.currentNodeId,
  })
}

async function streamResponse(store, req, res, convId, body) {
  const isNew = convId === null
  const conv = isNew ? store.create(PROVIDER) : store.get(convId)
  if (!conv) return sendJson(res, 404, { error: 'not found' })

  const rawParent = body.parentResponseId ?? null

  let prompt
  let assistantParentId
  let userNode = null
  if (body.regenerate) {
    // 重新生成:parentResponseId 指向要重试的 human 消息
    const parent = conv.nodes.get(rawParent)
    if (!parent) return sendJson(res, 400, { error: 'regenerate parent not found' })
    prompt = parent.text
    assistantParentId = parent.id
  } else {
    prompt = body.message ?? ''
    userNode = store.addMessage(conv.id, { parentId: rawParent, role: 'user', text: prompt })
    assistantParentId = userNode.id
  }

  const assistant = store.addMessage(conv.id, {
    parentId: assistantParentId,
    role: 'assistant',
    text: '',
    status: 'in_progress',
  })

  ndjsonHead(res)
  if (isNew) {
    ndjsonWrite(res, { result: { conversation: { conversationId: conv.id, title: conv.title } } })
  }
  if (userNode) {
    ndjsonWrite(res, {
      result: {
        response: {
          userResponse: {
            responseId: userNode.id,
            message: userNode.text,
            parentResponseId: userNode.parentId,
          },
        },
      },
    })
  }

  const status = await driveGeneration({
    store,
    convId: conv.id,
    assistantId: assistant.id,
    prompt,
    req,
    res,
    onToken: (token) => {
      ndjsonWrite(res, { result: { response: { token, isThinking: false } } })
    },
  })

  if (status === 'complete' && !res.destroyed) {
    const full = conv.nodes.get(assistant.id).text
    ndjsonWrite(res, {
      result: {
        response: {
          modelResponse: {
            responseId: assistant.id,
            message: full,
            parentResponseId: assistantParentId,
          },
        },
      },
    })
    res.end()
  }
}
