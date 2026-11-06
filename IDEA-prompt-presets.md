# Idea: built-in prompt presets for the system-reminder

## Current state

The `<system-reminder>` block appended to the last user turn is built from
the agent's `.md` frontmatter — each agent file carries its own instruction
text (e.g. the "Concise" agent's rules about short answers, plain English,
temp files, no chained commands).

## Problem

- Every agent repeats long instruction text in its frontmatter; wording
  drifts and typos creep in per file.
- Users must write the full prompt themselves to get a behavior style.
- No shared, curated definitions of common styles.

## Proposal

Pre-build the prompt text **inside the plugin** as named presets. The agent
frontmatter only selects one:

```yaml
style: concise    # or: creative | off
```

- `concise` — short plain-English answers, no over-explaining, say when the
  request is unclear instead of guessing.
- `creative` — the opposite end: elaborative, exploratory answers, offers
  alternatives and ideas beyond the literal request.
- `off` — no reminder block at all.

The plugin holds the canonical wording for each preset; frontmatter never
carries the text. Custom free-text frontmatter can stay as an escape hatch
(preset wins if both are set, or they concatenate — decide later).

## Why better

- One curated wording per style, shared by all agents.
- One word in frontmatter instead of a paragraph.
- Presets can be tuned centrally in the plugin and improve every agent at
  once.
