import path from "node:path"
import { agentFile, BODY, frontmatter, problems, read, requestValue, TEMPLATE_KWARGS } from "./frontmatter"

// Server half: adds the agent's reminders to every model request and its settings to the request body.
// The supported frontmatter keys are listed in frontmatter.ts and explained in README.md.
// Settings with a wrong value are not sent. Problems are logged once per agent; tui.tsx also shows them as a toast.
export default {
  id: "agent-plus",
  async setup(ctx: any) {
    const directory = ctx.location.directory
    const warned = new Set<string>()

    async function settings(agent: string) {
      const { file, text } = await agentFile(directory, agent)
      const keys = frontmatter(text)
      if (!warned.has(file)) {
        warned.add(file)
        const found = await problems(file, keys)
        if (found.length) console.warn(`agent-plus: problems in ${file}: ${found.join(", ")}`)
      }
      return { file, keys }
    }

    await ctx.session.hook("context", async (event: any) => {
      const { file, keys } = await settings(event.agent)
      const parts = [
        keys.reminder ?? "",
        keys.reminder_file ? await read(path.resolve(path.dirname(file), keys.reminder_file)) : "",
        await read(path.join(directory, "reminder.txt")),
      ]
      const text = parts.map((t) => t.trim()).filter(Boolean).join("\n\n")
      if (!text) return
      // Wrapped so the model does not take the reminder as a user message and reply to it.
      const wrapped = `<system-reminder>\nAutomatic note, not from the user. Do not reply to it.\n\n${text}\n</system-reminder>`
      // Plugins cannot import opencode's Message class (@opencode/ai), so borrow it from an existing message.
      const Message = event.messages[0].constructor
      event.messages.push(new Message({ role: "user", content: [{ type: "text", text: wrapped }] }))
    })

    await ctx.session.hook("http.request", async (event: any) => {
      const { keys } = await settings(event.agent)
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
  },
}
