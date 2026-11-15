// `clockwork: on` — hands-off loop. Denies every permission ask, and after the
// agent finishes a turn it asks the LLM endpoint to write a fresh proactive
// message, then sends it so the agent keeps going. Only agents with
// `clockwork: on` are affected.
import { log } from "./log"

const FALLBACK =
  "Work autonomously. Decide for yourself, pick the option that best fits " +
  "the task and the surrounding code, and keep going. If the situation is " +
  "ambiguous, trust your feeling. Use all available tools to solve the task."

const META =
  "You are nudging an autonomous coding agent that just stopped. Write ONE " +
  "short imperative sentence telling it what to do next to keep making " +
  "progress. Do not greet, do not ask questions, do not repeat prior work. " +
  "Reply with that one sentence only."

export async function clockwork(ctx: any, { settings }: { settings: (agent: string) => Promise<{ keys: Record<string, string> }> }) {
  const shared = ((globalThis as any).__agentPlusClockwork ??= { running: new Set<string>(), denied: new Set<string>() })
  const running = shared.running as Set<string> // a keep-going prompt is in flight
  const denied = shared.denied as Set<string> // this turn had a denied ask

  // Deny every permission ask for clockwork agents.
  await ctx.permission.hook("evaluate", async (event: any) => {
    if (!event.agent) return
    const { keys } = await settings(event.agent)
    if (keys.clockwork !== "on") return
    if (event.effect !== "ask") return
    event.effect = "deny"
    event.message = "Clockwork: permission denied. Pick a different approach."
    denied.add(String(event.sessionID))
    log(`clockwork: denied ask session=${event.sessionID} action=${event.action}`)
  })

  // After each finished turn, ask the endpoint for a fresh nudge and send it.
  const controller = new AbortController()
  log(`clockwork: listener started`)
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      if (event.id === shared.lastEvent) continue
      shared.lastEvent = event.id
      if (event.type !== "session.execution.succeeded") continue
      const sessionID: string | undefined = event.data?.sessionID
      if (!sessionID || running.has(sessionID)) continue
      try {
        const session = await ctx.session.get({ sessionID })
        const { keys } = await settings(session.agent)
        if (keys.clockwork !== "on") continue
        running.add(sessionID)
        const wasDenied = denied.delete(sessionID)

        const { text: next } = await ctx.session.generate({ sessionID, prompt: META })
        const text = String(next).trim() || FALLBACK

        const final = wasDenied ? `Request is rejected. ${text}` : text
        log(`clockwork: continuing session=${sessionID} denied=${wasDenied} text=${final}`)
        await ctx.session.prompt({ sessionID, text: final, delivery: "steer" })
      } catch (error) {
        log(`clockwork: prompt failed session=${sessionID} error=${String(error)}`)
      } finally {
        running.delete(sessionID)
      }
    }
  })().catch((error) => log(`clockwork: listener died error=${String(error)}`))

  return () => controller.abort()
}
