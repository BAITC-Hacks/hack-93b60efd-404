# Backend HTTP contract

The browser uses Gemini Live for streaming microphone input and spoken replies. This local backend supplies short-lived Gemini tokens and resolves insurance requests through the official scenario catalogue. The separate completed-audio/MP3 endpoints remain available for backend diagnostics. Do not place provider API keys in browser code.

## Start and base URL

From the repository root, after `uv sync` and setting server-side `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `TYPESAFE_API_KEY`:

```sh
uv run python -m voice_router.server
```

The default base URL is `http://127.0.0.1:8000`. `VOICE_ROUTER_HOST` and `VOICE_ROUTER_PORT` change the listener; `VOICE_ROUTER_CORS_ORIGIN` restricts the allowed browser origin. The default CORS wildcard is suitable only for local development. `GET /health` reports process liveness, not OpenAI availability. `GET /catalog` returns the 40 official scenario labels and three system-intent labels for the supervisor view.

## One browser conversation

1. `POST /sessions` with no body. The response is HTTP 201 and contains `session_id`.
2. Request a one-use token from `POST /gemini/token`; the browser connects directly to Gemini Live with that short-lived token. The server-side Gemini key is never returned.
3. Gemini Live receives microphone audio and invokes `resolve_insurance_request` for business questions. The browser sends the tool's utterance to `POST /sessions/{session_id}/turns/text` with `{"text":"...","speak":false}` and returns `answer_text` and route information to Live for speech.
4. Reuse the same backend session ID for further business turns. The service retains at most ten customer turns and can return `active_scenario` and `pending_scenarios`. A write-action approval must be spoken as a **new turn**, not a UI-only button.

For completed-audio diagnostics, upload actual recording bytes to `POST /sessions/{session_id}/turns/audio` with the matching `Content-Type` (`audio/webm`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/mpeg`, `audio/mp3`, or `audio/m4a`; 10 MB maximum). That separate path transcribes with OpenAI and returns an MP3 URL. It is not the browser's Live path.

For text-only diagnostics, `POST /sessions/{session_id}/turns/text` accepts `application/json` with `{"text":"...","speak":true}`. Setting `speak` to true also returns an MP3 URL. Text is supplementary; the hackathon's primary path is microphone speech.

## Response fields

Every successful turn returns `session_id`, `turn`, `answer_text`, `language` (`ru` or `kk`), ordered `route` IDs plus `route_details` with human-readable names, `active_scenario`, `pending_scenarios`, and `trace`. Spoken turns also include `audio_url` and `audio_content_type`. Render `route_details`, `trace.reason`, and `trace.alternative_details` in the supervisor view; do not hide the model decision behind the conversational answer.

`trace` includes the final `transcript`, selected scenario IDs, alternatives, short reason, model name, `ambiguity_reviewed`, `is_continuation`, `router_ms`, `jev_ms`, `jev_probability`, `jev_skipped_luna`, `extractor_ms`, `response_ms`, `server_total_ms`, token counts, rejected slots, and action results. `stt_ms` and `tts_generation_ms` apply only to the separate completed-audio path. `tts_first_audio_ms` is currently null; do not label server time as browser first-audio latency. For compound requests, display every ID in `route` and the deferred IDs in `pending_scenarios`.

An irreversible action returns `trace.actions[].status = "awaiting_confirmation"` and asks the customer to approve or cancel. The next spoken reply is interpreted by the LLM in that pending-action context. Only an unambiguous approval allows execution. The same action parameters are not executed twice in one session. Some non-irreversible case actions create a local record, but no external SMS, payment, live operator call, or actual booking is claimed.

## Failure handling

HTTP 404 means the endpoint or session/audio ID is unknown. HTTP 422 means the body, content type, recording, or dialogue limit is invalid. HTTP 502 means the external AI request failed. HTTP 500 is an internal error. Keep the same session if a request failed before a turn was accepted; do not play a fabricated success response. UI should show the returned `error` text and allow a retry or a human handoff.

All sessions, generated MP3s, and local case action records exist only in the server process. Restarting the service invalidates their IDs. This local service has no public authentication or rate limit and must not be exposed directly to the internet.
