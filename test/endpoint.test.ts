import { afterAll, beforeAll, expect, test } from "bun:test"
import { httpRequest } from "../src/httprequest"
import { startFakeLLM, type FakeLLM } from "./fake-llm"

let llm: FakeLLM
beforeAll(() => (llm = startFakeLLM()))
afterAll(() => llm.close())

// Minimal ctx: capture the http.request handler so we can fire it ourselves.
function fakeCtx() {
  const handlers: Record<string, (e: any) => Promise<void>> = {}
  return {
    handlers,
    session: { hook: async (name: string, fn: any) => (handlers[name] = fn) },
  }
}

test("settings land in the request body sent to the server", async () => {
  const ctx = fakeCtx()
  const settings = async () => ({ keys: { temperature: "1", enable_thinking: "false" } })
  await httpRequest(ctx as any, { settings })

  const event: any = {
    agent: "a",
    request: new Request(llm.url, {
      method: "POST",
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
    }),
  }
  await ctx.handlers["http.request"](event)
  await fetch(event.request) // send the mutated request to the fake server

  const sent = llm.requests[llm.requests.length - 1]
  expect(sent.temperature).toBe(1)
  expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false })
})
