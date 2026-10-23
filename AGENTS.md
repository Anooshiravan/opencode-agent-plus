# Install (for agents)

1. Register the plugin in `~/.config/opencode/opencode.json` — add to the
   `plugin` array:

   ```json
   { "plugin": ["opencode-agent-plus"] }
   ```

   Before the npm publish, or for local development, use the absolute
   path of this repo instead:

   ```json
   { "plugin": ["/ABSOLUTE/PATH/TO/THIS/REPO"] }
   ```

2. Restart the opencode server so the plugin loads:

   ```bash
   opencode service restart
   ```

3. Verify: start a session with an agent whose frontmatter sets a
   setting (e.g. `temperature: 1`). The sidebar shows an "Agent-plus"
   section, and a toast reports loaded or lists frontmatter problems.

Notes:

- The plugin needs no dependencies or build step; opencode loads
  `src/index.ts` (server) and `src/tui.tsx` (TUI) directly.
- Config is via env vars, set before `opencode service restart`:
  `AGENT_PLUS_DEBUG` — path to a debug log file (off by default).
- Settings live in agent `.md` frontmatter; see README.md for keys.
