// Mock OpenCode ctx for hook tests. Messages mimic the real shape:
// instances with { role, content: [{ type: "text", text }] } so appendBlock's
// `event.messages[0].constructor` works like in production.

export class Message {
  role: string
  content: { type: string; text: string }[]
  constructor(init: { role: string; content: { type: string; text: string }[] }) {
    this.role = init.role
    this.content = init.content
  }
}

export const user = (text: string) => new Message({ role: "user", content: [{ type: "text", text }] })
export const assistant = (text: string) => new Message({ role: "assistant", content: [{ type: "text", text }] })

// Stored conversations (test/conversations.json), turned into Message objects.
import conversations from "./conversations.json"
export const conversation = (name: string): Message[] =>
  (conversations as Record<string, { role: string; text: string }[]>)[name].map((m) =>
    new Message({ role: m.role, content: [{ type: "text", text: m.text }] }),
  )

export interface MockCtx {
  sessionHandlers: Record<string, (e: any) => Promise<void>>
  permissionHandlers: Record<string, (e: any) => Promise<void>>
  interrupted: string[]
  generated: string[]
  session: {
    hook: (name: string, fn: any) => Promise<void>
    interrupt: (a: any) => Promise<void>
    generate: (a: any) => Promise<{ text: string }>
  }
  permission: { hook: (name: string, fn: any) => Promise<void> }
}

export function mockCtx(): MockCtx {
  const sessionHandlers: Record<string, any> = {}
  const permissionHandlers: Record<string, any> = {}
  const interrupted: string[] = []
  const generated: string[] = []
  return {
    sessionHandlers,
    permissionHandlers,
    interrupted,
    generated,
    session: {
      hook: async (name, fn) => void (sessionHandlers[name] = fn),
      interrupt: async (a) => void interrupted.push(a.sessionID),
      generate: async (a) => {
        generated.push(a.prompt)
        return { text: '{"allow": true}' }
      },
    },
    permission: { hook: async (name, fn) => void (permissionHandlers[name] = fn) },
  }
}
