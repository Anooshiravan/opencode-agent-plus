// `pondering: on` — when a session goes idle, run one transient generate
// request in it (opencode's own API: same context, not saved to history)
// asking the model to ponder where the conversation is going. The result is
// appended to the user's next message as a <pondering> block, used silently.
import path from "node:path"
import { readFileSync, writeFileSync } from "node:fs"
import { folder, log } from "./log"
import { appendBlock } from "./context"

// Small file the TUI sidebar watches to show pondering: busy/idle.
// Content is a JSON map: { sessionID: "busy" | "idle" }.
const statusFile = path.join(folder, "pondering.status")
function setStatus(sessionID: string, state: "busy" | "idle", note = "") {
  try {
    const map = JSON.parse(readFileSync(statusFile, "utf8")) as Record<string, { state: string; note: string }>
    map[sessionID] = { state, note }
    writeFileSync(statusFile, JSON.stringify(map))
  } catch {
    writeFileSync(statusFile, JSON.stringify({ [sessionID]: { state, note } }))
  }
}

const NOTE = [
  "This is a pondering request (like a chess engine's permanent brain) to think ahead and improve future replies.",
  "Read your last reply only. If there is nothing useful to note (a greeting, a yes/no answer), reply with exactly: SKIP",
  "Otherwise write a short note, one line per point, only what applies.",
  "1. Claims you did not verify: quote each one, if any.",
  "2. Anything left unfinished.",
  "3. What the user will likely ask next.",
  "4. One thing to check first, and how.",
  "5. Did you understand the user's intent, or miss something?",
  "6. Anything you are stuck on, or want to ask the user.",
  "7. Any other useful note.",
].join("\n")

export async function pondering(ctx: any, { settings }: { settings: (agent: string) => Promise<{ keys: Record<string, string> }> }) {
  const shared = ((globalThis as any).__agentPlusPondering ??= { busy: new Set<string>(), done: new Set<string>() })
  shared.ready ??= new Map<string, string>() // backfill when an older load created the object
  const busy = shared.busy as Set<string> // a ponder is running for this session
  const done = shared.done as Set<string> // this session already pondered this turn
  const ready = shared.ready as Map<string, string> // shared: any copy's hook can inject the note

  const controller = new AbortController()
  log(`pondering: listener started`)
  void (async () => {
    // Events arrive as { type, data: {...} }; the session ID is in data.
    // session.idle is never emitted by the server; the real "run finished"
    // event is session.execution.succeeded (payload { sessionID }).
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      const sessionID: string | undefined = event.data?.sessionID
      // Every plugin copy sees every event. Handle each event exactly once,
      // in the first copy that gets to it; the rest skip.
      if (event.id === shared.lastEvent) continue
      shared.lastEvent = event.id
      if (event.type === "session.inbox.enqueued") {
        // The NOTE we sent via session.generate arrives as a user message.
        // Ignore it so it does not clear `done` and re-arm pondering.
        if (event.data?.item?.payload?.text === NOTE) {
          log(`pondering: swallowed own NOTE session=${sessionID}`)
          continue
        }
        log(`pondering: enqueued session=${sessionID}`)
        done.delete(sessionID) // the user sent a message, so done is cleared and the session can ponder again
        continue
      }
      if (event.type !== "session.execution.succeeded") continue
      log(`pondering: event type=${event.type} session=${sessionID}`)
      if (!sessionID || busy.has(sessionID) || done.has(sessionID)) continue
      busy.add(sessionID) // claim now, before any await, so the other copies skip
      try {
        const session = await ctx.session.get({ sessionID })
        const { keys } = await settings(session.agent)
        if (keys.pondering !== "on") {
          busy.delete(sessionID)
          continue
        }
        log(`pondering: start session=${sessionID} agent=${session.agent}`)
        setStatus(sessionID, "busy")
        const { text } = await ctx.session.generate({ sessionID, prompt: NOTE })
        let trimmed = String(text).trim()
        if (trimmed === "SKIP") trimmed = "" // the model found nothing worth noting
        setStatus(sessionID, "idle", trimmed) // sidebar shows the raw note (troubleshooting)
        if (trimmed) {
          ready.set(sessionID, trimmed)
          log(`pondering: done session=${sessionID} chars=${trimmed.length} text=${trimmed}`)
        } else {
          log(`pondering: discarded session=${sessionID} text=${trimmed}`)
        }
        busy.delete(sessionID)
        done.add(sessionID) // one ponder per user message
      } catch (error) {
        setStatus(sessionID, "idle")
        busy.delete(sessionID)
        done.add(sessionID) // even a failed ponder counts for this turn
        log(`pondering: failed session=${sessionID} error=${String(error)}`)
      }
    }
  })().catch((error) => log(`pondering: listener died error=${String(error)}`))

  // Inject the stored pondering into the next real model request of the session
  // (generate uses its own hook, so this only runs for real turns).
  await ctx.session.hook("context", async (event: any) => {
    const text = ready.get(event.sessionID)
    if (!text) return
    ready.delete(event.sessionID)
    setStatus(event.sessionID, "idle") // the sidebar note is consumed with this message
    appendBlock(event, "pondering", text, "Automatic pondering note, not from the user. The assistant pondered during idle time; these are its notes. Do not reply to it, but use it silently when answering.")
  })

  return () => controller.abort()
}
