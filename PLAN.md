# PLAN

## Goals (client-side only — nothing sent to the model server)

1. **Anti-loop counter** — count tool calls per user message; reset on each new
   user message. Deny when over `max_same_tool`.
2. **Green light** — deny all tools unless the user's latest message ends with
   a go-ahead word.
3. **Anti-repetition** — detect the model's output text repeating itself
   (e.g. `parameter=parameter=parameter=`) and stop the run.

## Rules

- All three work inside the plugin only (allow/deny tool calls, inspect text).
  No sampling or other parameters are ever sent to the server.
- Anti-repetition (repeated text) and anti-loop (repeated tool calls) are
  separate features. Do not mix them.

## Anti-repetition mechanism (verified against opencode source)

- `http.response` hook: the reply `response` is changeable, so the plugin can
  wrap the stream and scan chunks as they arrive.
- On detected repetition, call `session.interrupt` to stop the run mid-stream.

## Status

- Working tree reset to `faaa4a8` (pre-0.3); 0.3 code kept in `./local/bad_code`.
- 0.3 broke tool calls (empty arguments) — suspected cause: sampling keys
  forwarded to the server. Not needed for any goal above.
