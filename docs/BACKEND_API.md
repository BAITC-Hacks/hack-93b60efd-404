# Backend HTTP contract

This document is for the separate browser implementation. The backend is a local, chained voice service, not a WebSocket or full-duplex Realtime service. It accepts a completed microphone recording, then returns the final transcript, scenario decision, response text, trace, and generated MP3 URL. Do not place `OPENAI_API_KEY` in browser code.

## Start and base URL

From the repository root, after `uv sync` and setting server-side `OPENAI_API_KEY`:

```sh
uv run python -m voice_router.server
```

The default base URL is `http://127.0.0.1:8000`. `VOICE_ROUTER_HOST` and `VOICE_ROUTER_PORT` change the listener; `VOICE_ROUTER_CORS_ORIGIN` restricts the allowed browser origin. The default CORS wildcard is suitable only for local development. `GET /health` reports process liveness, not OpenAI availability.

## One browser conversation

1. `POST /sessions` with no body. The response is HTTP 201 and contains `session_id`.
2. Record a single finished customer utterance with `MediaRecorder`. Upload its actual bytes with `POST /sessions/{session_id}/turns/audio`, using the matching `Content-Type`. Supported types: `audio/webm`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/mpeg`, `audio/mp3`, and `audio/m4a`. Maximum body size: 10 MB. Do not wrap the audio in JSON or multipart form data.
3. Read `answer_text` and `trace`, and play the returned `audio_url` by resolving it against the backend base URL. `audio_url` points to an `audio/mpeg` response. Tell the user that the voice is AI-generated.
4. Reuse the same session ID for further turns. The service retains at most ten customer turns and can return `active_scenario` and `pending_scenarios` for an interrupted or combined request. A write-action approval must be recorded and sent as a **new voice turn**, not a UI-only button that silently changes server state.

For text-only diagnostics, `POST /sessions/{session_id}/turns/text` accepts `application/json` with `{"text":"...","speak":true}`. Setting `speak` to true also returns an MP3 URL. Text is supplementary; the hackathon's primary path is microphone speech.

## Response fields

Every successful turn returns `session_id`, `turn`, `answer_text`, `language` (`ru` or `kk`), ordered `route` IDs, `active_scenario`, `pending_scenarios`, and `trace`. Spoken turns also include `audio_url` and `audio_content_type`. Render `route`, `trace.reason`, and `trace.alternatives` in the supervisor view; do not hide the model decision behind the conversational answer.

`trace` includes the final `transcript`, selected scenario IDs, alternatives, short reason, model name, `router_ms`, `extractor_ms`, `stt_ms` (audio turns), `tts_generation_ms` (spoken answers), `server_total_ms`, token counts, rejected slots, and action results. `tts_first_audio_ms` is currently null because actual browser playback start is not instrumented. Do not label `tts_generation_ms` as first-audio latency. For compound requests, display every ID in `route` and the deferred IDs in `pending_scenarios`.

An irreversible action returns `trace.actions[].status = "awaiting_confirmation"` and asks the customer to approve or cancel. The next spoken reply is interpreted by the LLM in that pending-action context. Only an unambiguous approval allows execution. The same action parameters are not executed twice in one session. Some non-irreversible case actions create a local record, but no external SMS, payment, live operator call, or actual booking is claimed.

## Failure handling

HTTP 404 means the endpoint or session/audio ID is unknown. HTTP 422 means the body, content type, recording, or dialogue limit is invalid. HTTP 502 means the external AI request failed. HTTP 500 is an internal error. Keep the same session if a request failed before a turn was accepted; do not play a fabricated success response. UI should show the returned `error` text and allow a retry or a human handoff.

All sessions, generated MP3s, and local case action records exist only in the server process. Restarting the service invalidates their IDs. This local service has no public authentication or rate limit and must not be exposed directly to the internet.
