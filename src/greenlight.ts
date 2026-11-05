// Green light: with `green_light: on`, every tool is denied unless the user's
// latest message ends with a green-light word (in its last 3 words), e.g.
// "fix the config, go". The agent must ask, the user must approve.
// Everything stays in memory; nothing is sent to the server.
import { realUserTexts } from "./antiloop"

export interface GreenLightOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
  /** Optional debug logger. */
  debug?: (line: string) => void
}

// Words that mean "you may act", checked in the last 3 words of the message.
// Agents replace the list with `green_light_words: yes, go, do`.
const DEFAULT_GREEN_LIGHT_WORDS = ["yes", "do", "go", "ok", "okay", "fine", "good", "fix", "try", "run"]

// Resolves `green_light_words` to the effective word list and its match test.
function greenLightWords(words: string | undefined): { list: string[]; test: RegExp } {
  const list = words?.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean)
  const safe = list?.length ? list : DEFAULT_GREEN_LIGHT_WORDS
  return { list: safe, test: new RegExp(`\\b(${safe.map((w) => w.replace(/[^\w-]/g, "")).join("|")})\\b`, "i") }
}

export async function greenLight(ctx: any, options: GreenLightOptions) {
  // Per session: the user's latest real message text.
  const lastUser = new Map<string, string>()

  await ctx.session.hook("context", async (event: any) => {
    const texts = realUserTexts(event.messages)
    lastUser.set(String(event.sessionID), texts[texts.length - 1] ?? "")
  })

  await ctx.permission.hook("evaluate", async (event: any) => {
    if (!event.agent) return
    const { keys } = await options.settings(event.agent)
    if (keys.green_light !== "on") return
    // Reading files is always allowed; only acting needs the word.
    if (event.action === "read") return
    const text = lastUser.get(String(event.sessionID)) ?? ""
    const tail = text.trim().split(/\s+/).slice(-3).join(" ")
    const { list, test } = greenLightWords(keys.green_light_words)
    if (test.test(tail)) return
    event.effect = "deny"
    event.message = `Green light is on: tools run only when the user's message ends with a green-light word (${list.join(", ")}). Ask the user to approve, or answer without tools.`
    options.debug?.(`green-light: denied ${event.action} session=${String(event.sessionID)} tail=${JSON.stringify(tail)}`)
  })
}
