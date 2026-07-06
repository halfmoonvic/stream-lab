export interface NdjsonLine {
  json: unknown
  raw: string
}

/** 增量 NDJSON 解析器:按行切分、逐行 JSON.parse,残行留在缓冲区。Grok 用 */
export class NdjsonParser {
  #buffer = ''

  push(chunk: string): NdjsonLine[] {
    this.#buffer += chunk
    const lines: NdjsonLine[] = []
    for (;;) {
      const cut = this.#buffer.indexOf('\n')
      if (cut === -1) break
      const raw = this.#buffer.slice(0, cut).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(cut + 1)
      if (!raw.trim()) continue
      try {
        lines.push({ json: JSON.parse(raw), raw })
      } catch {
        lines.push({ json: null, raw })
      }
    }
    return lines
  }
}
