# Pondering (idle-time thinking for LLM agents)

Use the GPU's idle time between user turns to keep the model thinking, and
inject the result as context into the user's next message. The gain is answer
**quality**, not just speed.

Written up from a conversation on 2026-11-06, run on the homelab model
(Qwen3.8-Flash-Next on alpha, ~70–110 tok/s).

---

## 1. Starting point: how speculative decoding works today

- The engine (Strata/llama.cpp) drafts several next tokens with a small draft
  model; the big model checks them in **one pass** instead of one token per
  pass. Each guess matching the big model's own top pick is kept; the first
  mismatch is replaced with the big model's token.
- Log line: `drafts accepted 65 of 80` = 65 of 80 guessed tokens were correct.
  More accepted = faster output.
- Key property: LLM decoding is memory-bound, not compute-bound, so checking
  many tokens costs about the same as one. Extra compute is nearly free.
- Drafts only run **during generation**. During idle there is no new text to
  draft from, so nothing runs. The GPU just sits there.

## 2. The observation: idle time + predictable user replies

- In a chat/agent loop the model finishes in seconds, then waits for the human
  to read, think, and type. **The human is the bottleneck.** The agent spends
  most of its time waiting on the user, not the other way around.
- The user's next reply is far more predictable than it feels. In agentic
  coding especially:
  - the **trajectory itself limits** what the user can say next (after a
    failing test: "fix it"; after a success: "commit", "next step");
  - the model can predict the reply from the conversation history.
- The wasted work is **wasted compute, not wasted time** — idle GPU time is
  free. If a guess hits, the user gets a faster and better-prepared answer.

## 3. Where the idea came from (accidental discovery)

- While using Claude CLI, the model sometimes fell into an error mode where it
  hallucinated the **user's next turn** and kept going:

  `<role="user">: give me an example of this code`
  `<role="assistant">: the example is...`

- The hallucinated user turn was plausible enough that the model answered it
  itself. That proves the model already predicts user replies well — the idea
  is to run that prediction **on purpose**, during idle time.

## 4. Why asking the model to predict does not work

- Tested live: asked the model to predict the user's next message. The
  predictions were off because **being asked changes the behavior** — the
  model performed instead of predicting naturally.
- Conclusion: the safest way to let the model predict the trajectory is **not
  to stop generation at the stop token** — let it continue the dialogue
  naturally, user turns included, without knowing it is being tested. Then
  compare its guess of "you" with what you actually typed.

## 5. From branching guesses to one pondering trajectory

- First form: guess the k most probable next user replies (e.g. 3), pre-draft
  an answer for each. Problem: more branches = more wasted compute per hit.
- Improvement 1 — **categorize, don't word-match**: "why?" and "so it's
  useless?" are both "give more explanation". Grouping follow-ups into
  categories cuts the number of guesses needed.
- Improvement 2 — **no branching at all**: don't guess k replies. Just keep
  pondering along the single most likely trajectory. Fewer wasted paths, and
  the thinking stays useful even when the real reply diverges, because the
  context is already warm.
- Second improvement is the better one: one continuous ponder beats k branches.

## 6. The actual mechanism (what we settled on)

Not "precompute the answer", not "precompute the thinking block to reuse", and
not a KV-cache trick. The mechanism:

1. After each assistant reply, the client sends a background **ponder
   request** with the full conversation (same context as a real request; KV
   cache makes it cheap — only the last turn needs fresh processing).
2. A short system-prompt note explains what pondering means.
3. The model produces a short block: `ideas, results, speculations` about
   where the conversation is going.
4. When the user actually sends a message, the client appends to the end of
   the user text:

   ```
   <pondering>ideas, results, speculations</pondering>
   ```

5. The model must use the block **silently** — never reply to it, never
   mention it. Exactly how `<system-reminder>` blocks work in opencode:
   appended to the **last user turn only** (not repeated through the whole
   trajectory), and the model uses their context without responding to them.
   That is the behavioral template for `<pondering>`.

Example of what the model actually receives:

```
<user message text>
<system-reminder>
...automatic note, not from the user, do not reply to it...
</system-reminder>
<pondering>
The user has been exploring idle-time pondering for LLMs. Likely next
replies: "now answer my question", or asking how to implement it, or
"save this idea". If they ask to implement: the hook goes in the client,
not the engine — append the pondering block to the user message.
</pondering>
```

## 7. Why the value is quality, not speed

- Pondering will probably **not** make generation faster; at best the first
  token comes sooner, and only when the guess hits.
- The real win: even a **missed** guess is not wasted. The model has already
  thought through the topic, so the actual reply is better reasoned. The
  quality gain does not depend on the guess hitting.
- Pondering also has **a lot of time** — unlike a normal turn, it is not
  racing a latency budget, so the model can think deeper than it would
  inline.

## 8. The chess connection

- This is exactly **pondering** in chess engines: thinking during the
  opponent's clock by predicting their move and searching the response.
- The term from the German side is **permanent brain**; the first program to
  do it was **Permanent Brain** (UC Berkeley, 1973). No paper for it — it was
  a student program.
- Pondering in chess is known to be less effective than normal thinking
  (a 25% hit rate ≈ 1.25× thinking time) — same trade-off applies here.
- Same for the idle-time idea: the "opponent's moves" are the user's possible
  replies; idle time is the thinking clock.

## 9. Prior work (researched 2026-11-06)

- **"Don't Wait to Reply: Towards Responsive yet Thoughtful Dialogue through
  Proactive Thinking"** (EMNLP Findings 2026) — the closest paper.
  https://aclanthology.org/2026.findings-emnlp.709.pdf
  - "Proactive Thinking": precompute during conversational downtime.
  - Two mechanisms: **precomputation via anticipated rollouts** (hypothesize k
    likely user replies, precompute reasoning traces for each) and
    **speculative continual thinking** (keep thinking along the trajectory,
    reuse what fits). Training-free.
  - Tested by rebuilding 20 Questions, AgentClinic, IN3 as timed environments
    where user replies arrive at human speed; measured latency and quality.
- **thoughtful-agents** (https://github.com/xybruceliu/thoughtful-agents,
  Python, Apache-2.0, from the "Inner Thoughts" CHI 2025 paper) — the agent
  generates inner thoughts during conversation, scores an intrinsic-motivation
  1–5, and decides when to speak or interrupt. About *when to speak* in
  multi-party chat, not answer quality.
- **proactive-ai** (https://github.com/airalogy/proactive-ai, TypeScript,
  Apache-2.0, new/0 stars) — conversation as a timeline, not turns. Mutable
  time queue (schedule/edit/cancel future messages), a pacemaker that wakes the
  AI when idle, bounded-silence deadline forcing it to eventually speak.
  Closest framework in spirit; framed as timing/naturalness, not quality.
- **ProAct** (arXiv 2605.25971, May 2026) — idle-time compute for agents:
  predicts upcoming needs, pre-fetches info and evidence before the query.
  Ships ProActEval benchmark (200 scenarios, 40 domains).
- **ProactiveAgent** (https://github.com/thunlp/ProactiveAgent, ICLR 2025) —
  watches your activity (browser/vscode logs) and suggests actions before you
  ask. More "assistant watching your screen" than dialogue speculation.
- Gap: nobody has built the **engine/serving-level** version — pondering
  between turns inside llama.cpp/Strata — and none of the frameworks does the
  `<pondering>`-block injection described in §6.

## 10. Fit for this project

- Client-side only: fits this plugin's rule that nothing special is sent to
  the server — the ponder request is a normal chat request, and the block is
  just extra text in the user message. No engine changes needed.
- The ponder request can run on the second GPU (alpha has two GV100s) or on
  the same engine during idle.
- Open questions:
  - how long a trajectory to give the ponder request (probably the full
    conversation; KV cache makes it cheap);
  - when to stop/cancel a running ponder when the user types mid-ponder;
  - how to phrase the system-prompt note so the model treats `<pondering>`
    like `<system-reminder>` (use it, never reply to it);
  - token budget for the pondering block.

## 11. Open design points (plugin work, 2026-11-06)

Not settled yet; to be discussed one at a time:

1. **Trigger** — after each assistant reply finishes, fire one background
   ponder request for that session.
2. **How to run it** — the plugin must send a chat request itself:
   (a) call the provider endpoint directly, or
   (b) use opencode's session/prompt API for a hidden throwaway prompt
   (cleaner, but may pollute history).
3. **Ponder prompt** — same conversation + a short note: "You are pondering:
   write ideas, results, speculations about where this conversation is going.
   Do not answer."
4. **Injection** — store the result per session; on the user's next message,
   the `context` hook appends `<pondering>...</pondering>` via `appendBlock`.
5. **Cancel/stale** — if the user sends while pondering runs, discard the
   result or keep it for the next turn?
6. **Frontmatter** — `pondering: on` to enable per agent.
7. **Budget** — cap the block, e.g. 150–200 tokens.

## 12. Issues

1. **Duplicate pondering (4x)** — the plugin loads in 4 locations, each with
   its own event listener, so one finished reply starts 4 ponder requests
   (seen in the debug log: 4 `start` lines per turn). Wasteful; each result
   overwrites the stored one. Fix options: dedupe across instances (shared
   file lock per session), or only enable pondering in one load location.
