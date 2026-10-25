import path from "node:path"
import { spawn } from "node:child_process"
import { appendFileSync, existsSync } from "node:fs"
import { agentFile, BODY, frontmatter, problems, read, requestValue, TEMPLATE_KWARGS } from "./frontmatter"
import { isSafe } from "./safecommands"

// Runs a shell command (single or multi-line) and waits for it to finish.
// zsh so ~/.zshenv functions and aliases (like server-on) are available; falls back to sh.
function runShell(command: string) {
  const shell = existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh"
  return new Promise<void>((resolve) => {
    const child = spawn(shell, ["-c", command], { stdio: "ignore" })
    child.on("close", () => resolve())
    child.on("error", () => resolve())
  })
}

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

    // Debug line, written when AGENT_PLUS_DEBUG points to a log file.
    const debug = (line: string) => {
      const file = process.env.AGENT_PLUS_DEBUG
      if (file) try { appendFileSync(file, `${new Date().toISOString()} ${line}\n`) } catch {}
    }

    // `on_error_command`: when a request fails because the server is unreachable,
    // run the agent's command (e.g. wake it up) and ask for a quick retry.
    const woken = new Set<string>()
    await ctx.session.hook("retry", async (event: any) => {
      debug(`retry fired session=${event.sessionID} attempt=${event.attempt} error=${JSON.stringify(event.error)}`)
      const { keys } = await settings(event.agent)
      const command = keys.on_error_command
      if (!command) return
      // Only connection failures: a real HTTP answer has a status code.
      if (event.error?.status) return
      if (woken.has(event.sessionID)) return
      woken.add(event.sessionID)
      await runShell(command)
      event.decision = { retry: true, delay: 1_000 }
    })

    // Safe-command auto-allow is on for every agent; an agent turns it off with `safe_commands: none`.
    // It skips the ask window for read-only tool calls and safe shell commands.
    // Configured `deny` rules are final and never reach this hook; anything unsafe passes through unchanged.
    await ctx.permission.hook("evaluate", async (event: any) => {
      if (event.effect !== "ask" || !event.agent) return
      const { keys } = await settings(event.agent)
      if (keys.safe_commands === "none") return
      if (isSafe(event.action, event.resources ?? [])) event.effect = "allow"
    })

    await ctx.session.hook("context", async (event: any) => {
      // A request got through: allow on_error_command to fire again next time.
      woken.delete(event.sessionID)
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
