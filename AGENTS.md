# Install (for agents)

1. Copy the repo into the global plugins folder; plugins there load
   automatically, no config entry needed:

   ```bash
   rsync -a --exclude=.git <THIS_REPO_DIR>/ ~/.config/opencode/plugins/opencode-agent-plus/
   ```

   Or add it to the `plugins` array in `~/.config/opencode/opencode.json`:

   ```json
   { "plugins": ["opencode-agent-plus"] }
   ```

2. Restart the opencode server so the plugin loads:

   ```bash
   opencode service restart
   ```

3. Verify: start a session with an agent whose frontmatter sets a
   setting (e.g. `temperature: 1`). The sidebar shows an "Agent-plus"
   section, and a toast reports loaded or lists frontmatter problems.

# Deploy local changes (for agents)

Copy the repo into the live plugin directory:

```bash
rsync -a --exclude=.git <THIS_REPO_DIR>/ ~/.config/opencode/plugins/opencode-agent-plus/
```

Then restart the server (the user runs this, do not run it yourself):

```bash
opencode service restart
```

Notes:

- The plugin needs no dependencies or build step; opencode loads
  `src/index.ts` (server) and `src/tui.tsx` (TUI) directly.
- Debug lines always go to opencode's main log
  (`~/.local/share/opencode/log/opencode.log`), prefixed `agent-plus:`.
- Settings live in agent `.md` frontmatter; see README.md for keys.
