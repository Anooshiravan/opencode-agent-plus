// Request-body settings: adds the agent's sampling settings to every model request.
// Supported keys are listed in frontmatter.ts; a setting with a wrong value is not sent.
import { BODY, requestValue, TEMPLATE_KWARGS } from "./frontmatter"

export interface HttpRequestOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

export async function httpRequest(ctx: any, options: HttpRequestOptions) {
  await ctx.session.hook("http.request", async (event: any) => {
    const { keys } = await options.settings(event.agent)
    const pick = (names: string[]) =>
      Object.fromEntries(
        names.flatMap((k) => {
          if (!(k in keys)) return []
          const result = requestValue(k, keys[k])
          return "value" in result ? [[k, result.value]] : []
        }),
      )
    const extra = pick(BODY)
    const kwargs = pick(TEMPLATE_KWARGS)
    if (!Object.keys(extra).length && !Object.keys(kwargs).length) return
    const body = await event.request.clone().json()
    if (Object.keys(kwargs).length) extra.chat_template_kwargs = { ...body.chat_template_kwargs, ...kwargs }
    event.request = new Request(event.request, { body: JSON.stringify({ ...body, ...extra }) })
  })
}
