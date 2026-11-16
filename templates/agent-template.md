---
# What this agent does.
description: What this agent does

# primary | subagent | all.
mode: primary

# provider/model-id.
model: provider/model-id

# The system prompt text for this agent.
system: You are a helpful agent.

# Tool permission overrides.
permissions: {}

# Max steps per turn.
steps: 100

# Hide from the agent picker. true | false.
hidden: false

# Color shown for the agent.
color: "#888888"

# Turn the agent off. true | false.
disabled: false

# Extra request-body fields.
request: {}

# Preset (concise, ultra-concise, creative, off) or your own text.
# Added as the last message of every model request.
reminder: concise

# Shell command run when a request fails with a connection error, then retry.
on_error_command: echo reconnecting

# allow | none. Turn safe-command auto-allow off with none.
safe_commands: allow

# on | off (default off). Stop the reply when the model repeats the same text.
max_word_repeat: off

# Max times the same tool call may repeat in a row before it stops.
max_tool_repeat: 7

# on | off. Tools run only when your message ends with an approval word.
manual_green_light: off

# Comma-separated approval words for manual_green_light.
manual_green_light_words: yes, do, go, ok, okay, fine, good, fix, try, run

# on | off. The model checks itself before the first tool call of each turn.
auto_green_light: off

# Sampling temperature, 0.2 to 1.4. Sent in the request body.
temperature: 0.4

# Max tokens the model may generate per reply. Sent in the request body.
max_completion_tokens: 8192

# Token budget for the model's thinking. Sent in the request body.
reasoning_budget_tokens: 4096

# How much the model thinks: none | minimal | low | medium | high | xhigh. Sent in the request body.
reasoning_effort: low

# true | false. Turns the model's thinking on or off. Sent under chat_template_kwargs.
enable_thinking: true

# JSON file next to this agent file mapping tool names to replacement
# descriptions. Tools not listed keep their own description.
tools_override: tools-override.json

# on | off. Run a quiet thinking request when the session goes idle.
pondering: off

# on | off. Swaps leaked tag signs (< > |) in the reply for safe look-alikes.
misplaced_tag_filter: on

# on | off. Run the agent hands-off with auto-continue.
clockwork: off
---

The agent's system prompt body goes here (below the closing ---).
