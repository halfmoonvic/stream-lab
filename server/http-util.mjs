export function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

/** SSE 响应头。X-Accel-Buffering 防反向代理缓冲(nginx 场景),此处顺手带上以贴近真实站点 */
export function sseHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

/** 写一帧 SSE。event 传 null 时只写 data 行(ChatGPT 的匿名事件就是这种) */
export function sseWrite(res, event, data) {
  if (res.destroyed) return
  let frame = ''
  if (event) frame += `event: ${event}\n`
  frame += `data: ${data}\n\n`
  res.write(frame)
}

/** NDJSON 响应头(Grok 风格:普通 chunked 响应,一行一个 JSON) */
export function ndjsonHead(res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
}

export function ndjsonWrite(res, obj) {
  if (res.destroyed) return
  res.write(JSON.stringify(obj) + '\n')
}
