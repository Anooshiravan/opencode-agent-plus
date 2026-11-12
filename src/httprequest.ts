// Request settings: adds the agent's sampling settings to the model request.
// Supported keys are listed in frontmatter.ts; a setting with a wrong value is not sent.
import { BODY, requestValue } from "./frontmatter"
import { log } from "./log"

export interface HttpRequestOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

export async function httpRequest(event: any, options: HttpRequestOptions) {
  const { keys } = await options.settings(event.agent)
  const extra: Record<string, number | string> = {}
  for (const k of BODY) {
    if (!(k in keys)) continue
    const result = requestValue(k, keys[k])
    if ("value" in result) extra[k] = result.value as number | string
  }
  log(`httprequest: agent=${event.agent} extra=${JSON.stringify(extra)}`)
  event.options = { ...event.options, ...extra }
}
