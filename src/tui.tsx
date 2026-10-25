/** @jsxImportSource @opentui/solid */
import path from "node:path"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { agentFile, allAgentFiles, BODY, frontmatter, problems, read, requestValue } from "./frontmatter"

// At start, shows a warning toast for every agent .md file with problems, or a "loaded" toast when there are none.
// Adds an "Agent-plus" section to the sidebar with the agent-plus settings of the session's agent.
// The sidebar reads the agent file again when the session's agent changes or opencode reports an agent file change.
function sidebarLines(keys: Record<string, string>) {
  const lines = BODY.filter((k) => k in keys && "value" in requestValue(k, keys[k])).map((k) => `${k}: ${keys[k]}`)
  if (keys.enable_thinking === "true" || keys.enable_thinking === "false")
    lines.push(`thinking: ${keys.enable_thinking === "true" ? "on" : "off"}`)
  lines.push(`safe_commands: ${keys.safe_commands === "none" ? "off" : "on"}`)
  if (keys.reminder || keys.reminder_file) lines.push("reminder: on")
  if (keys.on_error_command)
    lines.push(`on_error_command: ${keys.on_error_command.split("\n")[0].trim()}${keys.on_error_command.includes("\n") ? " …" : ""}`)
  return lines
}

export default {
  id: "agent-plus",
  async setup(ctx: any) {
    const directory = ctx.location?.directory ?? process.cwd()
    let warned = false
    for (const file of await allAgentFiles(directory)) {
      const found = await problems(file, frontmatter(await read(file)))
      if (!found.length) continue
      warned = true
      ctx.ui.toast.show({
        title: "agent-plus",
        message: `Problems in ${path.basename(file)}:\n${found.join("\n")}`,
        variant: "warning",
        duration: 7000,
      })
    }
    if (!warned) ctx.ui.toast.show({ message: "agent-plus is loaded", variant: "info" })

    const [agentsVersion, setAgentsVersion] = createSignal(0)
    const stop = ctx.data.on("agent.updated", () => setAgentsVersion((v) => v + 1))

    ctx.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID: string }) => {
        const theme = ctx.theme
        const agent = createMemo(() => ctx.data.session.get(props.sessionID)?.agent)
        const [lines] = createResource(
          () => agent() && { agent: agent()!, version: agentsVersion() },
          async ({ agent }) => sidebarLines(frontmatter((await agentFile(directory, agent)).text)),
        )
        return (
          <Show when={lines()?.length}>
            <box>
              <text fg={theme.text.base}>
                <b>Agent-plus</b>
              </text>
              <For each={lines() ?? []}>{(line) => <text fg={theme.text.muted}>{line}</text>}</For>
            </box>
          </Show>
        )
      },
    })
    return stop
  },
}
