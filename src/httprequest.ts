// Request settings: adds the agent's sampling settings to the model request.
// Supported keys are listed in frontmatter.ts; a setting with a wrong value is not sent.
import { BODY, TEMPLATE_KWARGS, requestValue } from "./frontmatter"
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
  const kwargs: Record<string, boolean> = {}
  for (const k of TEMPLATE_KWARGS) {
    if (!(k in keys)) continue
    const result = requestValue(k, keys[k])
    if ("value" in result) kwargs[k] = result.value as boolean
  }
  if (Object.keys(kwargs).length) extra.chat_template_kwargs = kwargs as any
  log(`httprequest: agent=${event.agent} extra=${JSON.stringify(extra)}`)
  event.options = { ...event.options, ...extra }
}
