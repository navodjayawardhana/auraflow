# 8. A grounding pack the assistant can answer from, and a fingerprint that says when the brief may change

Date: 2026-08-23

## Status

Accepted. Extends ADR&nbsp;0005, and reverses two of its explicit non-decisions.

## Context

Two complaints, one cause.

The daily brief always said the same thing. The assistant did not answer what was asked.
Both came from `App\Domain\Advice\ValueObject\DailyContext`: fifteen fields, all about
today. ADR&nbsp;0005 chose that deliberately — "no attempt at personalisation beyond one
day's figures" — and the choice held right up until people used it.

"How did I sleep last week?" "What did I eat yesterday?" "Is my recovery trending down?"
"How many sessions did I do?" Every one of those has an answer sitting in the user's own
rows, and none of it reached the prompt. The honest reply and the useless reply were the
same reply.

And the brief could not change, because after the morning those fifteen fields barely
move. `GenerateDailyBrief` refused to rewrite a `ready` brief, with a real justification —
*"rewriting settled advice would mean the user sees it change under them on a reopen"* —
and the result was a brief written at 07:00 telling someone at 21:00 they had drunk 250 ml
when they had since drunk two litres.

## Decision

### A grounding pack, assembled server-side, scoped to the authenticated user.

`GroundingPack` composes the day (`DailyContext`, unchanged in kind) with a fortnight of
daily history, the last two days of named meals, the fortnight's movement sessions, and
the plan's targets. `BuildGroundingPackUseCase` builds it from that user's own rows, before
the model is called. No query is shaped by model output and there is no path from a reply
back into a read — this is a pack the API hands over, not database access the model has.

**The windows are the shortest that answer their question**, because the pack competes with
the reply for the same budget:

| Section | Window | Why |
|---|---|---|
| Daily history | 14 days | The fortnight the whole app already reasons in — `RestingHeartRateBaseline::WINDOW_DAYS`, the insights screen, and `CalculateRecoveryScoreUseCase`, which calls anything older "archaeology". Answers "last week" with a week of margin. |
| Named meals | 2 days | The widest rows in the pack; a name is unbounded where everything else is an integer. Nobody asks what they ate a week last Tuesday, and older days keep their calorie totals in the history line. |
| Sessions | 14 days, capped at 10 | Same span as the rest; the cap stops a user who trains four times a day pushing the history out of the prompt. |

A fully populated worst case — fourteen recorded days, sixteen named meals, ten sessions, a
complete plan — renders to roughly **2,400 tokens** including the instruction. That is a
fraction of the input window and it never competes with the 2,048-token output budget.

### Provenance survives into the prompt, or the number does not go in.

This codebase distinguishes measured from estimated everywhere, and a model told
"1,800 kcal" will say "you ate 1,800 calories". So every figure that can be two different
measurements is rendered *as* what it is: `NutritionTotals`' measured/estimated split
reaches the model as `est 1200 kcal`, `MealSource` as "a vision model's guess from a
photograph, not measured", `steps_are_complete` as `partial` with a legend saying a partial
count is a floor, `RestingHeartRateSource` as `overnight` or `seated` with a legend saying
the two must never be averaged together, `provisional` beside any score computed without a
personal baseline, and the plan's `basis` sources in words so "a population default" cannot
be paraphrased into "your target".

Nulls stay nulls. A day nobody recorded is dropped from the table and the window still
states how many days it covers, so a fortnight with four recorded days cannot read as ten
days of inactivity.

### More context makes the guardrails matter more, not less.

ADR&nbsp;0005 put the rules in the prompt and the prompt under test. A model holding one
day can be wrong about one day; a model holding a fortnight can be confidently wrong about
a trend. Four rules were added to both builders and each has a test:

- Counting is allowed, inventing is not. "Three of the last seven nights were under six
  hours" is a fair reading; every number must appear in the pack or be a plain count or
  difference of numbers that do.
- A gap is a gap — never inactivity, never a decline, never anything.
- No causal claim between two series, and no mechanism offered for a trend.
- No pooling across kinds: seated against overnight, partial against whole, estimated
  against measured.
- And, plainly: if the pack does not contain the answer, say so and stop.

### The brief is a function of its context, so the context is fingerprinted.

`ContextFingerprint` hashes a canonical, **bucketed** rendering of the pack, stored on
`daily_briefs.context_fingerprint`. A `ready` brief is rewritten when — and only when —
that fingerprint has moved. Bucketing is the whole design: a fingerprint over raw values
would make a water tap every twenty minutes an LLM call every twenty minutes.

Magnitudes are bucketed to the coarseness at which they would change a sentence — water
500 ml (a quarter of the default target, twice the app's own glass), steps 2,000 (about a
quarter of a step goal), recovery 5, sleep 30 minutes, resting rate 2 bpm. Facts are
carried exactly, because they have no degrees: the illness flag, whether a count is
complete, whether a score is provisional, how a rate was taken. Past days are bucketed
coarser still, since their only independent mover is a backfill.

The day part — morning, afternoon, evening — is in the fingerprint and in the prompt. It is
why the same figures at breakfast and at nine in the evening are two contexts, and being
three-valued it is worth at most two rewrites in a day.

### A floor of thirty minutes between rewrites.

The job decides *whether*; `DailyBriefController` decides *how often it may be asked*. The
client polls every few seconds, so without a floor a burst of logging is a burst of paid
calls. Thirty minutes is chosen against the narrowest bucket rather than for roundness:
nobody drinks four glasses of water in half an hour, so the floor never suppresses a change
the reader would notice — only the same change being noticed twice. `refresh` is
deliberately exempt: that is a button a person pressed.

Because the client stops polling once a brief is ready, the response carries `rewriting`
when a re-examination is in flight, and the dashboard keeps asking a little longer. Without
it the rewrite lands after the client has stopped listening and the reader meets it
tomorrow. It is not a status — the current advice stays on screen, unchanged, while the
check runs.

## Consequences

**Good.** The assistant answers the questions it is actually asked, from the user's own
data, with the provenance intact. The brief changes when the day changes and not otherwise,
which is a better answer than either "never" or "every hour". The safety position is
stronger than before rather than weaker, and the new rules are tested the same way the old
ones were.

**Bad.** The prompt is roughly three times the size it was, so every call costs more — the
mitigation is that the fingerprint means far fewer of them. A bucket boundary is still a
boundary: a single water tap that happens to straddle one can trigger a rewrite, bounded by
the floor. And the pack is one more thing that must stay scoped; the feature test that
proves another user's rows never appear is the one to keep.

**Explicitly still not done.** No streaming, no function calling, no retrieval over past
briefings, and no per-user timezone — the day part is read from the server clock, which is
right for a single-region coursework deployment and wrong for anything wider.
