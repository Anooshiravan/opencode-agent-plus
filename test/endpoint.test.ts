import { expect, test } from "bun:test"
import { httpRequest } from "../src/httprequest"

test("settings land in the request body sent to the server", async () => {
  const settings = async () => ({ keys: { temperature: "1", enable_thinking: "false" } })
  const event: any = { agent: "a", options: {} }
  await httpRequest(event, { settings })

  expect(event.options.temperature).toBe(1)
  expect(event.options.chat_template_kwargs).toEqual({ enable_thinking: false })
})
