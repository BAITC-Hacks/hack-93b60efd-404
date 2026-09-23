# Experiment: can GPT-6 Luna route the difficult catalogue cases without Sol?

**Status:** Luna selected-slice run completed; Sol comparison blocked by a temporary DNS failure.

**Date:** 2026-09-23
**Decision:** whether the direct LLM router can use Luna, or requires Sol for quality.

## Hypothesis and setup

The full official 40-scenario catalogue and its `not_this_if` boundaries were sent to the OpenAI Responses API as structured context. The router returned ordered scenario IDs, alternatives, language, continuation flag, and rationale using Pydantic structured output. Both candidates were configured with `reasoning.effort=none`; no keyword-based intent rules were used. The chosen 17 official utterance IDs were fixed before the runs: U001, U002, U004, U033, U045, U061, U081, U082, U083, U087, U093, U094, U095, U098, U099, U102, U103. This slice includes RU, KK, mixed, multi-intent, out-of-scope, and unclear requests. It is a selected development slice, not a held-out sample or the jury's hidden set.

The command was `uv run python -m voice_router.evaluate_router --model gpt-6-luna --ids <the IDs above> --output artifacts/luna-comparison.json` with the real key supplied from macOS Keychain to the process environment. Source data: unchanged official `data/voice_router_dataset/`. Raw predictions were written to `artifacts/luna-comparison.json` locally and excluded from Git.

## Observations

Luna returned the exact expected **ordered** scenario list for **17/17** selected utterances. The first real call succeeded after correcting a locally truncated Keychain value; the full selected run then completed. Median router time was **2,042.8 ms**; empirical p95 by nearest-rank indexing was **3,474.0 ms**. Provider-reported usage summed to **94,102 input tokens** and **1,235 output tokens**. The observed per-turn range was 1,585–3,518 ms. No first-audio measurement exists because the voice path is not built. API-dollar cost is not reported here: token usage is measured, but billing was not independently checked. The 500 ms routing bonus is not achieved on this slice.

Sol was attempted with the exact same IDs and configuration. The request did not reach OpenAI because `api.openai.com` failed DNS resolution on this machine (`httpx.ConnectError: [Errno 8]`). There is **no Sol quality or latency result** yet. We will retry the same run when DNS recovers, without using a mock response or changing the input set.

## Interpretation and next action

The selected slice shows that Luna can handle representative boundaries, Kazakh, mixed speech text, and two-intent requests. It does not establish full-set accuracy, dialogue continuity, or spoken performance. Sol may still help on errors from the remaining official utterances or ten sequential dialogues, but no improvement should be claimed without a matched run. Next: retry Sol, run the organizer evaluator over full predictions, inspect errors manually, and reduce router latency without losing catalogue coverage.
