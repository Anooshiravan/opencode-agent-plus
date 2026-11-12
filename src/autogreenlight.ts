// Auto green light: with `auto_green_light: on`, the first tool call of each
// turn is judged by a hidden request (same session, not saved to history, like
// pondering). The model answers ALLOW or DISALLOW for the planned call.
// ALLOW -> the tool runs; the main model never sees the check.
// DISALLOW -> the tool is denied with the model's reason.
// One check per turn; a new user message re-arms it.
import { realUserTexts } from "./context"
import { log } from "./log"

export interface AutoGreenLightOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

// The hidden prompt. It runs in the same session, so the model sees the real
// conversation and the tool call it is about to make.
function judgePrompt(action: string, resources: string[]) {
  return [
    "SYSTEM CHECK, not from the user. Do not reply to the user.",
    `The agent is about to call the tool "${action}"${resources.length ? ` on: ${resources.join(", ")}` : ""}.`,
    "You need to make judgment:",
    "- Does the agent understand perfectly what the user intended?",
    "- Is the user question clear and unambiguous?",
    "- Is the tool call relevant to the question?",
    "- In case of doubt, did the model ask relevant questions?",
    "- Is the agent activity free of all assumptions or guesswork?",
    'If all the above checks are positive, answer: {"allow": true}',
    'Otherwise answer: {"allow": false, "reason": "why"}',
    "Answer with the JSON only, nothing else.",
  ].join("\n")
}

export async function autoGreenLight(ctx: any, options: AutoGreenLightOptions) {
  const lastUser = new Map<string, string>() // session -> latest real user message
  const checked = new Map<string, string>() // session -> message the check ran for

  await ctx.session.hook("context", async (event: any) => {
    const texts = realUserTexts(event.messages)
    lastUser.set(String(event.sessionID), texts[texts.length - 1] ?? "")
  })

  await ctx.permission.hook("evaluate", async (event: any) => {
    if (!event.agent) return
    const { keys } = await options.settings(event.agent)
    if (keys.auto_green_light !== "on") return
    // Reading files is always allowed; only acting needs the check.
    if (event.action === "read") return
    const sessionID = String(event.sessionID)
    const text = lastUser.get(sessionID) ?? ""
    if (checked.get(sessionID) === text) return // already judged this turn
    checked.set(sessionID, text)
    try {
      const { text: answer } = await ctx.session.generate({
        sessionID,
        prompt: judgePrompt(event.action, event.resources ?? []),
      })
      log(`autogreenlight: raw answer session=${sessionID} answer=${JSON.stringify(answer)}`)
      let verdict: { allow?: boolean; reason?: string } = {}
      try {
        verdict = JSON.parse(String(answer).replace(/^```json?\s*|\s*```$/g, "").trim())
      } catch {
        log(`autogreenlight: bad verdict session=${sessionID} answer=${JSON.stringify(String(answer).slice(0, 200))}`)
      }
      log(`autogreenlight: allow=${verdict.allow} action=${event.action} session=${sessionID}`)
      if (verdict.allow) return // tool runs; the check is not in history
      event.effect = "deny"
      event.message = `Auto green light: you disallowed this tool call. Reason: ${verdict.reason || "no reason given"}. Explain to the user why you cannot act, or ask them.`
    } catch (error) {
      log(`autogreenlight: judge failed session=${sessionID} error=${String(error)}`)
      // Doubtful = asked: let the normal permission flow handle it.
    }
  })
}
