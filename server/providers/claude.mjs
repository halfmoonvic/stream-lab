import { driveGeneration } from '../mock.mjs'
import { sendJson, sseHead, sseWrite } from '../http-util.mjs'

/**
 * Claude 门面:模仿 claude.ai 的 /api/organizations/{org}/chat_conversations 接口。
 * 流式协议为 SSE 命名事件(与 Anthropic Messages API 同一套语法):
 *   event: message_start / content_block_start / ping /
 *          content_block_delta(text_delta)/ content_block_stop /
 *          message_delta / message_stop
 * 历史接口返回 chat_messages[] + parent_message_uuid 连成的树。
 */

// claude.ai 用这个固定 uuid 表示"树根"(第一条消息的 parent)
const ROOT_UUID = '00000000-0000-4000-8000-000000000000'
const PROVIDER = 'claude'
const BASE = '/api/claude/organizations/o1/chat_conversations'

export function claudeRoutes(store) {
  return [
    {
      method: 'GET',
      re: new RegExp(`^${BASE}$`),
      handler: (req, res) => listConversations(store, res),
    },
    {
      method: 'POST',
      re: new RegExp(`^${BASE}$`),
      handler: (req, res, m, body) => createConversation(store, res, body),
    },
    {
      method: 'GET',
      re: new RegExp(`^${BASE}/([\\w-]+)$`),
      handler: (req, res, m) => getConversation(store, res, m[1]),
    },
    {
      method: 'POST',
      re: new RegExp(`^${BASE}/([\\w-]+)/completion$`),
      handler: (req, res, m, body) => completion(store, req, res, m[1], body, { retry: false }),
    },
    {
      method: 'POST',
      re: new RegExp(`^${BASE}/([\\w-]+)/retry_completion$`),
      handler: (req, res, m, body) => completion(store, req, res, m[1], body, { retry: true }),
    },
  ]
}

function listConversations(store, res) {
  sendJson(
    res,
    200,
    store.list(PROVIDER).map((c) => ({
      uuid: c.id,
      name: c.title,
      created_at: new Date(c.createdAt).toISOString(),
      updated_at: new Date(c.updatedAt).toISOString(),
    })),
  )
}

function createConversation(store, res, body) {
  const conv = store.create(PROVIDER, body?.uuid || undefined)
  if (body?.name) conv.title = body.name
  sendJson(res, 201, { uuid: conv.id, name: conv.title })
}

function getConversation(store, res, id) {
  const conv = store.get(id)
  if (!conv) return sendJson(res, 404, { error: 'not found' })
  sendJson(res, 200, {
    uuid: conv.id,
    name: conv.title,
    chat_messages: store.orderedNodes(id).map((n) => ({
      uuid: n.id,
      text: n.text,
      sender: n.role === 'user' ? 'human' : 'assistant',
      parent_message_uuid: n.parentId ?? ROOT_UUID,
      status: n.status,
      created_at: new Date(n.createdAt).toISOString(),
    })),
    current_leaf_message_uuid: conv.currentNodeId,
  })
}

async function completion(store, req, res, convId, body, { retry }) {
  const conv = store.get(convId)
  if (!conv) return sendJson(res, 404, { error: 'not found' })

  const rawParent = body.parent_message_uuid === ROOT_UUID ? null : (body.parent_message_uuid ?? null)

  let prompt
  let assistantParentId
  if (retry) {
    // retry_completion:parent 指向要重试的 human 消息,不新建 human 节点
    const humanNode = conv.nodes.get(rawParent)
    if (!humanNode) return sendJson(res, 400, { error: 'retry parent not found' })
    prompt = humanNode.text
    assistantParentId = humanNode.id
  } else {
    prompt = body.prompt ?? ''
    const humanNode = store.addMessage(convId, {
      parentId: rawParent,
      role: 'user',
      text: prompt,
    })
    assistantParentId = humanNode.id
  }

  const assistant = store.addMessage(convId, {
    parentId: assistantParentId,
    role: 'assistant',
    text: '',
    status: 'in_progress',
  })

  sseHead(res)
  const emit = (event, data) => sseWrite(res, event, JSON.stringify({ type: event, ...data }))

  emit('message_start', {
    message: {
      id: assistant.id,
      type: 'message',
      role: 'assistant',
      model: 'claude-mock',
      parent_uuid: assistantParentId,
      content: [],
      stop_reason: null,
    },
  })
  emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  emit('ping', {})

  const status = await driveGeneration({
    store,
    convId,
    assistantId: assistant.id,
    prompt,
    req,
    res,
    onToken: (token) => {
      emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: token } })
    },
  })

  if (status === 'complete' && !res.destroyed) {
    emit('content_block_stop', { index: 0 })
    emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null } })
    emit('message_stop', {})
    res.end()
  }
}
