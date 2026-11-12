// Repetition guards: stop the model when it repeats itself.
// `max_word_repeat` — interrupt the reply when its text repeats back-to-back.
// `max_tool_repeat` — deny a tool after it is called the same way N times in a row.
import { log } from "./log"
import { realUserTexts } from "./context"

export interface RepetitionOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

// --- max_word_repeat: text repetition ---

export interface RepetitionHit {
  /** The repeated piece, e.g. "parameter=". */
  unit: string
  /** How many times it appeared back-to-back. */
  times: number
}

export interface DetectOptions {
  /** Longest repeated piece to look for. Default 64 characters. */
  maxUnit?: number
  /** Minimum back-to-back repeats to call it repetition. Default 5. */
  minTimes?: number
  /** Minimum total characters (unit x times) to call it repetition. Default 40. */
  minTotal?: number
  /** Only the last this-many characters are examined. Default 4096. */
  window?: number
}

// Looks at the tail of `text` for a block of length `unit` repeated `minTimes`
// or more times in a row. Returns the longest/most repeated block found.
export function findRepetition(text: string, options: DetectOptions = {}): RepetitionHit | undefined {
  const maxUnit = options.maxUnit ?? 64
  const minTimes = options.minTimes ?? 5
  const minTotal = options.minTotal ?? 40
  const window = options.window ?? 4096

  const tail = text.length > window ? text.slice(-window) : text
  let best: RepetitionHit | undefined

  for (let unit = 1; unit <= maxUnit; unit++) {
    const limit = tail.length - unit * minTimes
    if (limit < 0) break
    for (let start = 0; start <= limit; start++) {
      const block = tail.slice(start, start + unit)
      let times = 1
      let at = start + unit
      while (at + unit <= tail.length && tail.startsWith(block, at)) {
        times++
        at += unit
      }
      if (times >= minTimes && times * unit >= minTotal) {
        const hit = { unit: block, times }
        if (!best || times * unit > best.times * best.unit.length) best = hit
      }
      if (times > 1) start = at - unit
    }
  }
  return best
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
        if (j + 1 >= chunk.length) break
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

interface ScanOptions {
  /** Called at most once, on the first repetition found. */
  onHit: (hit: RepetitionHit) => void
  /** Scan when at least this many new characters arrived since last scan. Default 256. */
  scanEvery?: number
}

// Wraps a model reply stream so the model's words can be scanned as they
// arrive. When the scanner says stop, onHit fires once; the stream keeps
// flowing (opencode's interrupt ends the run, not us).
export function scanResponse(response: Response, options: ScanOptions): Response {
  if (!response.body) return response
  const scanEvery = options.scanEvery ?? 256
  const decoder = new TextDecoder()
  let pending = ""
  let words = ""
  let sinceScan = 0
  let fired = false

  const check = (final: boolean) => {
    if (fired) return
    const hit = findRepetition(words)
    if (!hit) return
    fired = true
    log(`repetition: hit unit=${JSON.stringify(hit.unit)} times=${hit.times} final=${final}`)
    options.onHit(hit)
    throw new Error(`agent-plus: anti-repetition stopped the reply ("${hit.unit}" repeated ${hit.times} times)`)
  }

  const checker = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (sinceScan === 0 && words === "" && pending === "") log(`repetition: first chunk bytes=${chunk.byteLength}`)
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
      log(`repetition: stream end words=${words.length} fired=${fired}`)
      check(true)
    },
  })

  return new Response(response.body.pipeThrough(checker), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function maxWordRepeat(ctx: any, options: RepetitionOptions) {
  return ctx.session.hook("http.response", async (event: any) => {
    const { keys } = await options.settings(event.agent)
    if (keys.max_word_repeat !== "on") return
    log(`repetition: http.response fired session=${event.sessionID} agent=${event.agent}`)
    const sessionID = event.sessionID
    const stop = (hit: RepetitionHit) => {
      log(`repetition: interrupt session=${sessionID} unit=${JSON.stringify(hit.unit)} times=${hit.times}`)
      ctx.session.interrupt({ sessionID }).catch(() => {})
    }
    event.response = scanResponse(event.response, { onHit: stop })
  })
}

// --- max_tool_repeat: same tool call repeated ---

function countUserTurns(messages: any[]): number {
  return realUserTexts(messages).length
}

export async function maxToolRepeat(ctx: any, options: RepetitionOptions) {
  const streaks = new Map<string, { call: string; count: number }>()
  const turns = new Map<string, number>()

  await ctx.session.hook("context", async (event: any) => {
    const key = String(event.sessionID)
    const turn = countUserTurns(event.messages)
    if (turns.get(key) !== turn) {
      turns.set(key, turn)
      streaks.delete(key)
    }
  })

  await ctx.permission.hook("evaluate", async (event: any) => {
    if (!event.agent) return
    if (event.effect === "deny") return
    const { keys } = await options.settings(event.agent)
    const max = Number(keys.max_tool_repeat)
    if (!Number.isInteger(max) || max < 1 || event.action === "task") return
    const key = String(event.sessionID)
    // Same tool AND same arguments: only then it is a repeat.
    const call = `${event.action}\u0000${(event.resources ?? []).join("\u0000")}`
    const prev = streaks.get(key)
    const count = prev && prev.call === call ? prev.count + 1 : 1
    streaks.set(key, { call, count })
    if (count <= max) return
    streaks.set(key, { call, count: 0 })
    event.effect = "deny"
    event.message = `You already used '${event.action}' the same way ${max} times in a row in this message. You are probably stuck in a doom loop. Try something else or report the issue to the user.`
    log(`repetition: tool denied action=${event.action} session=${key} count=${count} max=${max}`)
  })
}
