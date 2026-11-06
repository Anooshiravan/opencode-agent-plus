// The plugin's single log function. Lines are appended to `debug.log`
// next to the plugin's folder. Debug lines are on only while a `debug`
// file exists in the plugin's folder (touch/rm, no restart needed).
import path from "node:path"
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const marker = path.join(folder, "debug")
const file = path.join(folder, "debug.log")
const MAX_BYTES = 500_000 // cheap size check per line; on pass, rewrite with the last KEEP_LINES
const KEEP_LINES = 2000

export function log(line: string) {
  if (!existsSync(marker)) return
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      const lines = readFileSync(file, "utf8").split("\n")
      writeFileSync(file, lines.slice(-KEEP_LINES).join("\n"))
    }
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}
