# Voice Router — team 404

Case 2 of HackAlem AI: a Russian/Kazakh voice assistant for the fictional Saqta Insurance scenario catalogue. The challenge is context-aware routing across 40 scenarios when the customer changes topic, combines requests, or switches language. A supervisor must be able to inspect each decision and its timing.

**Status: planning. No runnable application, measured result, or deployment exists in this repository yet.** This README will be updated from verified implementation before submission; proposed behavior is not presented as delivered behavior.

## Implemented capabilities

None yet. See the [Russian functional specification and backend implementation plan](docs/VOICE_ROUTER_PLAN_RU.md) and [experiment protocol](docs/experiments/README.md).

## Main flow

Planned: microphone → transcript → context-aware LLM route → permitted data-backed action or clarification → spoken answer → supervisor trace. Text entry will supplement voice. This flow is not yet available.

## Architecture and technology

Not finalized. Nikita and Altinay jointly own backend work: dialogue state, routing, action validation, voice integration, and trace events. Frontend implementation is outside this repository plan. Model and audio-transport decisions will follow measured experiments.

## Requirements, install, and run

No verified install or run command exists yet. The real OpenAI path will require a server-side `OPENAI_API_KEY`; `TYPESAFE_API_KEY` will be needed only if the optional Jev experiment runs. Neither key belongs in Git or browser code. This section must contain a tested one-command start, exact prerequisites, and a judge-accessible verification path before submission. **This README is not submission-ready.**

## Reproduce the evaluation

The official kit supplies `scenarios.json`, `dialogs_sample.json`, `dev_utterances.json`, `evaluate.py`, and synthetic reference data. Exact commands, model configuration, and observed results will be added after real runs. The ten hidden jury utterances are not available to the team.

## Data, integrations, licenses, limitations

The assessment company is fictional Saqta Insurance; Halyk Bank is the case sponsor, not a source for live product scraping. OpenAI and optionally TypeSafe are external services. Actual packages, model versions, third-party licenses, data sources, deployment URL if any, and remaining limitations will be documented from the final build. No real customer call recordings or personal customer data are used. The 500 ms routing and 1.5 s first-audio targets are not yet achieved claims.

Sources: [Case 2 technical specification](https://docs.google.com/document/d/1e-F3ahQwPSdRMugpLO1vQ0_gFf5q9hIATUt0GxC3bEM/edit), [starter kit](https://drive.google.com/file/d/1sHE56gXnzdscHz5lMcNbwd1VsJIVLFUv/view), [regulations](https://edu.astanahub.com/hackathons/df4743f5-c492-415c-b45a-1f13adb78e06?tab=regulations).
