export interface SseFrame {
  event: string | null
  data: string
  raw: string
}

/**
 * 增量 SSE 帧解析器:持续喂入解码后的文本,按空行分帧,
 * 解析 event:/data: 行(多行 data 按规范用 \n 拼接)。
 * ChatGPT(匿名事件 + event: delta)和 Claude(命名事件)共用。
 */
export class SseParser {
  #buffer = ''

  push(chunk: string): SseFrame[] {
    this.#buffer += chunk
    const frames: SseFrame[] = []
    for (;;) {
      const cut = this.#buffer.search(/\r?\n\r?\n/)
      if (cut === -1) break
      const rawFrame = this.#buffer.slice(0, cut)
      this.#buffer = this.#buffer.slice(cut).replace(/^\r?\n\r?\n/, '')
      const frame = this.#parseFrame(rawFrame)
      if (frame) frames.push(frame)
    }
    return frames
  }

  #parseFrame(raw: string): SseFrame | null {
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      // 其余行(注释 : 、id: 等)忽略
    }
    if (event === null && dataLines.length === 0) return null
    return { event, data: dataLines.join('\n'), raw }
  }
}
