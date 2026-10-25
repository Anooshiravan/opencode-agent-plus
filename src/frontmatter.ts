import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

// Shared by the server half (index.ts) and the TUI half (tui.tsx).
// Same rule as opencode: OPENCODE_CONFIG_DIR, else $XDG_CONFIG_HOME/opencode, else ~/.config/opencode (also on Windows).
const GLOBAL_DIR =
  process.env.OPENCODE_CONFIG_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "opencode")
export const BODY = [
  "temperature",
  "top_p",
  "top_k",
  "min_p",
  "presence_penalty",
  "repeat_penalty",
  "max_completion_tokens",
  "reasoning_budget_tokens",
  "reasoning_effort",
]
export const TEMPLATE_KWARGS = ["enable_thinking"]
const WHOLE_NUMBERS = ["top_k", "max_completion_tokens", "reasoning_budget_tokens"]
// Settings sent as text, with the values they accept.
const CHOICES: Record<string, string[]> = {
  reasoning_effort: ["none", "minimal", "low", "medium", "high", "xhigh"],
}
const OPENCODE_KEYS = [
  "description",
  "mode",
  "model",
  "system",
  "permissions",
  "steps",
  "hidden",
  "color",
  "disabled",
  "request",
]
const KNOWN = new Set([...OPENCODE_KEYS, "reminder", "reminder_file", "on_error_command", "safe_commands", ...BODY, ...TEMPLATE_KWARGS])

export const read = (file: string) => readFile(file, "utf8").catch(() => "")

// Agent folders in lookup order: the project's .opencode first, then the global folder; `agent` or `agents`.
function agentFolders(directory: string) {
  return [path.join(directory, ".opencode"), GLOBAL_DIR].flatMap((base) =>
    ["agent", "agents"].map((folder) => path.join(base, folder)),
  )
}

// Finds the agent's .md file.
export async function agentFile(directory: string, agent: string) {
  for (const folder of agentFolders(directory)) {
    const file = path.join(folder, `${agent}.md`)
    const text = await read(file)
    if (text) return { file, text }
  }
  return { file: "", text: "" }
}

// Lists every agent .md file, including subfolders (`team/reviewer.md` is agent `team/reviewer`).
export async function allAgentFiles(directory: string) {
  const files: string[] = []
  for (const folder of agentFolders(directory)) {
    const names = await readdir(folder, { recursive: true }).catch(() => [] as string[])
    files.push(...names.filter((n) => n.endsWith(".md")).map((n) => path.join(folder, n)))
  }
  return files
}

// Reads top-level `key: value` pairs as strings; `|` blocks are supported.
export function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const lines = match[1].split(/\r?\n/)
  const result: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].match(/^([\w-]+):\s*(.*)$/)
    if (!key) continue
    const value = key[2].trim()
    if (!value.startsWith("|")) {
      result[key[1]] = value.replace(/^(["'])(.*)\1$/, "$2")
      continue
    }
    const block: string[] = []
    while (i + 1 < lines.length && (!lines[i + 1].trim() || /^\s/.test(lines[i + 1]))) block.push(lines[++i])
    const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length))
    result[key[1]] = block.map((l) => l.slice(indent)).join("\n").trim()
  }
  return result
}

// Number of single-letter edits to turn `a` into `b`.
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

// Unknown keys that look like a misspelled known key, as "wrong → right".
// Other unknown keys are left alone: they may belong to another plugin.
export function misspelledKeys(keys: Record<string, string>) {
  return Object.keys(keys).flatMap((key) => {
    if (KNOWN.has(key)) return []
    const match = [...KNOWN].find((known) => {
      const d = distance(key, known)
      return d <= 2 && d < known.length / 3
    })
    return match ? [`${key} → ${match}`] : []
  })
}

// Converts a request setting to its JSON value, or gives an error text when the value is wrong.
export function requestValue(key: string, value: string): { value: number | boolean | string } | { error: string } {
  if (TEMPLATE_KWARGS.includes(key)) {
    if (value === "true" || value === "false") return { value: value === "true" }
    return { error: `${key}: must be true or false` }
  }
  if (key in CHOICES) {
    if (CHOICES[key].includes(value)) return { value }
    return { error: `${key}: must be one of ${CHOICES[key].join(", ")}` }
  }
  const number = Number(value)
  if (value === "" || Number.isNaN(number)) return { error: `${key}: must be a number` }
  if (WHOLE_NUMBERS.includes(key) && !Number.isInteger(number)) return { error: `${key}: must be a whole number` }
  return { value: number }
}

// Everything wrong in an agent file: misspelled keys, wrong values and a missing reminder_file.
export async function problems(file: string, keys: Record<string, string>) {
  const safeCommands =
    keys.safe_commands && !["allow", "none"].includes(keys.safe_commands)
      ? [`safe_commands: must be allow or none`]
      : []
  const wrong = [...BODY, ...TEMPLATE_KWARGS]
    .filter((k) => k in keys)
    .flatMap((k) => {
      const result = requestValue(k, keys[k])
      return "error" in result ? [result.error] : []
    })
  const missing =
    keys.reminder_file && !(await read(path.resolve(path.dirname(file), keys.reminder_file)))
      ? [`reminder_file: ${keys.reminder_file} not found or empty`]
      : []
  return [...misspelledKeys(keys), ...wrong, ...missing, ...safeCommands]
}
