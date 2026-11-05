// Anti-repetition: watches the model's reply stream and interrupts the
// session when the text starts repeating itself (e.g. "parameter=parameter=...").
// Enabled per agent with `anti_repetition: on` in its frontmatter.
import { scanResponse } from "./stream"
import type { RepetitionHit } from "./detect"

export interface AntiRepetitionOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
  /** Optional debug logger. */
  debug?: (line: string) => void
}

export function antiRepetition(ctx: any, options: AntiRepetitionOptions) {
  return ctx.session.hook("http.response", async (event: any) => {
    const { keys } = await options.settings(event.agent)
    if (keys.anti_repetition !== "on") return
    options.debug?.(`anti-repetition: http.response fired session=${event.sessionID} agent=${event.agent}`)
    const sessionID = event.sessionID
    const stop = (hit: RepetitionHit) => {
      options.debug?.(
        `anti-repetition: session=${sessionID} unit=${JSON.stringify(hit.unit)} times=${hit.times} -> interrupt`,
      )
      // Fire once per reply; the interrupt ends the run.
      ctx.session.interrupt({ sessionID }).catch(() => {})
    }
    event.response = scanResponse(event.response, { onHit: stop, debug: options.debug })
  })
}
