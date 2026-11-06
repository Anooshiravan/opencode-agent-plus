# Idea: ponder instead of deny in the anti-loop

## Current state

`max_same_tool: n` denies a tool call after n identical calls in a row within
one user message, with a "you are probably stuck in a doom loop" message.
Problem: denial forces the model to stop mid-run — unpleasant and abrupt.

## Proposal

When the streak hits the limit, do not deny. Instead run **one real pondering
round** (see IDEA-pondering.md): a background request with the full
conversation where the model genuinely thinks — retrospectively reviews the
loop and reasons it through:

- Does repeating this call make sense? What did each previous attempt return?
- Is there a better idea or a different approach?
- Should the commands run differently (different args, different order,
  different tool)?
- What is missing that keeps blocking progress?

The output is the model's own free-form thinking, not a predefined message.
It is injected into the next model call as a `<pondering>` block, and the
model continues with its conclusion in context. No hard stop; the agent
judges the loop itself and can still justify continuing it.

## Why better

- No forced stop; the agent keeps control and can still justify the loop
  (some loops are legitimate, e.g. polling a slow build).
- The reflection is generated from the real trajectory, so the advice is
  concrete, not a generic warning string.
- Reuses the same pondering machinery: the anti-loop trigger becomes just
  another moment where a step-back round is worth running.

## Notes

- Needs the pondering mechanism first (client-side background request +
  block injection).
- Keep a hard cap as a last resort (e.g. 2x the limit) in case the model
  ignores the reflection.
