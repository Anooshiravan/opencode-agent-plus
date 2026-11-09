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
function setStatus(sessionID: string, state: "busy" | "idle") {
  try {
    const map = JSON.parse(readFileSync(statusFile, "utf8")) as Record<string, string>
    map[sessionID] = state
    writeFileSync(statusFile, JSON.stringify(map))
  } catch {
    writeFileSync(statusFile, JSON.stringify({ [sessionID]: state }))
  }
}

const NOTE = [
  "This is not a user message. Never reply to it. Output only pondering notes.",
  "You are pondering during idle time, not answering the user.",
  "Do not greet, do not answer, just ponder.",
  "Your output must start with 'Retrospective:' — nothing else.",
  "",
  "1. Retrospective — what did the assistant's last 3 answers get wrong",
  "(not the whole session): guessing, needless tools, ignored instructions,",
  "padding? Say it in",
  'second person: "You guessed instead of asking...".',
  "2. Trajectory prediction — what will the user likely ask or say next?",
  "3. Preparation — what to check or verify before answering it?",
].join("\n")

export async function pondering(ctx: any, { settings }: { settings: (agent: string) => Promise<{ keys: Record<string, string> }> }) {
  const ready = new Map<string, string>() // sessionID -> pondered text, waiting for the next user message
  // The server loads this plugin once per open folder, all in one process, so
  // every copy would ponder the same session. They share these two sets
  // through globalThis: the first copy to claim a session ponders, the rest
  // see the claim and skip. Cleared when the user sends the next message.
  const shared = ((globalThis as any).__agentPlusPondering ??= { busy: new Set<string>(), done: new Set<string>() })
  const busy = shared.busy as Set<string> // a ponder is running for this session
  const done = shared.done as Set<string> // this session already pondered this turn

  const controller = new AbortController()
  log(`pondering: listener started`)
  void (async () => {
    // Events arrive as { type, data: {...} }; the session ID is in data.
    // session.idle is never emitted by the server; the real "run finished"
    // event is session.execution.succeeded (payload { sessionID }).
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      const sessionID: string | undefined = event.data?.sessionID
      if (event.type === "session.inbox.enqueued") {
        const dup = shared.lastEnqueued === event.id // the other copies see the same event
        shared.lastEnqueued = event.id
        log(`pondering: enqueued session=${sessionID}${dup ? " (duplicate)" : ""}`)
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
        const trimmed = String(text).trim()
        if (trimmed.startsWith("Retrospective:")) {
          ready.set(sessionID, trimmed)
          log(`pondering: done session=${sessionID} chars=${trimmed.length}`)
        } else {
          log(`pondering: discarded session=${sessionID} text=${trimmed.slice(0, 80)}`)
        }
        setStatus(sessionID, "idle")
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
    appendBlock(event, "pondering", text, "Automatic pondering note, not from the user. The assistant pondered during idle time; these are its notes. Do not reply to it, but use it silently when answering.")
  })

  return () => controller.abort()
}
