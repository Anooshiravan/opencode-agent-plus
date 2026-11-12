/** @jsxImportSource @opentui/solid */
import path from "node:path"
import { readFileSync, unwatchFile, watchFile } from "node:fs"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { agentFile, allAgentFiles, BODY, frontmatter, problems, read, requestValue } from "./frontmatter"
import { folder, log } from "./log"
import { reminderPreset } from "./presets"

// At start, shows a warning toast for every agent .md file with problems, or a "loaded" toast when there are none.
// Adds an "Agent-plus" section to the sidebar with the agent-plus settings of the session's agent.
// The sidebar reads the agent file again when the session's agent changes or opencode reports an agent file change.
const onOff = (v: string | undefined, on = "on") => (v === on ? "on" : "off")

function sidebarLines(keys: Record<string, string>) {
  const lines: string[] = []
  const reminder = reminderPreset(keys.reminder ?? "")
  lines.push(reminder ? `reminder: ${keys.reminder}` : "reminder: off")
  lines.push(`safe_commands: ${keys.safe_commands === "none" ? "off" : "on"}`)
  lines.push(`max_word_repeat: ${onOff(keys.max_word_repeat)}`)
  lines.push(`max_tool_repeat: ${keys.max_tool_repeat || "off"}`)
  lines.push(
    `on_error_command: ${keys.on_error_command ? keys.on_error_command.split("\n")[0].trim() + (keys.on_error_command.includes("\n") ? " …" : "") : "off"}`,
  )
  lines.push(`manual_green_light: ${onOff(keys.manual_green_light)}`)
  lines.push(`auto_green_light: ${onOff(keys.auto_green_light)}`)
  lines.push(`pondering: ${onOff(keys.pondering)}`)
  if ("reasoning_effort" in keys && "value" in requestValue("reasoning_effort", keys.reasoning_effort))
    lines.push(`reasoning_effort: ${keys.reasoning_effort}`)
  for (const k of BODY) {
    if (k === "reasoning_effort" || !(k in keys)) continue
    const result = requestValue(k, keys[k])
    if ("value" in result) lines.push(`${k}: ${keys[k]}`)
    else lines.push(`${k}: ${keys[k]} (ERR: out of range!)`)
  }
  if (keys.enable_thinking === "true" || keys.enable_thinking === "false")
    lines.push(`thinking: ${keys.enable_thinking === "true" ? "on" : "off"}`)
  return lines
}

export default {
  id: "agent-plus",
  async setup(ctx: any) {
    const directory = ctx.location?.directory ?? process.cwd()
    log(`tui: setup directory=${directory} toast=${typeof ctx.ui?.toast?.show}`)
    let warned = false
    for (const file of await allAgentFiles(directory)) {
      const found = await problems(file, frontmatter(await read(file)))
      if (!found.length) continue
      warned = true
      log(`tui: toast warning file=${file} problems=${found.join("; ")}`)
      ctx.ui.toast.show({
        title: "agent-plus",
        message: `Problems in ${path.basename(file)}:\n${found.join("\n")}`,
        variant: "warning",
        duration: 7000,
      })
    }
    if (!warned) {
      log("tui: toast loaded")
      ctx.ui.toast.show({ message: "agent-plus is loaded", variant: "info" })
    }

    const [agentsVersion, setAgentsVersion] = createSignal(0)
    const stop = ctx.data.on("agent.updated", () => setAgentsVersion((v) => v + 1))

    // Live pondering state written by the server plugin: { sessionID: "busy" | "idle" }
    const statusFile = path.join(folder, "pondering.status")
    const [statuses, setStatuses] = createSignal<Record<string, string>>({})
    const readStatus = () => {
      try {
        setStatuses(JSON.parse(readFileSync(statusFile, "utf8")))
      } catch {}
    }
    watchFile(statusFile, { interval: 300 }, readStatus)
    const [frame, setFrame] = createSignal(0) // spinner frame counter
    const timer = setInterval(() => setFrame((f) => f + 1), 80)

    ctx.ui.slot({
      append: "sidebar.content",
      render: (props: { sessionID: string }) => {
        const theme = ctx.theme
        const agent = createMemo(() => ctx.data.session.get(props.sessionID)?.agent)
        const [lines] = createResource(
          () => agent() && { agent: agent()!, version: agentsVersion() },
          async ({ agent }) => sidebarLines(frontmatter((await agentFile(directory, agent)).text)),
        )
        // Live line: spinner while pondering, "on (idle)" when enabled and done, "off" when disabled.
        const shown = createMemo(() => {
          const ls = lines() ?? []
          if (!ls.includes("pondering: on")) return ls
          const st = statuses()[props.sessionID]
          const busy = st?.state === "busy"
          const text = busy ? `pondering: ${"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[frame() % 10]}` : "pondering: on (idle)"
          const out = ls.map((l) => (l === "pondering: on" ? text : l))
          if (!busy && st?.note) out.push("", "Pondering:", ...String(st.note).split("\n"))
          return out
        })
        return (
          <Show when={shown().length}>
            <box>
              <text fg={theme.text.base}>
                <b>Agent-plus</b>
              </text>
              <For each={shown()}>
                {(line) =>
                  line === "Pondering:" ? (
                    <text fg={theme.text.base}>
                      <b>Pondering:</b>
                    </text>
                  ) : (
                    <text fg={theme.text.muted}>{line}</text>
                  )
                }
              </For>
            </box>
          </Show>
        )
      },
    })
    return () => {
      clearInterval(timer)
      unwatchFile(statusFile, readStatus)
      stop()
    }
  },
}
