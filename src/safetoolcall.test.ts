import { expect, test } from "bun:test"
import { isSafeToolCall } from "./safetoolcall"

const safe = (cmd: string) => isSafeToolCall("shell", [cmd])

test("read-only tools are safe", () => {
  for (const a of ["read", "glob", "grep", "websearch"]) expect(isSafeToolCall(a, [])).toBe(true)
})

test("safe shell commands", () => {
  for (const c of ["ls", "cat f", "git status", "git log --oneline", "docker compose ps", "npm ls", "node --version", "psql -c 'select 1'"])
    expect(safe(c)).toBe(true)
})

test("unsafe commands and flags", () => {
  for (const c of ["rm -rf /", "git branch -D x", "find . -exec rm {} ;", "sort -o out f", "git log --output=f", "node script.js", "env rm x", "ssh -o ProxyCommand=x host"])
    expect(safe(c)).toBe(false)
})

test("compound commands need every part safe", () => {
  expect(isSafeToolCall("shell", ["ls", "cat f"])).toBe(true)
  expect(isSafeToolCall("shell", ["ls", "rm x"])).toBe(false)
  expect(safe("echo $(whoami)")).toBe(false)
})

test("corner cases", () => {
  expect(isSafeToolCall("shell", [])).toBe(false) // no resources
  expect(safe("")).toBe(false) // empty command
  expect(safe("ls; rm x")).toBe(false) // semicolon hides a write
  expect(safe("cat `whoami`")).toBe(false) // backtick substitution
  expect(safe("git status --output=f")).toBe(false) // git write flag
  expect(safe("docker compose down")).toBe(false) // not a read subcommand
  expect(safe("sqlite3 db '.dump'")).toBe(false) // not a read-only dot
  expect(safe("ssh host")).toBe(false) // bare ssh is a shell
  expect(safe("ssh host ls")).toBe(true) // remote read command
})
