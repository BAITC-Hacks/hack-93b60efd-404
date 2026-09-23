# Voice Router — team 404

Case 2 of HackAlem AI: a Russian/Kazakh voice assistant for the fictional Saqta Insurance scenario catalogue. The challenge is context-aware routing across 40 scenarios when the customer changes topic, combines requests, or switches language. A supervisor must be able to inspect each decision and its timing.

**Status: partial backend implementation.** The text router works against the official catalogue, but there is no complete dialogue/voice application or deployment yet. This README is not submission-ready.

## Implemented capabilities

The official 40-scenario kit is present without content changes. The backend validates scenario/action/slot references and uses the OpenAI Responses API for a structured, catalogue-backed text routing decision. A real `gpt-6-luna` run routed 17/17 selected development utterances correctly; this is a **small selected slice, not full-set or hidden-set accuracy**. See the [Russian functional specification and backend implementation plan](docs/VOICE_ROUTER_PLAN_RU.md) and [experiment record](docs/experiments/2026-09-23-luna-sol-routing.md).

## Main flow

Planned: microphone → transcript → context-aware LLM route → permitted data-backed action or clarification → spoken answer → supervisor trace. Text entry will supplement voice. This flow is not yet available.

## Architecture and technology

Not finalized. Nikita and Altinay jointly own backend work: dialogue state, routing, action validation, voice integration, and trace events. Frontend implementation is outside this repository plan. Model and audio-transport decisions will follow measured experiments.

## Requirements, install, and run

For the current text-router slice: install `uv` and run `uv sync` from the repository root with Python 3.12. Set a valid server-side `OPENAI_API_KEY` in the process environment, then run `uv run python -m voice_router.evaluate_router --model gpt-6-luna --limit 1 --output artifacts/luna-one.json`. This exact route was exercised against the real OpenAI service and official input. `TYPESAFE_API_KEY` will be needed only if the optional Jev experiment runs. Neither key belongs in Git or browser code. A one-command startup and judge-accessible voice verification path do **not** exist yet.

## Reproduce the evaluation

The official kit supplies `scenarios.json`, `dialogs_sample.json`, `dev_utterances.json`, `evaluate.py`, and synthetic reference data. Exact commands, model configuration, and observed results will be added after real runs. The ten hidden jury utterances are not available to the team.

## Data, integrations, licenses, limitations

The assessment company is fictional Saqta Insurance; Halyk Bank is the case sponsor, not a source for live product scraping. OpenAI and optionally TypeSafe are external services. Actual packages, model versions, third-party licenses, data sources, deployment URL if any, and remaining limitations will be documented from the final build. No real customer call recordings or personal customer data are used. The 500 ms routing and 1.5 s first-audio targets are not yet achieved claims.

Sources: [Case 2 technical specification](https://docs.google.com/document/d/1e-F3ahQwPSdRMugpLO1vQ0_gFf5q9hIATUt0GxC3bEM/edit), [starter kit](https://drive.google.com/file/d/1sHE56gXnzdscHz5lMcNbwd1VsJIVLFUv/view), [regulations](https://edu.astanahub.com/hackathons/df4743f5-c492-415c-b45a-1f13adb78e06?tab=regulations).
