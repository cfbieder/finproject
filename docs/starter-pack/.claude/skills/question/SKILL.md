---
name: question
description: Walk through all open questions and pending decisions one at a time, each with options, a recommendation, and rationale, allowing discussion before moving on. Use when the user types /question, asks to "go through your questions", "what do you need from me", or "let's decide the open points" — or proactively when you have accumulated 2+ open questions or unresolved decisions blocking the current task.
---

# /question — resolve open decisions one at a time

This is the invocable form of the question protocol in the collaboration rules. The point
is to turn a pile of ambiguities into a sequence of small, well-framed decisions — never a
wall of questions.

## Procedure

1. **Collect.** Gather every open question and pending decision relevant to the current
   task: ambiguities in the request, design forks, anything you have been assuming without
   confirmation, and (when bootstrapping a project) the unanswered items from
   infra-bootstrap §12. Merge duplicates; drop anything answerable from the repo, docs, or
   conversation — **never ask what you can look up.**
2. **Announce scope first.** One short message: "I have N questions: <topic 1>, <topic 2>,
   …" so the user knows the size of the queue before question 1. If N is large (>6),
   propose an order (blocking decisions first) and confirm it.
3. **One question per message.** For each:
   - State the question and **why it matters now** (what it blocks or changes).
   - Present **2–4 labeled options** (A/B/C…), each with its key trade-off in a line.
   - Give **your recommendation and the rationale** — commit to one; "it depends" is not a
     recommendation.
   - Explicitly invite discussion: the user may pick an option, push back, ask follow-ups,
     or propose option D. **Stay on this question** — discuss as long as needed — until
     it is resolved, or the user says *skip* / *defer* / *you decide*.
   - "You decide" = adopt your recommendation and record it as such.
4. **Track as you go.** Keep a running decisions list (question → decision → basis:
   user-chosen / recommended-and-accepted / deferred).
5. **Close out.** After the last question, post the full decisions summary. Record anything
   durable in the right home per the documentation standard: design decisions into the
   relevant CR doc (or a new one if the decisions define a feature), gotchas/preferences
   into `docs/` or memory. Deferred items go to `docs/current/project-roadmap.md` as open
   questions — not silently dropped.
6. **Then act.** Resume the task with the decisions applied; do not re-ask anything just
   decided.

## Hard rules

- Never bundle two questions into one message, even related ones.
- Never proceed to question N+1 while N is still under discussion.
- Every option set includes your recommendation — presenting options without one pushes
  the thinking back onto the user, which defeats the purpose.
- If discussion of one question invalidates a later one, say so and drop/replace it —
  keep the queue honest.
