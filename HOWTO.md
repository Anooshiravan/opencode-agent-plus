# HOWTO

## Install

1. Copy the plugin into the global plugins folder (loads automatically):

   ```bash
   rsync -a --exclude=.git <REPO_DIR>/ ~/.config/opencode/plugins/opencode-agent-plus/
   ```

   Or add it to `plugins` in `opencode.json`:

   ```json
   { "plugins": ["opencode-agent-plus"] }
   ```

2. Restart the server:

   ```bash
   opencode service restart
   ```

3. Verify: a toast says "agent-plus is loaded". The sidebar shows an
   "Agent-plus" section.

## Update

Re-run the `rsync` command, then restart the server.

## Set a setting on an agent

Add keys to the agent's `.md` frontmatter:

```markdown
---
description: Writing and editing text
mode: primary
model: litellm/my-model
temperature: 1.0
enable_thinking: false
reminder: |
  - Keep replies short, simple words
  - If unclear, say so — don't guess
---

You help the user write and edit text.
```

See README.md for the full key table.
