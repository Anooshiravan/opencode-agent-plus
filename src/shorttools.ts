// Owns the `short_tools` setting: replaces tool descriptions with shorter ones
// from a JSON file next to the agent file, e.g. `short_tools: short-tools.json`.
// Replacements are byte-stable (same file, same output every request), so the
// provider prompt cache is rebuilt once and then keeps hitting.
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { log } from "./log"

// Parsed JSON per file, re-read only when the file changes on disk.
const cache = new Map<string, { mtimeMs: number; map: Record<string, string> }>()

async function load(file: string): Promise<Record<string, string> | undefined> {
  const info = await stat(file).catch(() => undefined)
  if (!info) {
    log(`short_tools: file not found ${file}`)
    return undefined
  }
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === info.mtimeMs) return hit.map
  let map: Record<string, string>
  try {
    map = JSON.parse(await readFile(file, "utf8"))
  } catch (e) {
    log(`short_tools: bad JSON ${file}: ${e}`)
    return undefined
  }
  cache.set(file, { mtimeMs: info.mtimeMs, map })
  log(`short_tools: loaded ${file} tools=${Object.keys(map).join(",")}`)
  return map
}

// Swap in the short descriptions for the tools listed in the file.
// Tools not listed (e.g. skill) keep their original description.
export async function shortTools(event: any, opts: { settings: (agent: string) => Promise<{ file: string; keys: Record<string, string> }> }) {
  const { keys, file } = await opts.settings(event.agent)
  if (!keys.short_tools) return
  if (!file) return
  const map = await load(path.join(path.dirname(file), keys.short_tools))
  if (!map) return
  for (const [name, description] of Object.entries(map)) {
    const tool = event.tools[name]
    if (tool && typeof description === "string") tool.description = description
  }
}
