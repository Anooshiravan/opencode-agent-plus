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
  "STOP what you are doing, we need to work better.",
  "Before we go on, write me a note with exactly these three parts:",
  "Retrospective: what did your last 3 answers get wrong (not the whole",
  "session): e.g. guessing, needless tools, ignored instructions, padding? Say it",
  'in second person: "You guessed instead of asking...".',
  "Trajectory prediction: what will I likely ask or say next?",
  "Preparation: things that you should check or verify before answering me.",
  "Answer now with the real note, not the template. Example of the shape:",
  "Retrospective: You guessed the fix without checking the log first.",
  "Trajectory prediction: The user will ask for a commit.",
  "Preparation: Run git status before committing.",
].join("\n")

// Flatten the last 10 user/assistant messages into one text block.
function flatten(messages: any[]): string {
  const rows: string[] = []
  for (const m of messages.slice(-20)) {
    const role = m.type ?? m.info?.role
    if (role !== "user" && role !== "assistant") continue
    const parts = m.data?.content ?? m.content ?? []
    const text = Array.isArray(parts)
      ? parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join("\n")
      : String(parts)
    if (text.trim()) rows.push(`${role}: ${text.trim().slice(0, 2000)}`)
  }
  return rows.join("\n\n")
}

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
        if (!trimmed.startsWith("Retrospective:")) {
          log(`pondering: retry session=${sessionID} text=${trimmed}`)
          const retry = await ctx.session.generate({
            sessionID,
            prompt: [
              "That was not the note. I am asking you to actually write it now, about our",
              "real conversation above. Start your reply with \"Retrospective:\" and fill in",
              "all three parts with specifics from this session.",
            ].join("\n"),
          })
          trimmed = String(retry.text).trim()
        }
        setStatus(sessionID, "idle", trimmed) // sidebar shows any reply, gate or not (troubleshooting)
        if (trimmed.startsWith("Retrospective:")) {
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
