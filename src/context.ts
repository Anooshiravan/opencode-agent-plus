// Owns the `context` hook: appends hidden blocks (like <system-reminder>)
// to the messages of every model request.
import path from "node:path"
import { frontmatter, read } from "./frontmatter"
import { reminderPreset } from "./presets"

// Appends `text` wrapped in <tag> as a user message the model must not reply to.
// Plugins cannot import opencode's Message class (@opencode/ai), so borrow it from an existing message.
export function appendBlock(event: any, tag: string, text: string, header = "Automatic note, not from the user. Do not reply to it.") {
  const wrapped = `<${tag}>\n${header}\n\n${text}\n</${tag}>`
  const Message = event.messages[0].constructor
  const block = new Message({ role: "user", content: [{ type: "text", text: wrapped }] })
  // Insert before the user's last message, not after it.
  let i = event.messages.length
  if (i > 0 && event.messages[i - 1].role === "user") {
    i--
    // Mark the real user message so it stands out from the injected blocks.
    const part = event.messages[i].content?.[0]
    if (part?.type === "text" && !part.text.startsWith("User:")) part.text = `User:\n${part.text}`
  }
  event.messages.splice(i, 0, block)
}

// The reminder text for a request: the agent file's `reminder:` first,
// then AGENTS.md's, then off ("").
export async function reminderText(directory: string, keys: Record<string, string>) {
  const own = reminderPreset(keys.reminder)
  if (own !== null) return own
  const agents = frontmatter(await read(path.join(directory, "AGENTS.md")))
  return reminderPreset(agents.reminder) ?? ""
}
