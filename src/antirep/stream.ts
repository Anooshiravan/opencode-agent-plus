// Wraps a model reply stream so the model's words can be scanned as they
// arrive. The stream itself is protocol text (JSON chunks), so we pull the
// words out of it first, then scan only those.
// When the scanner says stop, onHit fires once; the stream itself keeps
// flowing (opencode's interrupt ends the run, not us).
import { findRepetition, type RepetitionHit } from "./detect"

export interface ScanOptions {
  /** Called at most once, on the first repetition found. */
  onHit: (hit: RepetitionHit) => void
  /** Scan when at least this many new characters arrived since last scan. Default 256. */
  scanEvery?: number
  /** Optional debug logger. */
  debug?: (line: string) => void
}

// Pulls model words out of protocol text: every `"content":"..."` value,
// with JSON escapes decoded. Unfinished tail (partial value) stays in `rest`.
export function extractText(chunk: string): { text: string; rest: string } {
  let text = ""
  let i = 0
  for (;;) {
    const key = chunk.indexOf('"content":"', i)
    if (key < 0) return { text, rest: chunk.slice(i) }
    let j = key + '"content":"'.length
    let value = ""
    let closed = false
    while (j < chunk.length) {
      const c = chunk[j]
      if (c === "\\") {
        if (j + 1 >= chunk.length) break // escape split across chunks: wait
        const next = chunk[j + 1]
        value += next === "n" ? "\n" : next === "t" ? "\t" : next
        j += 2
        continue
      }
      if (c === '"') {
        closed = true
        j++
        break
      }
      value += c
      j++
    }
    if (!closed) return { text, rest: chunk.slice(key) }
    text += value
    i = j
  }
}

export function scanResponse(response: Response, options: ScanOptions): Response {
  if (!response.body) return response
  const scanEvery = options.scanEvery ?? 256
  const decoder = new TextDecoder()
  let pending = "" // protocol text not yet parsed (ends mid-value)
  let words = "" // model words, trimmed by findRepetition's window
  let sinceScan = 0
  let fired = false

  // Throws inside transform/flush so the stream dies and the reader stops.
  const check = (final: boolean) => {
    if (fired) return
    const hit = findRepetition(words)
    if (!hit) return
    fired = true
    options.debug?.(`anti-repetition: HIT unit=${JSON.stringify(hit.unit)} times=${hit.times} final=${final}`)
    options.onHit(hit)
    throw new Error(`agent-plus: anti-repetition stopped the reply ("${hit.unit}" repeated ${hit.times} times)`)
  }

  const checker = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (sinceScan === 0 && words === "" && pending === "") options.debug?.(`anti-repetition: first chunk ${chunk.byteLength} bytes`)
      if (fired) throw new Error("agent-plus: anti-repetition stopped the reply")
      controller.enqueue(chunk)
      const { text, rest } = extractText(pending + decoder.decode(chunk, { stream: true }))
      pending = rest
      if (!text) return
      words += text
      sinceScan += text.length
      check(false)
    },
    flush() {
      options.debug?.(`anti-repetition: stream end words=${words.length} fired=${fired}`)
      check(true)
    },
  })

  return new Response(response.body.pipeThrough(checker), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
