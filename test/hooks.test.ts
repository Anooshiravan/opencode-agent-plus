import { expect, test } from "bun:test"
import { maxToolRepeat } from "../src/repetition"
import { manualGreenLight } from "../src/manualgreenlight"
import { appendBlock } from "../src/context"
import { conversation, mockCtx, user } from "./mock-ctx"

const settings = (keys: Record<string, string>) => async () => ({ keys })

test("anti-loop denies the call past the limit, resets on a new message", async () => {
  const ctx = mockCtx()
  await maxToolRepeat(ctx as any, { settings: settings({ max_tool_repeat: "2" }) })
  const evalCall = () => {
    const e = { agent: "a", action: "shell", resources: ["ls"], effect: "allow", sessionID: "s" }
    return ctx.permissionHandlers.evaluate(e).then(() => e.effect)
  }

  await ctx.sessionHandlers.context({ sessionID: "s", messages: conversation("loop-run") })
  expect(await evalCall()).toBe("allow")
  await evalCall()
  const denied = { agent: "a", action: "shell", resources: ["ls"], effect: "allow", sessionID: "s" }
  await ctx.permissionHandlers.evaluate(denied)
  expect(denied.effect).toBe("deny")
})

test("manual green light denies until the message ends with a go word", async () => {
  const ctx = mockCtx()
  await manualGreenLight(ctx as any, { settings: settings({ manual_green_light: "on" }) })
  await ctx.sessionHandlers.context({ sessionID: "s", messages: conversation("greenlight-ask") })
  const denied = { agent: "a", action: "shell", resources: ["ls"], effect: "ask", sessionID: "s" }
  await ctx.permissionHandlers.evaluate(denied)
  expect(denied.effect).toBe("deny")

  await ctx.sessionHandlers.context({ sessionID: "s", messages: conversation("greenlight-go") })
  const allowed = { agent: "a", action: "shell", resources: ["ls"], effect: "ask", sessionID: "s" }
  await ctx.permissionHandlers.evaluate(allowed)
  expect(allowed.effect).toBe("ask")
})

test("context blocks append after the user message, in hook order", () => {
  const event: any = { messages: [user("hello")] }
  // Same order as index.ts: pondering hook first, then the reminder hook.
  appendBlock(event, "pondering", "p")
  appendBlock(event, "system-reminder", "r")
  const tags = event.messages.map((m: any) => m.content[0].text)
  expect(tags[0]).toBe("hello")
  expect(tags[1]).toContain("<pondering>")
  expect(tags[2]).toContain("<system-reminder>")
})
