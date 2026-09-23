# Experiment: can GPT-6 Luna route the difficult catalogue cases without Sol?

**Status:** completed on the official development set; hidden-set and voice quality remain unmeasured.

**Date:** 2026-09-23

**Decision:** whether the direct LLM router can use Luna, or requires Sol for quality.

## Hypothesis and setup

The full official 40-scenario catalogue and its `not_this_if` boundaries were sent to the OpenAI Responses API as structured context. The router returned ordered scenario IDs, alternatives, language, continuation flag, and rationale using Pydantic structured output. Both candidates were configured with `reasoning.effort=none`; no keyword-based intent rules were used. The chosen 17 official utterance IDs were fixed before the runs: U001, U002, U004, U033, U045, U061, U081, U082, U083, U087, U093, U094, U095, U098, U099, U102, U103. This slice includes RU, KK, mixed, multi-intent, out-of-scope, and unclear requests. It is a selected development slice, not a held-out sample or the jury's hidden set.

The selected-slice command was `uv run python -m voice_router.evaluate_router --model gpt-6-luna --ids <the IDs above> --output artifacts/luna-comparison.json`; the same IDs were passed to Sol. The full Luna command omitted `--ids` and wrote `artifacts/luna-full.json`. The real key was supplied from macOS Keychain to the process environment. Source data: unchanged official `data/voice_router_dataset/`. Raw predictions remain local under ignored `artifacts/`.

## Observations

On the 17 matched cases, **Luna and Sol both got 17/17 exact ordered routes**. Luna's median/p95 routing time was **2,042.8 / 3,517.6 ms**; Sol's was **2,442.6 / 3,963.3 ms**. Both consumed **94,102 input tokens**; output was **1,235** for Luna and **1,254** for Sol. Sol gave no accuracy gain on this slice and was slower. These timings include the real provider call and current network conditions, not audio. p95 uses the nearest-rank method, i.e. sorted index `ceil(0.95*n)-1`.

The first Sol attempt failed before the API because this Mac's system DNS stopped resolving `api.openai.com`. A public DNS server returned the current OpenAI address; a temporary **process-local DNS pin** then allowed the same real HTTPS endpoint and unchanged router code to run. No system DNS setting or product code was changed. This network condition is a limitation of the latency comparison, not of routing accuracy.

The first full Luna pass was evaluated by the organizer's `evaluate.py`: **primary accuracy 0.981, full match 0.971 (101/104), multi-intent recall 1.000**. It used **575,492 input** and **7,783 output tokens**; median/p95 router time was **1,946.7 / 3,157.8 ms**. The three mismatches were U005 (an unnecessary extra intent), U039 and U055 (unnecessary clarification despite a clear request with missing parameters). We changed one general instruction: missing slots should not be confused with ambiguous intent, and a product attribute should not become an independent task. No utterance-specific phrase rule was added.

The revised prompt fixed all three original mismatches on a short repeat and then scored **primary accuracy 0.990, full match 0.990 (103/104), multi-intent recall 1.000** on the full official development set. All **45 KK**, **7 mixed-language**, and **13 multi-intent** cases matched. Median/p95 router time was **1,861.3 / 2,576.5 ms**; usage was **581,628 input** and **7,759 output tokens**. One new mismatch appeared: U035, a request for documents after water damage, was sent to `SYS_UNCLEAR` instead of `SC18`. We did not add a phrase-specific fix for this dev example. Because the revised prompt was informed by this same development set, **103/104 is a tuned dev result, not an independent generalization estimate**.

The official evaluator was run against the actual prediction map extracted from each complete result. The revised [104-case prediction map](results/luna-dev-predictions.json) is committed so the official evaluator can be rerun without spending API credit: `uv run python data/voice_router_dataset/evaluate.py docs/experiments/results/luna-dev-predictions.json data/voice_router_dataset/dev_utterances.json`. The full provider trace remains local. API-dollar cost is not reported: token usage is measured, but billing was not independently verified.

## Interpretation and next action

Keep **Luna** as the default text router: the matched Sol run showed no quality benefit and had higher latency. This decision can change if sequential dialogues or real speech expose a Luna-specific failure. That initial comparison did not establish hidden-set accuracy, dialogue continuity, or spoken performance. The subsequent backend work added dialogue, data-backed case actions, and real voice; it did not optimize solely to the public 104 labels.

## Final backend acceptance recheck

After the dialogue and voice backend existed, one complete real-API recheck of the router found a false `SYS_UNCLEAR` decision where the model itself named a single plausible scenario but treated a missing product detail as ambiguous intent. We added a **general** second review only when `SYS_UNCLEAR` has proposed alternatives; it asks whether the requested operation is clear despite missing parameters, and otherwise preserves the clarification. No utterance ID, phrase-to-scenario map, or fixed expected answer is in the router. The review ran on **2 of 104** development utterances in the final full pass.

The final full pass and the organizer's unchanged `evaluate.py` returned **104/104 exact ordered routes**: 52/52 RU, 45/45 KK, 7/7 mixed, and 13/13 multi-intent. Median/p95 router wall time was **2,241.2 / 3,717.4 ms**, with **590,381 input** and **7,570 output tokens** across all router calls including the two reviews. The exact final prediction map is in `results/luna-dev-predictions.json`. This is a development-set acceptance result after seeing that set, **not** an unbiased estimate of hidden-jury accuracy. The extra review improves route quality at the cost of latency on the rare reviewed path. Earlier experiment figures remain above as historical runs, not current production metrics.
