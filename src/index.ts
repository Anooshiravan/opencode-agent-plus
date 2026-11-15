import { agentFile, frontmatter, problems } from "./frontmatter"
import { appendBlock, reminderText } from "./context"
import { log } from "./log"
import { isSafeToolCall } from "./safetoolcall"
import { maxWordRepeat, maxToolRepeat } from "./repetition"
import { manualGreenLight } from "./manualgreenlight"
import { autoGreenLight } from "./autogreenlight"
import { onErrorCommand } from "./onerrorcommand"
import { httpRequest } from "./httprequest"
import { pondering } from "./pondering"
import { misplacedTagFilter } from "./misplacedtag"
import { clockwork } from "./clockwork"

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

    log(`server: plugin loaded directory=${directory} pid=${process.pid} module=${import.meta.url}`)

    // `on_error_command`: wake the server on a connection failure, then retry.
    const allowWake = await onErrorCommand(ctx, { settings })

    // Safe-command auto-allow is on for every agent; an agent turns it off with `safe_commands: none`.
    // It skips the ask window for read-only tool calls and safe shell commands.
    // Configured `deny` rules are final and never reach this hook; anything unsafe passes through unchanged.
    await ctx.permission.hook("evaluate", async (event: any) => {
      if (event.effect !== "ask" || !event.agent) return
      const { keys } = await settings(event.agent)
      if (keys.safe_commands === "none") return
      if (isSafeToolCall(event.action, event.resources ?? [])) event.effect = "allow"
    })

    // `max_word_repeat: on` — interrupt the run when the model's text repeats itself.
    await maxWordRepeat(ctx, { settings })

    // `manual_green_light: on` — deny tools unless the user's latest message ends with a go-ahead word.
    // Registered first so its deny wins and the anti-loop below does not count a denied call.
    await manualGreenLight(ctx, { settings })

    // `auto_green_light: on` — the model checks itself before the first tool call of each turn.
    await autoGreenLight(ctx, { settings })

    // `max_tool_repeat: n` — deny a tool after n calls in a row within one user message.
    await maxToolRepeat(ctx, { settings })

    // `pondering: on` — think during idle time; the result rides into the next user message.
    await pondering(ctx, { settings })

    // `misplaced_tag_filter: on` — swap stray tag signs in thinking/message text for safe look-alikes.
    await misplacedTagFilter(ctx, { settings })

    // `clockwork: on` — deny all asks and keep the agent going on its own.
    await clockwork(ctx, { settings })

    await ctx.session.hook("context", async (event: any) => {
      // A request got through: allow on_error_command to fire again next time.
      allowWake(event.sessionID)
      const { keys } = await settings(event.agent)
      await httpRequest(event, { settings })
      const text = await reminderText(directory, keys)
      if (!text) return
      appendBlock(event, "system-reminder", text)
    })
  },
}
