# 5. LLM advice, with the guardrails in the prompt and the prompt under test

Date: 2026-08-21

## Status

Accepted. Two parts of it are superseded by ADR&nbsp;0008, which widens the closed set from
one day to a fortnight-wide grounding pack and replaces "a `ready` brief is never
rewritten" with a fingerprint of the context it was written from. Everything below about
where the guardrails live, and why they are tested, still holds — and 0008 adds to them
rather than relaxing them.

## Context

The assignment is titled *AI-Driven Smart Lifestyle Companion*. The app had machine
learning — an on-device logistic regression predicting focus readiness — but nothing that
reads a day's measurements and says something useful in words. The project README also
already claimed an `LlmService` that did not exist.

By this point the data was there to make it worth doing: recovery score with its
provisional and illness flags, sleep duration and stages, resting heart rate, steps,
water, weather, location context and a focus window. That is a genuinely rich, entirely
real prompt.

The obvious risk is equally real. **This is a health app, and a language model asked about
sleep and heart rate will speculate about conditions unless told not to.** An unconstrained
assistant here is not a rough edge; it is a different and much more serious product.

## Decision

### Gemini, called only from the server.

`GEMINI_API_KEY` lives in `config/services.php`, never in the bundle. `EXPO_PUBLIC_*`
variables are inlined into the JavaScript and readable from the APK, so a model key
shipped that way is a bill anyone can run up. Same pattern as the weather key
(ADR&nbsp;0004), and the client is coupled to our shape rather than the provider's, so
swapping model or vendor is a change to `app/Infrastructure/Advice/GeminiClient.php` alone.

Gemini specifically because it has a genuine free tier, which matters for a coursework
project that must be reproducible by a marker without a credit card.

### The guardrails live in the prompt, and the prompt is a pure function.

`app/Domain/Advice/Service/DailyBriefPromptBuilder.php` and `ChatPromptBuilder.php` are
plain classes with no I/O. Their rules, in priority order: never diagnose or name a
condition; never suggest, dose or discourage a treatment; only refer to figures supplied;
never invent or infer a number; do not claim causation; do not be alarming; describe an
estimate as an estimate. The chat instruction adds scope-limiting (it declines politics,
code, trivia) and a crisis response that points to emergency services rather than
attempting counselling.

**A model's reply cannot be asserted against a golden value, but what we ask it can be** —
and everything that decides whether this feature is responsible is in the asking. So the
prompt builders carry 11 unit tests: that diagnosis and treatment are forbidden, that
inventing figures is forbidden, that causation claims are forbidden, and — the one that
matters most — that **a measurement the app does not have never appears in the prompt at
all**, because a model shown an empty slot will fill it.

### Only a closed set of facts may reach the model.

`DailyContext` is a value object listing exactly what the briefing and the assistant may
know. Widening that is a deliberate edit to one class rather than something that happens
when a controller passes more along. A test asserts the user's name and email are never
sent — the model sees figures, never an identity.

### Generation is queued; the request never waits.

`GenerateDailyBrief` runs on Laravel's queue. A model call takes seconds and a phone
opening a dashboard should not block on one, so the endpoint creates a `pending` row,
dispatches, and the client polls — the same cache-then-network shape the rest of the app
already uses. Briefs are persisted per user per day: the same figures yield the same
advice, so regenerating is waste, and advice the user has already read should not silently
reword itself on reopen. A failure is recorded with a reason so the UI can say something
truthful instead of spinning.

### The assistant refuses to brief on nothing.

`DailyContext::isSufficient()` requires a recovery score, a sleep figure or a heart rate
before any generation happens. A briefing written from an empty day is the model producing
filler, which is precisely the failure this feature most has to avoid.

## Consequences

**Good.** The app's title becomes literal, and the README's claim becomes true. The
architecture is genuinely cloud-integrated — queued background work, a third-party API,
cached and rate-limited — which is real evidence rather than an assertion. Every route is
scoped to the authenticated user; a test proves one account cannot reach another's thread.
And the safety position is testable, which is unusual for an LLM feature and is the part
worth defending in the report.

**Bad.** Prompt-level guardrails are strong but not guarantees: a determined user can
still coax an unhelpful reply, and Gemini's own safety filter can block a legitimate
health question, which surfaces as "the assistant isn't available". Output is
non-deterministic, so the same day can read differently on a forced refresh. A queue worker
must be running (`php artisan queue:work`) or briefs stay `pending` — fine for a demo,
but a real deployment needs a supervised worker.

**Explicitly not done.** No streaming, no function calling, no retrieval over past
briefings, and no attempt at personalisation beyond one day's figures. Each would widen
what the model can say, and widening that is the thing this ADR exists to make deliberate.
