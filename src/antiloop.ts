// Anti-loop: denies a tool after `max_same_tool` calls in a row within ONE
// user message. The count resets when the user sends a new message, so a
// long multi-step task is never punished.
// The count lives in memory only; nothing is sent to the server.
export interface AntiLoopOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
  /** Optional debug logger. */
  debug?: (line: string) => void
}

// Real user messages only: skips injections wrapped in <system-reminder>
// (ours and other plugins').
export function realUserTexts(messages: any[]): string[] {
  const texts: string[] = []
  for (const m of messages) {
    if (m.role !== "user") continue
    const parts = m.content ?? m.parts ?? []
    const text = parts.map((p: any) => p.text ?? "").join("")
    if (text.trimStart().startsWith("<system-reminder>")) continue
    texts.push(text)
  }
  return texts
}

function countUserTurns(messages: any[]): number {
  return realUserTexts(messages).length
}

export async function antiLoop(ctx: any, options: AntiLoopOptions) {
  // Per session: the tool last called and how many times in a row.
  const streaks = new Map<string, { action: string; count: number }>()
  // Per session: how many real user messages were seen last time.
  const turns = new Map<string, number>()

  // The context hook runs before every model call: a new user message means
  // the streak from the previous message no longer counts.
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
    // A call already denied (green light runs first) never ran: do not count it.
    if (event.effect === "deny") return
    const { keys } = await options.settings(event.agent)
    const max = Number(keys.max_same_tool)
    if (!Number.isInteger(max) || max < 1 || event.action === "task") return
    const key = String(event.sessionID)
    const prev = streaks.get(key)
    const count = prev && prev.action === event.action ? prev.count + 1 : 1
    streaks.set(key, { action: event.action, count })
    if (count <= max) return
    // Reset so the agent gets a fresh budget after being denied once.
    streaks.set(key, { action: event.action, count: 0 })
    event.effect = "deny"
    event.message = `You already used '${event.action}' ${max} times in a row in this message. You are probably stuck in a doom loop. Try something else or report the issue to the user.`
    options.debug?.(`anti-loop: denied ${event.action} session=${key} count=${count} max=${max}`)
  })
}

