// Owns the `tools_override` setting: replaces tool descriptions with shorter
// ones from a JSON file named in the agent frontmatter (always next to the
// agent file). Off unless the key is set.
// Replacements are byte-stable (same file, same output every request), so the
// provider prompt cache is rebuilt once and then keeps hitting.
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { log } from "./log"

// Parsed JSON per file, re-read only when the file changes on disk.
const cache = new Map<string, { mtimeMs: number; map: Record<string, string> }>()

async function load(file: string): Promise<Record<string, string> | undefined> {
  const info = await stat(file).catch(() => undefined)
  if (!info) return undefined
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === info.mtimeMs) return hit.map
  let map: Record<string, string>
  try {
    map = JSON.parse(await readFile(file, "utf8"))
  } catch (e) {
    log(`tools_override: bad JSON ${file}: ${e}`)
    return undefined
  }
  cache.set(file, { mtimeMs: info.mtimeMs, map })
  log(`tools_override: loaded ${file} tools=${Object.keys(map).join(",")}`)
  return map
}

// Swap in the short descriptions for the tools listed in the file.
// Tools not listed (e.g. skill) keep their original description.
export async function toolOverrides(event: any, opts: { settings: (agent: string) => Promise<{ file: string; keys: Record<string, string> }> }) {
  const { keys, file } = await opts.settings(event.agent)
  if (!keys.tools_override || !file) return
  const map = await load(path.join(path.dirname(file), keys.tools_override))
  if (!map) {
    log(`tools_override: file not found: ${keys.tools_override}`)
    return
  }
  for (const [name, description] of Object.entries(map)) {
    const tool = event.tools[name]
    if (!tool) {
      log(`tools_override: tool not sent to model, key does nothing: ${name}`)
      continue
    }
    if (typeof description === "string") tool.description = description
  }
}
