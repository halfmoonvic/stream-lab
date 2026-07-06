import { driveGeneration } from '../mock.mjs'
import { sendJson, sseHead, sseWrite } from '../http-util.mjs'

/**
 * ChatGPT 门面:模仿 chatgpt.com 的 /backend-api 接口。
 * 流式协议为 SSE + delta_encoding v1(JSON-Patch 风格增量):
 *   event: delta_encoding / data: "v1"
 *   首帧 {"v": {message 骨架}, "c": 0}
 *   增量 {"p": "/message/content/parts/0", "o": "append", "v": "...", "c": n}
 *   后续增量省略 p/o(沿用上一次的 path 和 op)
 *   收尾 {"p": "", "o": "patch", "v": [...status 补丁...]}
 *   data: {"type": "message_stream_complete", ...} → data: [DONE]
 * 历史接口返回 mapping 树 + current_node。
 */

const ROOT_ID = 'client-created-root'
const PROVIDER = 'chatgpt'

export function chatgptRoutes(store) {
  return [
    {
      method: 'GET',
      re: /^\/api\/chatgpt\/conversations$/,
      handler: (req, res) => listConversations(store, res),
    },
    {
      method: 'GET',
      re: /^\/api\/chatgpt\/conversation\/([\w-]+)$/,
      handler: (req, res, m) => getConversation(store, res, m[1]),
    },
    {
      method: 'POST',
      re: /^\/api\/chatgpt\/conversation$/,
      handler: (req, res, m, body) => streamConversation(store, req, res, body),
    },
  ]
}

function listConversations(store, res) {
  const items = store.list(PROVIDER).map((c) => ({
    id: c.id,
    title: c.title,
    create_time: new Date(c.createdAt).toISOString(),
    update_time: new Date(c.updatedAt).toISOString(),
  }))
  sendJson(res, 200, { items, total: items.length, limit: 100, offset: 0 })
}

function messagePayload(node) {
  return {
    id: node.id,
    author: { role: node.role },
    content: { content_type: 'text', parts: [node.text] },
    status: node.status === 'complete' ? 'finished_successfully' : node.status,
    end_turn: node.status === 'complete',
    metadata: {},
  }
}

function getConversation(store, res, id) {
  const conv = store.get(id)
  if (!conv) return sendJson(res, 404, { detail: 'conversation not found' })

  const mapping = {
    [ROOT_ID]: { id: ROOT_ID, parent: null, children: [], message: null },
  }
  for (const node of store.orderedNodes(id)) {
    const parent = node.parentId ?? ROOT_ID
    mapping[node.id] = {
      id: node.id,
      parent,
      children: node.childrenIds.slice(),
      message: messagePayload(node),
    }
    if (parent === ROOT_ID) mapping[ROOT_ID].children.push(node.id)
  }
  sendJson(res, 200, {
    conversation_id: conv.id,
    title: conv.title,
    mapping,
    current_node: conv.currentNodeId,
  })
}

async function streamConversation(store, req, res, body) {
  const action = body.action ?? 'next'
  const conv = body.conversation_id ? store.get(body.conversation_id) : store.create(PROVIDER)
  if (!conv) return sendJson(res, 404, { detail: 'conversation not found' })

  const rawParent = body.parent_message_id === ROOT_ID ? null : (body.parent_message_id ?? null)

  let prompt
  let assistantParentId
  if (action === 'variant') {
    // 重新生成:parent_message_id 指向要重试的 user 消息,不新建 user 节点
    const userNode = conv.nodes.get(rawParent)
    if (!userNode) return sendJson(res, 400, { detail: 'variant parent not found' })
    prompt = userNode.text
    assistantParentId = userNode.id
  } else {
    const incoming = body.messages?.[0]
    prompt = incoming?.content?.parts?.[0] ?? ''
    const userNode = store.addMessage(conv.id, {
      id: incoming?.id,
      parentId: rawParent,
      role: 'user',
      text: prompt,
    })
    assistantParentId = userNode.id
  }

  const assistant = store.addMessage(conv.id, {
    parentId: assistantParentId,
    role: 'assistant',
    text: '',
    status: 'in_progress',
  })

  sseHead(res)
  sseWrite(res, 'delta_encoding', JSON.stringify('v1'))

  let counter = 0
  sseWrite(
    res,
    null,
    JSON.stringify({
      v: {
        message: {
          id: assistant.id,
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: [''] },
          status: 'in_progress',
          metadata: { parent_id: assistantParentId },
        },
        conversation_id: conv.id,
        error: null,
      },
      c: counter++,
    }),
  )

  let firstDelta = true
  const status = await driveGeneration({
    store,
    convId: conv.id,
    assistantId: assistant.id,
    prompt,
    req,
    res,
    onToken: (token) => {
      // 首个增量带完整 path/op,后续帧省略(delta_encoding v1 的压缩规则)
      const patch = firstDelta
        ? { p: '/message/content/parts/0', o: 'append', v: token, c: counter++ }
        : { v: token, c: counter++ }
      firstDelta = false
      sseWrite(res, 'delta', JSON.stringify(patch))
    },
  })

  if (status === 'complete' && !res.destroyed) {
    sseWrite(
      res,
      'delta',
      JSON.stringify({
        p: '',
        o: 'patch',
        v: [
          { p: '/message/status', o: 'replace', v: 'finished_successfully' },
          { p: '/message/end_turn', o: 'replace', v: true },
        ],
        c: counter++,
      }),
    )
    sseWrite(res, null, JSON.stringify({ type: 'message_stream_complete', conversation_id: conv.id }))
    sseWrite(res, null, '[DONE]')
    res.end()
  }
}
