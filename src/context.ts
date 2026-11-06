// Owns the `context` hook: appends hidden blocks (like <system-reminder>)
// to the messages of every model request.
import path from "node:path"
import { frontmatter, read } from "./frontmatter"
import { reminderPreset } from "./presets"

// Appends `text` wrapped in <tag> as a user message the model must not reply to.
// Plugins cannot import opencode's Message class (@opencode/ai), so borrow it from an existing message.
export function appendBlock(event: any, tag: string, text: string) {
  const wrapped = `<${tag}>\nAutomatic note, not from the user. Do not reply to it.\n\n${text}\n</${tag}>`
  const Message = event.messages[0].constructor
  event.messages.push(new Message({ role: "user", content: [{ type: "text", text: wrapped }] }))
}

// The reminder text for a request: the agent file's `reminder:` first,
// then AGENTS.md's, then off ("").
export async function reminderText(directory: string, keys: Record<string, string>) {
  const own = reminderPreset(keys.reminder)
  if (own !== null) return own
  const agents = frontmatter(await read(path.join(directory, "AGENTS.md")))
  return reminderPreset(agents.reminder) ?? ""
}
