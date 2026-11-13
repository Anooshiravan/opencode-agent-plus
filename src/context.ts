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
  // NEVER change this order: the throwaway block must stay AFTER the user's
  // last message, never before it.
  //
  // Why: the inference server we use, Strata, caches the conversation with
  // checkpoints so the next request only reads the new text. Strata saves a
  // checkpoint at the start of the last turn and reuses it next time.
  //
  // Strata has a flag, --tail-role-token, meant for a throwaway turn the
  // server itself appends (a reasoning-effort note): it tells the engine to
  // put the checkpoint BEFORE that turn, so the changing text never poisons
  // the cache. With our reminder injected before the user message, the engine
  // treated it as that throwaway turn and moved the checkpoint before it -
  // but unlike the effort note, our block pushes the real user message and
  // reply past the checkpoint, so every turn re-read them (reuse stuck, prefill
  // growing each turn).
  //
  // With the block appended after the user message, the checkpoint covers the
  // whole conversation and only the throwaway block itself is re-read.
  event.messages.push(block)
}

// Real user messages only: skips injections wrapped in <system-reminder>
// (ours and other plugins').
export function realUserTexts(messages: any[]): string[] {
  const texts: string[] = []
  for (const m of messages) {
    if (m.role !== "user") continue
    const parts = m.content ?? m.parts ?? []
    const text = parts.map((p: any) => p.text ?? "").join("")
    if (text.trimStart().startsWith("<system-reminder>")) continue
    texts.push(text)
  }
  return texts
}

// The reminder text for a request: the agent file's `reminder:` first,
// then AGENTS.md's, then off ("").
export async function reminderText(directory: string, keys: Record<string, string>) {
  const own = reminderPreset(keys.reminder)
  if (own !== null) return own
  const agents = frontmatter(await read(path.join(directory, "AGENTS.md")))
  return reminderPreset(agents.reminder) ?? ""
}
