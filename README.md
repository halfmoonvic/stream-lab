# Stream Lab

复刻 Claude / ChatGPT / Grok 三个网站的聊天前端:三种真实的流式协议 + 一套共用的树模型与渲染层。

功能:会话历史与恢复、继续对话、流式平滑打字机、中途打断(部分内容保留)、编辑历史消息产生分支(◀ 2/3 ▶ 切换)、重新生成、原始线上帧日志面板。

## 运行

需要两个终端:

```bash
pnpm dev:server   # mock 后端,http://localhost:8787
pnpm dev          # Vite 前端,/api 代理到 8787
```

## 三种协议(mock 后端按各家真实格式实现)

| Provider | 传输 | 增量格式 | 历史树结构 |
|---|---|---|---|
| ChatGPT | SSE(POST) | `delta_encoding v1`:`event: delta` + JSON-Patch `{"p":"/message/content/parts/0","o":"append","v":"…"}`,`data: [DONE]` 结束 | `mapping{id→{parent,children,message}}` + `current_node` |
| Claude | SSE(POST) | 命名事件 `message_start / content_block_delta(text_delta) / message_stop` | `chat_messages[]` + `parent_message_uuid` |
| Grok | NDJSON(chunked) | 每行一个 JSON `{"result":{"response":{"token":"…"}}}`,末行 `modelResponse` 带全文 | `responses[]` + `parentResponseId` |

共同点:都是 `fetch` POST + `ReadableStream` 手动读流(原生 `EventSource` 只支持 GET);打字机的"丝滑感"由前端平滑缓冲实现,与网络到包节奏无关。

## 架构

```
server/                      零依赖 node:http mock 后端(端口 8787)
  store.mjs                  ConversationStore:消息树 + JSON 落盘(server/data/db.json)
  mock.mjs                   mock 文本、token 切片、突发节奏、生成驱动器
  providers/{chatgpt,claude,grok}.mjs   三个协议门面(同一棵树,三种接口格式)

src/core/                    纯 TS 核心层,不依赖 React
  message-tree.ts            MessageTree:归一化消息树(分支/路径/兄弟切换)
  parsers/{sse,ndjson}.ts    增量帧解析器
  providers/{base,chatgpt,claude,grok}.ts   协议适配器:各家格式 → 统一 StreamEvent + MessageTree
  smooth-buffer.ts           SmoothStreamBuffer:rAF 自适应速率的打字机平滑缓冲
  chat-controller.ts         ChatController:状态中枢(发送/编辑/重生成/打断/恢复/reconcile)
  ring-log.ts                原始帧环形日志

src/components/              React 层(useSyncExternalStore 订阅核心层)
  Sidebar / ChatView / MessageItem / Composer / RawLog
```

设计要点:

- **协议差异收敛在适配器层**,树模型、控制器、渲染完全共用——三家的历史数据(`mapping` / `parent_message_uuid` / `parentResponseId`)本质都是同一棵消息树。
- **服务端是权威数据源**:流式期间前端用"乐观 pending 消息 + 平滑缓冲"渲染,一轮生成结束(含被打断)后重新拉取会话 reconcile,拿回真实节点 id、分支结构和 interrupted 状态。
- **编辑 = 同一父节点下加兄弟节点**,重新生成 = 给 user 节点加第二个 assistant 子节点,当前对话 = 根到叶子的一条路径。
