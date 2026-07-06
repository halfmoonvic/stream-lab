const REPLIES = [
  `好的,我们来聊聊流式输出(streaming)。

大模型生成文本是逐 token 进行的,如果等全部生成完再返回,用户可能要面对十几秒的白屏。所以 Claude、ChatGPT、Grok 的网页都选择"边生成边推送":服务端拿到一个 token 就立刻写进 HTTP 响应流,前端边收边渲染。

有意思的是,三家的线上协议并不一样:
1. ChatGPT 用 SSE + JSON-Patch 风格的增量(delta_encoding v1);
2. Claude 用 SSE 的命名事件(message_start / content_block_delta / message_stop);
3. Grok 干脆不用 SSE,直接推 NDJSON——一行一个 JSON。

但到了渲染层,大家做的事情又是一样的:把突发到达的文本片段先放进缓冲区,再按平滑的速率逐字吐出来,这就是"打字机"手感的来源。网络包是一坨一坨到的,丝滑是前端演出来的。`,

  `This is a mock reply from the streaming lab server.

A few things worth noticing while you watch this text appear:

- The network chunks arrive in bursts (2-5 tokens, then a random 30-250ms pause), just like a real LLM backend under load.
- The smooth typing you see is produced by the frontend smoothing buffer, not by the network timing.
- Open the raw-frame log panel on the right and compare what the wire format looks like for each provider.

Try interrupting this reply with the Stop button — the partial text will be kept in history with an "interrupted" status, exactly like the real sites do. You can also edit an earlier user message to create a new branch, then flip between branches with the ◀ 1/2 ▶ switcher.`,

  `关于"编辑消息会发生什么"(what happens when you edit a message):

在这三个网站里,对话其实都不是一个列表,而是一棵树。你编辑第 3 条消息时,旧的第 3 条并没有被删除——系统在同一个父节点下面新建了一个兄弟节点,然后从那里重新生成回复。所以你会看到 ◀ 2/2 ▶ 这样的分支切换器。

ChatGPT 的历史接口把这棵树叫 mapping,每个节点有 parent 和 children;Claude 用 parent_message_uuid 把消息连起来;Grok 用 parentResponseId。名字不同,结构同源。

这也是本项目前端把三家协议归一化成同一个 MessageTree 模型的原因:协议适配器各写各的,树和渲染只写一份。`,
]

let replyIndex = 0

/** 轮流返回内置的示例回复,并在开头回显 prompt,方便肉眼区分是哪次生成 */
export function buildReply(prompt) {
  const body = REPLIES[replyIndex++ % REPLIES.length]
  const echo = prompt ? `「${prompt.slice(0, 60)}」— ` : ''
  return echo + body
}

/** 把文本切成 1~4 个字符的小片,模拟 LLM 的 token 粒度 */
export function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const len = 1 + Math.floor(Math.random() * 4)
    tokens.push(text.slice(i, i + len))
    i += len
  }
  return tokens
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 生成驱动器:三个协议门面共用的核心流程。
 * 连发 2~5 个 token、随机停 30~250ms,模拟真实 LLM 的突发到包节奏。
 * token 边发边写入 store,这样客户端中途断开时部分内容自然留在历史里。
 *
 * @param {object} ctx
 * @param {import('./store.mjs').ConversationStore} ctx.store
 * @param {string} ctx.convId
 * @param {string} ctx.assistantId  已提前建好的 assistant 消息节点 id
 * @param {string} ctx.prompt
 * @param {import('node:http').IncomingMessage} ctx.req
 * @param {(token: string) => void} ctx.onToken  把 token 按各家格式写进响应流
 * @returns {Promise<string>} 最终状态 'complete' | 'interrupted'
 */
export async function driveGeneration({ store, convId, assistantId, prompt, req, res, onToken }) {
  let closed = false
  req.on('close', () => {
    closed = true
  })

  const tokens = tokenize(buildReply(prompt))
  let i = 0
  while (i < tokens.length) {
    if (closed || res.destroyed) {
      store.finish(convId, assistantId, 'interrupted')
      return 'interrupted'
    }
    const burst = 2 + Math.floor(Math.random() * 4)
    for (let j = 0; j < burst && i < tokens.length; j++, i++) {
      store.appendText(convId, assistantId, tokens[i])
      onToken(tokens[i])
    }
    await sleep(30 + Math.random() * 220)
  }
  store.finish(convId, assistantId, 'complete')
  return 'complete'
}
