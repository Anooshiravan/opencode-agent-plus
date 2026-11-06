import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { agentFile, BODY, frontmatter, problems, requestValue, TEMPLATE_KWARGS } from "./frontmatter"
import { appendBlock, reminderText } from "./context"
import { log } from "./log"
import { isSafe } from "./safecommands"
import { antiRepetition } from "./antirep"
import { antiLoop } from "./antiloop"
import { greenLight } from "./greenlight"

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
        if (found.length) log(`server: problems file=${file} found=${found.join("; ")}`)
      }
      return { file, keys }
    }

    log(`server: plugin loaded directory=${directory}`)

    // `on_error_command`: when a request fails because the server is unreachable,
    // run the agent's command (e.g. wake it up) and ask for a quick retry.
    const woken = new Set<string>()
    await ctx.session.hook("retry", async (event: any) => {
      log(`server: retry fired session=${event.sessionID} attempt=${event.attempt} error=${JSON.stringify(event.error)}`)
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

    // `anti_repetition: on` — interrupt the run when the model's text repeats itself.
    await antiRepetition(ctx, { settings })

    // `green_light: on` — deny tools unless the user's latest message ends with a go-ahead word.
    // Registered first so its deny wins and the anti-loop below does not count a denied call.
    await greenLight(ctx, { settings })

    // `max_same_tool: n` — deny a tool after n calls in a row within one user message.
    await antiLoop(ctx, { settings })

    await ctx.session.hook("context", async (event: any) => {
      // A request got through: allow on_error_command to fire again next time.
      woken.delete(event.sessionID)
      const { keys } = await settings(event.agent)
      const text = await reminderText(directory, keys)
      if (!text) return
      appendBlock(event, "system-reminder", text)
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
