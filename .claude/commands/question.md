---
name: question
description: Drive a decision through one question at a time. For each question, present a set of options, then a recommendation, then the rationale — every question handled individually and in that order. Use when the user wants to be walked through choices interactively before acting, or invokes /question.
---

# /question — guided decision making

Walk the user through whatever needs deciding **one question at a time**. Never
batch questions or dump them all at once. For each single question, supply all
three of the following, in this order:

1. **Options** — a short, mutually-exclusive list of concrete choices. Label
   them so the user can answer with a single word/letter.
2. **Recommendation** — pick exactly one option as your recommendation.
3. **Why** — the rationale: the trade-offs that make the recommended option
   best, and when an alternative would beat it.

All three are mandatory for every question. A question without options, or
without a recommendation, or without a rationale, is incomplete — do not send it.

## Flow

1. Ask the **first** question only. Stop. Wait for the answer.
2. When the user answers, incorporate it, then ask the **next** question the
   same way (options + recommendation + why).
3. Continue until the decision space is resolved, then summarize the resulting
   choices and proceed with the work (or hand back a clear plan).

## Rules

- One question per turn — no exceptions, even if questions seem independent.
- If the user pushes back or picks differently from your recommendation, accept
  it without re-litigating, and move to the next question.
- Keep options genuinely distinct; collapse near-duplicates.
- If you discover later questions depend on an earlier answer, ask them in
  dependency order so each answer informs the next.
- Challenge the premise when a question itself is wrong — say so rather than
  forcing a choice among bad options.

## Use the AskUserQuestion tool when it fits

When the options are clean and selectable, render the question with the
`AskUserQuestion` tool (one question per call) so the user can click an option.
Still include your recommendation (mark the recommended option first and append
"(Recommended)") and give the rationale in your accompanying text. When the
choice is open-ended or needs discussion, ask in plain prose instead — but keep
the same options → recommendation → why structure.