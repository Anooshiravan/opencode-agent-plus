// Fake OpenAI-compatible server for endpoint tests. Streams only (SSE), like OpenCode expects.
// Records every request body it receives; replies with a canned completion split into chunks.
// Started once before the tests, closed after.

export interface FakeLLM {
  url: string
  requests: any[]
  close: () => void
}

export function startFakeLLM(port = 4599): FakeLLM {
  const requests: any[] = []
  const server = Bun.serve({
    port,
    async fetch(req) {
      const body = await req.json().catch(() => ({}))
      requests.push(body)
      const text = body.__reply ?? "ok"
      const chunk = (content: string, done = false) =>
        `data: ${JSON.stringify({
          id: "1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: done ? {} : { content }, finish_reason: done ? "stop" : null }],
        })}\n\n`
      const stream = new ReadableStream({
        async start(c) {
          for (const piece of text.match(/.{1,8}/g) ?? []) {
            c.enqueue(chunk(piece))
            await new Promise((r) => setTimeout(r, 10))
          }
          c.enqueue(chunk("", true))
          c.enqueue("data: [DONE]\n\n")
          c.close()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { url: `http://localhost:${port}/v1/chat/completions`, requests, close: () => server.stop(true) }
}
