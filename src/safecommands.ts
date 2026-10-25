// Safe-command checks for the `safe_commands: allow` frontmatter key.
// The permission hook (index.ts) asks: is this action + resource list read-only enough
// to skip the ask window? Anything doubtful stays on the normal path (config rules, prompt).

// Read-only tool actions that need no further checks.
const SAFE_ACTIONS = new Set(["read", "glob", "grep", "websearch"])

// Single commands that only read. Two-word commands (git, docker, ssh) are checked separately below.
const SAFE_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "find", "grep", "rg", "sort", "uniq", "diff",
  "pwd", "echo", "whoami", "uname", "date", "du", "df", "file", "which", "type",
  "tree", "stat", "env", "printenv", "basename", "dirname", "realpath",
])

const GIT_SUBS = new Set(["status", "log", "diff", "show", "branch", "remote", "ls-files", "blame", "describe"])
const DOCKER_SUBS = new Set(["ps", "logs", "inspect", "images", "version", "top", "port"])
const COMPOSE_SUBS = new Set(["ps", "logs", "config", "images", "top", "port", "version"])
const NPM_SUBS = new Set(["ls", "list", "view", "outdated", "ping", "help"])
// First words of a database query that only read.
const SQL_STARTS = /^(select|with|explain|show|pragma)\b/i
const SQLITE_DOTS = new Set([".tables", ".schema", ".headers"])

// ssh flags that run code, tunnel traffic or change the connection: never safe.
const SSH_UNSAFE_FLAGS = new Set(["-o", "-J", "-L", "-R", "-D", "-W", "-F", "-E", "ssh_proxycommand"])

// Characters that mean the string is more than one simple command, or hides a substitution.
const UNSAFE_CHARS = /[$`;&|<>\n\r]/

// Splits one command into words, keeping quoted parts together.
function words(command: string): string[] | undefined {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(command))) out.push(match[1] ?? match[2] ?? match[3])
  return out.length ? out : undefined
}

// Reads inside quotes are not shell syntax: strip them before the unsafe-character check.
function unquoted(command: string): string {
  return command.replace(/"[^"]*"|'[^']*'/g, " ")
}

// Checks one simple command (already split by the scanner from compounds).
function safeCommand(command: string): boolean {
  if (UNSAFE_CHARS.test(unquoted(command))) return false
  const parts = words(command)
  if (!parts) return false
  const [name, ...rest] = parts

  // env runs whatever follows: check that command instead.
  if (name === "env") {
    const rest2 = rest.filter((r) => !r.includes("="))
    return rest2.length > 0 && safeCommand(rest2.join(" "))
  }

  // These read-only tools can also run code or write files with certain flags.
  const DANGEROUS_FLAGS: Record<string, string[]> = {
    find: ["-exec", "-execdir", "-ok", "-delete", "-fprint", "-fprintf", "-fls"],
    rg: ["--pre", "--hostname-bin"],
    sort: ["-o", "--output"],
    grep: ["--exclude-from"], // reads any file: keep it simple and refuse
  }
  if (DANGEROUS_FLAGS[name]) {
    if (rest.some((r) => DANGEROUS_FLAGS[name].some((f) => r === f || r.startsWith(f + "=")))) return false
    if (name === "grep") return true
    return true
  }

  if (SAFE_COMMANDS.has(name)) return true

  if (name === "git") {
    const sub = rest.find((r) => !r.startsWith("-"))
    if (sub === undefined || !GIT_SUBS.has(sub)) return false
    // git branch can delete (-d -D -m -M -c -C) and git log/diff/show can write files (--output).
    if (sub === "branch" && rest.some((r) => /^-(d|D|m|M|c|C)$/.test(r) || r.startsWith("--delete") || r.startsWith("--move"))) return false
    if (rest.some((r) => r === "--output" || r.startsWith("--output="))) return false
    return true
  }

  if (name === "docker") {
    const sub = rest.find((r) => !r.startsWith("-"))
    if (sub === "compose") {
      const next = rest.slice(rest.indexOf(sub) + 1).find((r) => !r.startsWith("-"))
      return next !== undefined && COMPOSE_SUBS.has(next)
    }
    return sub !== undefined && DOCKER_SUBS.has(sub)
  }

  if (name === "npm") {
    const sub = rest.find((r) => !r.startsWith("-"))
    return sub !== undefined && NPM_SUBS.has(sub)
  }

  // node only with plain info flags; node <script> or -e runs code.
  if (name === "node") return rest.length > 0 && rest.every((r) => ["-v", "--version", "--help"].includes(r))

  // psql / sqlite3: every quoted query must start with a read-only keyword and hold one statement.
  if (name === "psql" || name === "sqlite3") return safeQueries(command)

  // ssh [flags] host <cmd>: the remote command must itself be safe; a bare ssh is a shell.
  if (name === "ssh") return safeSsh(rest)

  return false
}

// psql / sqlite3: each quoted part must be one read-only statement; an unquoted .dot also counts.
function safeQueries(command: string): boolean {
  const quoted = [...command.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2])
  if (!quoted.length) return SQLITE_DOTS.has(command.trim().split(/\s+/).pop()?.toLowerCase() ?? "")
  return quoted.every((q) => {
    const text = q.trim()
    if (!text) return false
    if (text.includes(";") && text.replace(/;+$/, "").includes(";")) return false // only one statement
    const body = text.replace(/;+$/, "").trim()
    return SQLITE_DOTS.has(body.toLowerCase()) || SQL_STARTS.test(body)
  })
}

function safeSsh(args: string[]): boolean {
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith("-")) {
      // "-L 8080:host:80" style: the value is the next word; the flag itself decides.
      const flag = arg.split("=")[0].toLowerCase()
      if (SSH_UNSAFE_FLAGS.has(flag)) return false
      if (/^-[jklmobic]$/.test(flag) && !arg.includes("=")) i++ // skip this flag's value
      continue
    }
    if (!rest.length) {
      rest.push(arg) // host
      continue
    }
    rest.push(arg)
  }
  // rest[0] is the host; the rest is the remote command, checked like a local one.
  if (rest.length < 2) return false
  return safeCommand(rest.slice(1).join(" "))
}

// Is this permission event safe to allow? `action` and `resources` come from the hook event.
export function isSafe(action: string, resources: readonly string[]): boolean {
  if (SAFE_ACTIONS.has(action)) return true
  if (action !== "shell") return false
  // The scanner splits compound commands into several resources: every part must be safe.
  return resources.length > 0 && resources.every(safeCommand)
}
