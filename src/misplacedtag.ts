// `misplaced_tag_filter: on` — the server already splits the reply into
// `reasoning_content` (thinking) and `content` (message). Any tag sign that
// still shows up inside those fields is misplaced, so we swap it for a safe
// look-alike. Tool calls are left alone. When the message part was changed, a
// short note is appended so the user does not copy broken code.
import { log } from "./log"

export interface TagFilterOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

const NOTE = "\n\n[Note: some tag characters in this message were replaced with safe look-alikes. Do not copy/paste code from it.]"

// Sign → safe look-alike.
const SWAP: Record<string, string> = { "<": "＜", ">": "＞", "|": "｜" }

const swap = (value: string) => value.replace(/[<>|]/g, (c) => SWAP[c])

// The two fields we filter, by their JSON key.
const KEYS = ['"content":"', '"reasoning_content":"']

// Rewrites complete `"<key>":"<value>"` fields in `text`. Returns the processed
// part, the unfinished tail, and whether the message part was changed.
function filter(text: string): { out: string; rest: string; messageChanged: boolean } {
  let out = ""
  let messageChanged = false
  let i = 0
  for (;;) {
    // Find the nearest field key ahead.
    let at = -1
    let key = ""
    for (const k of KEYS) {
      const p = text.indexOf(k, i)
      if (p >= 0 && (at < 0 || p < at)) {
        at = p
        key = k
      }
    }
    if (at < 0) {
      // No key left; keep a tail so a key split across chunks is not missed.
      const keep = 24
      out += text.slice(i, Math.max(i, text.length - keep))
      return { out, rest: text.slice(Math.max(i, text.length - keep)), messageChanged }
    }
    out += text.slice(i, at)
    let j = at + key.length
    let value = ""
    let closed = false
    while (j < text.length) {
      const c = text[j]
      if (c === "\\") {
        if (j + 1 >= text.length) break
        value += c + text[j + 1]
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
    if (!closed) return { out, rest: text.slice(at), messageChanged }
    const swapped = swap(value)
    if (key === '"content":"' && swapped !== value) messageChanged = true
    out += key + swapped + '"'
    i = j
  }
}

export function filterResponse(response: Response): Response {
  if (!response.body) return response
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  let messageChanged = false

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const { out, rest, messageChanged: changed } = filter(pending + decoder.decode(chunk, { stream: true }))
      pending = rest
      messageChanged = messageChanged || changed
      if (out) controller.enqueue(encoder.encode(out))
    },
    flush(controller) {
      // Process whatever is left; emit the held tail as-is (stream is over).
      const { out, rest, messageChanged: changed } = filter(pending + decoder.decode())
      messageChanged = messageChanged || changed
      const final = out + rest
      if (final) controller.enqueue(encoder.encode(final))
      if (messageChanged) {
        const note = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: NOTE } }] })}\n\n`
        controller.enqueue(encoder.encode(note))
        log("misplaced_tag_filter: note appended")
      }
    },
  })

  return new Response(response.body.pipeThrough(stream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function misplacedTagFilter(ctx: any, options: TagFilterOptions) {
  return ctx.session.hook("http.response", async (event: any) => {
    const { keys } = await options.settings(event.agent)
    if (keys.misplaced_tag_filter !== "on") return
    log(`misplaced_tag_filter: http.response fired session=${event.sessionID} agent=${event.agent}`)
    event.response = filterResponse(event.response)
  })
}
