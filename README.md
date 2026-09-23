# Voice Router — team 404

HackAlem AI, Case 2: a Russian/Kazakh voice assistant for the fictional Saqta Insurance contact centre. Halyk Bank sponsors the case; the service uses the organizer's **synthetic** scenario and reference data, not live bank or customer records.

## Run locally

Requirements: Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js 20+, npm, and server-side `OPENAI_API_KEY` and `GEMINI_API_KEY`. Never put keys in `frontend/.env`, browser code, or Git.

```sh
bash scripts/run-local.sh
```

The script installs locked Python and frontend dependencies, starts the backend at `127.0.0.1:8000`, and serves the app at [http://localhost:5173](http://localhost:5173). Allow microphone access in the browser. Speak naturally in Russian, Kazakh, or a mixture; text is a supplementary input. The assistant voice is AI-generated. Open the trace icon after a turn to inspect the chosen scenario, alternatives, rationale, and stage timings. The sidebar contains conversation history and the supervisor panel.

The app does **not** switch to a mock if an upstream service is unavailable. It shows an error. API keys remain on the local server; the browser receives only a short-lived Gemini Live token.

## System and evidence

Gemini 3.8 Live handles streaming microphone input, natural RU/KK dialogue, spoken output, and interruption. Insurance requests call the backend through a Live tool. OpenAI `gpt-6-luna` selects an ordered route from the 40 official scenarios using dialogue context and extracts the required values. Case actions run under approval rules and return verified results to Gemini Live for speech. A backend session holds at most ten customer turns. The browser displays the real route trace in human-readable form. The separate HTTP audio endpoint remains available for backend diagnostics. The Jev extraction gate was removed after its external call caused intermittent request failures; it is not part of the current request path.

The official starter kit is preserved in `data/voice_router_dataset/`. The backend modules are in `backend/voice_router/`; the React/Vite frontend is in `frontend/`. The [HTTP contract](docs/BACKEND_API.md) describes the server endpoints. The [Russian functional specification and implementation plan](docs/VOICE_ROUTER_PLAN_RU.md) explains the architecture and approval policy. Experiments are recorded separately in [docs/experiments](docs/experiments).

On the official 104-utterance **development** set, the selected Luna router achieved 104/104 exact ordered routes. This set informed development and is **not** hidden-set accuracy. Eleven of eleven scorable recordings from the two backend team members routed as expected in the [real-voice check](docs/experiments/2026-09-23-real-voice.md). Its 6,678/9,339 ms median/p95 server timings describe the earlier sequential STT/TTS path, **not** the current Gemini Live browser path. Review the [Luna/Sol comparison](docs/experiments/2026-09-23-luna-sol-routing.md) for the model decision. Live browser first-audio latency and microphone behavior still require owner acceptance.

The organizer's evaluator can be rerun without an API call:

```sh
uv run python data/voice_router_dataset/evaluate.py docs/experiments/results/luna-dev-predictions.json data/voice_router_dataset/dev_utterances.json
```

## Boundaries

The supplied records, prices, and policies are synthetic. Actions and handoff requests exist only in the server process; no payment, SMS, live operator connection, or real booking system is attached. Irreversible changes require a distinct interpreted confirmation turn. A phone match in the supplied records is not production-grade customer authentication. Sessions and generated speech disappear on server restart. The public single-container deployment requires `VOICE_ROUTER_BASIC_AUTH` (`username:password`) and serves the built frontend and API on one origin; model API keys remain server-side. The local development server is bound to loopback. There is no rate limiting.

Sources: [Case 2 technical specification](https://docs.google.com/document/d/1e-F3ahQwPSdRMugpLO1vQ0_gFf5q9hIATUt0GxC3bEM/edit), [starter kit](https://drive.google.com/file/d/1sHE56gXnzdscHz5lMcNbwd1VsJIVLFUv/view), [regulations](https://edu.astanahub.com/hackathons/df4743f5-c492-415c-b45a-1f13adb78e06?tab=regulations), [OpenAI voice-agent guide](https://developers.openai.com/api/docs/guides/voice-agents).
