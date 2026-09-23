# Voice Router: backend implementation and evidence plan

**23 September 2026 · Status: proposed, not implemented.** This plan covers the backend, model experiments, integration contract, reproducibility, and evidence. A teammate owns the frontend.

## Source of truth and scoring

The [official Case 2 specification](https://docs.google.com/document/d/1e-F3ahQwPSdRMugpLO1vQ0_gFf5q9hIATUt0GxC3bEM/edit) requires web microphone input and spoken output, a context-aware **LLM** at the scenario-selection point, Russian/Kazakh with switching, and a supervisor trace after every turn: transcript, chosen scenario, rationale, alternatives, and stage timings. Text is supplementary. The fictional Saqta Insurance starter kit has 40 scenarios, 10 annotated dialogues, development utterances, an evaluator, and synthetic knowledge/action data. The jury has 10 hidden utterances, including two in Kazakh and one mixed-language. Encoder-style intent classification, phrase matches hard-coded to the test set, real customer recordings, and irreversible actions without explicit confirmation are prohibited. Routing quality matters more than speech-model quality. The 500 ms router and 1.5 s end-of-speech-to-first-audio targets are **bonuses**, not gates.

The **current task-specific technical scale** is working task fit 25, technical implementation 25, README/reproducibility 25, value/applicability 15, and development potential/originality 10. The [current regulations](https://edu.astanahub.com/hackathons/df4743f5-c492-415c-b45a-1f13adb78e06?tab=regulations) delegate technical scoring to the task specification. Their earlier general scale—problem/value 15, prototype function 25, technical implementation 15, practical use 15, growth 20, README 10—is historical, **not** the active score. Demo Day is a separate 100-point assessment: value 25, result/quality 20, innovation 15, scaling 20, presentation/demo/Q&A 20. AI may assist preliminary assessment but does not replace human experts or jury.

Admission and provenance are independent of point optimization: the app must launch from README; its main flow must be checkable without team members' private accounts; the main work and confirmable progress each hour must exist in the official repository; third-party code/models/data must be disclosed; work after 18:00 is not evaluated. The competition development window is 13:00–18:00 Astana time. A visually persuasive but nonfunctional demo is not enough.

## Backend architecture

The shared operation is `process_turn(session_id, transcript, turn_metadata)` returning a validated route, answer, trace, and updated state. Voice and supplementary text feed the same operation. Load all 40 original scenario definitions from `scenarios.json`; include boundaries, exclusions, bilingual examples, valid slots, and actions. Do not encode evaluation utterances as keyword rules. The model sees the current utterance, relevant history, and catalogue, and outputs typed primary/secondary scenario IDs, alternatives, language, continuation/switch signal, extracted parameters, and a short evidence-based rationale. Code validates IDs, slots, permissions, and source facts. Structured output enforces shape, not truth.

State stores the active scenario, paused tasks, response language, collected slots, customer identification, pending confirmation, completed action IDs, and up to ten turns. The model interprets what the customer means; code owns transitions, idempotency, and business rules. A two-part request must preserve both intents. A topic switch pauses rather than erases the prior task. Unresolved ambiguity triggers a focused question; a case the system cannot resolve triggers operator handoff with context. A model-generated confidence number is not treated as calibrated probability.

The executor reads `knowledge_base.json`, `mock_backend.json`, `slots.json`, and `actions.json` from the starter kit. Halyk Bank is the sponsor; the assessed company is the **fictional insurer**, so do not scrape real bank products. All 40 original scenario IDs should be routable. Downstream actions may be implemented in stages, but an unavailable action must not be reported as performed. Before changing a policy, claim, appointment, or other irreversible state, summarize exact parameters and require a separate explicit confirmation. Repeated “yes” must not duplicate execution. No real customer personal data goes to external APIs.

First vertical slice: one real text utterance → OpenAI LLM route → catalogue validation → data-backed answer or clarification → trace. Next: dialogue state, action/confirmation handling, then a real microphone-to-spoken-answer path. This sequence preserves a usable product if a more elaborate voice architecture takes too long.

## Model and audio experiments

**A — Direct OpenAI LLM:** a fast text model makes the substantive selection over 40 scenarios plus system outcomes. Record exact model ID, prompt version, input catalogue, response, latency, token usage, and error cases. Compare a stronger model only when observed errors justify it. This is the compliance baseline because the task explicitly requires LLM decision-making.

**B — Jev exploratory:** TypeSafe Jev `Choice` can select a candidate with a distribution and confidence. Separate narrow judgments may detect a second task or a topic switch. Jev neither transcribes audio nor synthesizes speech nor generates a full rationale. Its 40-way Russian/Kazakh/mixed performance is unmeasured, and Jev alone may fail the specification's LLM-routing requirement. Test, do not assume. [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice), [API](https://docs.typesafe.ai/api).

**C — Jev + OpenAI LLM:** Jev proposes candidates; the LLM must independently make or correct the final substantive route and explain it. Compare sequential with parallel calls. Two network calls may be slower and costlier than A. A Jev-only fast path cannot silently bypass the LLM requirement; use it only if organizers accept the interpretation and real measurements support it. [TypeSafe confidence](https://docs.typesafe.ai/confidence).

**Voice path 1 — chained:** microphone audio → OpenAI transcription → shared router/action operation → OpenAI TTS → browser playback. This gives the cleanest error attribution and trace. **Voice path 2 — Realtime:** `gpt-realtime-2.1` handles low-latency speech turns and interruptions while the server retains catalogue decisions and action checks. **Voice path 3 — full duplex:** `gpt-live-1` delegates backend reasoning/tool work while listening and speaking simultaneously. There is no verified “GPT Live 2” model in the official catalogue used for this plan. Realtime/Live complexity and cost are justified only if a working chained path already exists and a bounded comparison changes the decision. [Realtime guide](https://developers.openai.com/api/docs/guides/realtime), [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1).

Measure end-of-speech, transcript final, router start/end, action start/end, synthesis start, and first **meaningful audible** chunk. Do not count a filler “one moment” as successful fast routing. A voice model must never bypass validated scenario IDs and action confirmation. A permanent provider key stays server-side; direct browser Realtime requires a server-minted ephemeral secret.

## Evaluation and decision loop

Use the official `dev_utterances.json` and `evaluate.py` without altering the kit. Reserve a held-back slice **before** prompt tuning. Run A, B, and C on the same input IDs and context, keeping predictions in the evaluator's expected format. Report first-route accuracy, all-intent retention for compound requests, clarification/handoff quality, and Russian/Kazakh/mixed/boundary/topic-switch breakdowns. For each mistake, record input ID, expected and observed route, whether transcription or routing failed, and the specific catalogue boundary that caused confusion. Do not learn hidden judge phrases or hard-code examples from the development set.

Replay the ten supplied annotated dialogues **sequentially** to examine state, topic return, confirmation, and handoff. Then do a small live microphone pass using team-spoken Russian, Kazakh, and mixed utterances. Separate speech-recognition errors from router errors. Report median/p95 stage latency, meaningful first-audio latency, and provider-reported usage/cost. The user's $50 OpenAI credit is a real spending limit, not a reason for unbounded sweeps. Each run needs a question that can change a product decision. An experiment is successful when it identifies the better architecture or a concrete failure, not when it generates a flattering number.

Record each decision-relevant run under [`docs/experiments/`](experiments/README.md) with hypothesis, exact dataset/model/prompt/command, measured metrics, failure cases, conclusion, and next decision. Keep plans and actual results explicitly separate. Do not commit secrets, real personal data, private audio, or fabricated traces.

## Backend/frontend contract

Agree on one typed contract before locking in transport. Input: `session_id`, turn ID, audio or supplementary text, client timing markers. Events: `transcript_final`, `route_decision`, `clarification_required`, `action_preview`, `confirmation_required`, `answer_text`, `audio_chunk` or audio URL, `handoff`, `turn_complete`, `error`. The trace carries valid scenario ID/name, bounded rationale, alternatives, provider/model, measured stage times, and state transition. It must not expose provider secrets or private identifiers. The backend owner supplies contract and service; the frontend owner builds the UI.

Real acceptance flow: speak into the microphone, get a valid data-backed route and spoken answer, and see the same turn's trace in the frontend. Only then optimize the model/transport.

## README and judge verification

The root README is the front door, **not** the experiment diary. Before submission, update it from working code with: name and problem/users; actually implemented features; complete microphone-to-answer flow; architecture; exact languages, libraries, model IDs and APIs; requirements and environment variables; tested one-command startup; step-by-step judge verification without private subscriptions; exact evaluator command and observed result; dataset/integration sources; third-party licensing; honest limitations; deployed URL if one exists. Every major claim should point to a real code path, command, trace, or repeatable user action. This helps people and automated repository inspection without guessing at an AI judge's private rubric. README is worth 25 technical points here and a project that cannot be started from it may fail admission.

## Ownership, Git accounts, and progress

Official repository: [`BAITC-Hacks/hack-93b60efd-404`](https://github.com/BAITC-Hacks/hack-93b60efd-404). `gh auth switch --hostname github.com --user USER` chooses which stored GitHub credential the CLI/Git helper uses; it does **not** set Git author/committer identity. Neither setting should be used to assign a commit to someone who did not make it. The rules require **verifiable individual contribution**, not equal commit counts. We will not alternate accounts to manufacture a balanced contribution graph. [GitHub CLI switch](https://cli.github.com/manual/gh_auth_switch), [Git credential helper](https://cli.github.com/manual/gh_auth_setup-git).

Suggested genuine division: Nikita owns backend, routing experiments, integration contract, and technical docs; Altyshalu owns frontend and commits her own work to a branch **in this official repository**. A real shared experiment may be jointly documented; a co-author trailer is appropriate only for actual joint authorship. Each person checks author/email, staged diff, active GitHub account, and remote before pushing. Equal logical workload is a planning target, not a quota of cosmetic commits.

Building the frontend primarily in a separate repository and importing it only at the deadline conflicts with the rule that main development and its history belong in the organizer's repository. Move ongoing work to an official-repo branch now. If prior separate-repo work must be imported, preserve its genuine ancestry/authors in a transparent one-time merge rather than squash or rewrite; ask organizers whether that work is admissible. Do not claim that a late merge proves hourly official-repo progress.

Each hour between 13:00 and 18:00 needs a **real, pushed intermediate result**: e.g. first catalogue-backed route, state/actions, voice integration, measured comparison, and final reproducibility. Commit cohesive units with conventional subjects and concise why-bodies. Do not split one unit to inflate counts or attribute it to another person. New changes after 18:00 do not count. Before final submission, verify the pushed revision, run command, and portal submission.

## Secrets and immediate sequence

The OpenAI path needs a server-side `OPENAI_API_KEY`. Jev needs a separate `TYPESAFE_API_KEY` **only if** its experiment is run; OpenAI credit does not pay for TypeSafe. Normal GitHub work uses the existing `gh` authentication, no extra GitHub token. Confirm actual model access in the provided OpenAI project before an API run; a credit balance does not imply every voice model is enabled. Keep real secrets in environment/deployment secret storage, never in chat, Git, `.env.example`, browser code, logs, or commit messages. Judge access must be arranged through an authorized deployed app or approved test credential, not a teammate's personal login. No API key has been received or used for this plan.

1. Bring the official starter kit into this official repository with provenance/redistribution checked; inspect its schemas and evaluator. Freeze a held-back slice.
2. Implement one real OpenAI text route on official input and run the official evaluator. Fix observed failures.
3. Add dialogue state, data-backed actions, confirmation, and handoff; replay supplied dialogues.
4. Connect real microphone input, spoken output, and the frontend-owned trace through the agreed contract; verify one complete flow.
5. Run bounded Jev/hybrid and Realtime/Live comparisons only if they can improve a measured weakness.
6. Replace README's planning status with verified commands/results, disclose third-party components, push before 18:00, and submit the official repository in the event portal.

This is a plan, not a claim of implemented functionality or achieved scores. Change it when real measurements warrant a change, and record why.
