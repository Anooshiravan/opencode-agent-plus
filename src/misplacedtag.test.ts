import { expect, test } from "bun:test"
import { filterResponse } from "./misplacedtag"

// Runs the filter over fake SSE chunks and returns the output text.
async function run(chunks: string[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c))
      controller.close()
    },
  })
  const out = await filterResponse(new Response(body)).text()
  return out
}

const chunk = (field: string, value: string) =>
  `data: {"choices":[{"index":0,"delta":{"${field}":"${value}"}}]}\n\n`

test("swaps tag signs in content", async () => {
  const out = await run([chunk("content", "a <|end|> b")])
  expect(out).toContain("a ＜｜end｜＞ b")
  expect(out).toContain("safe look-alikes")
})

test("swaps tag signs in reasoning_content, no note", async () => {
  const out = await run([chunk("reasoning_content", "x <|think|> y")])
  expect(out).toContain("x ＜｜think｜＞ y")
  expect(out).not.toContain("safe look-alikes")
})

test("leaves tool_calls alone", async () => {
  const out = await run([`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"{\\"a\\": 1<2}"}}]}}]}\n\n`])
  expect(out).toContain("1<2")
})

test("handles a field split across chunks", async () => {
  const full = chunk("content", "a <|end|> b")
  const cut = full.indexOf("<|")
  const out = await run([full.slice(0, cut), full.slice(cut)])
  expect(out).toContain("a ＜｜end｜＞ b")
})

test("clean text passes through unchanged", async () => {
  const out = await run([chunk("content", "plain text")])
  expect(out).toContain("plain text")
  expect(out).not.toContain("safe look-alikes")
})
