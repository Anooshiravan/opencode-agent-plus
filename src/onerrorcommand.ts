// `on_error_command`: when a request fails because the server is unreachable,
// run the agent's command (e.g. wake it up) and ask for a quick retry.
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { log } from "./log"

export interface OnErrorCommandOptions {
  /** Reads the agent's frontmatter keys. */
  settings: (agent: string) => Promise<{ keys: Record<string, string> }>
}

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

export async function onErrorCommand(ctx: any, options: OnErrorCommandOptions) {
  const woken = new Set<string>()
  await ctx.session.hook("retry", async (event: any) => {
    log(`onerrorcommand: retry fired session=${event.sessionID} attempt=${event.attempt} error=${JSON.stringify(event.error)}`)
    const { keys } = await options.settings(event.agent)
    const command = keys.on_error_command
    if (!command) return
    // Only connection failures: a real HTTP answer has a status code.
    if (event.error?.status) return
    if (woken.has(event.sessionID)) return
    woken.add(event.sessionID)
    await runShell(command)
    event.decision = { retry: true, delay: 1_000 }
  })
  // Called from the context hook when a request got through: allow firing again.
  return (sessionID: string) => woken.delete(sessionID)
}
