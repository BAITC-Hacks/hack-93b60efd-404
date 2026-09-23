# Voice Router — team 404

HackAlem AI, Halyk Bank track, case 2. A contact-centre voice robot whose conversation scenario is chosen by an LLM that takes the dialogue context into account, not by an intent classifier. After every turn a supervisor sees the chosen scenario, the reasoning behind it, the alternatives and the latency of each stage.

## What's built

A web interface in [`frontend/`](frontend/), modelled on ChatGPT's voice mode and styled for Halyk Bank: the Halyk logo, their green palette and the Manrope typeface. On a desktop the app is shown inside a phone mockup over a live cloud sky; the trace and supervisor panels open as glass cards next to the phone. On a real phone the app is full screen. The clouds in the sky and inside the orb are drawn by our own WebGL shader (`frontend/src/components/CloudCanvas.tsx`), with no images or video.

- **Main screen: an orb in the centre.** Tap it and the robot listens. The orb reacts to the loudness of your voice, speeds up while the robot picks a scenario and pulses while it answers. After each answer the robot listens again, so the conversation needs no buttons. The mic button at the bottom mutes, and the X ends voice mode and shows the transcript.
- **"Спросите робота" field at the bottom.** Text is the backup channel. The "+" button opens sample phrases in Russian, Kazakh and mixed Russian–Kazakh speech.
- **Menu (top left).** Opens conversation history, the supervisor panel and settings: speech language, reading replies aloud in chat, and where speech is recognised.
- **Chat mode.** Shows the conversation: the client speaks or types, and the robot answers by voice and text.
- **Trace panel.** A feed of the whole conversation: each client phrase, the robot's reply and its routing chip. Clicking a chip expands that turn to show:
  - detected language and client tone;
  - scenario with confidence, reasoning and alternatives;
  - extracted parameters and postponed topics;
  - per-stage latency against the 500 ms and 1.5 s targets;
  - the supervisor's "correct / wrong" verdict.
- **Supervisor panel.** Shows:
  - accuracy based on reviews;
  - median and p95 scenario-selection time;
  - fast-path share, clarifications and operator handoffs;
  - a list of turns where the robot was unsure or wrong.

Every robot reply carries a chip with the path (fast or LLM), scenario, confidence, language and a latency bar. Clicking the chip opens the trace for that turn.

For irreversible actions (`action: "confirm"`) the robot shows "Confirm / Cancel" buttons and does nothing until the client answers. For `action: "handoff"` it shows an operator handoff card with a short summary of the context.

## Running the frontend

Requires Node.js 20+.

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The microphone works in Chrome and Edge. For Safari and Firefox, enable server-side recognition (see `stt` in `/api/health`).

The dev server proxies `/api` to `http://localhost:8000`. To use another address, set `API_PROXY_TARGET` in `frontend/.env` (see `frontend/.env.example`).

If the backend is unreachable, the interface switches to demo mode:
- a yellow "Демо" badge appears at the top;
- replies are prefixed with `[демо]`.

Demo replies come from a keyword stub (`frontend/src/api/mock.ts`) that exists only to exercise the UI. Don't judge routing quality by it.

## API the frontend expects

### `GET /api/health`

```json
{ "ok": true, "model": "gpt-4.1-mini", "stt": true, "tts": true, "scenarios": 40 }
```

`stt: true` turns on server-side recognition. The frontend records the utterance, detects the end of speech by silence and sends the audio to `/api/stt`.

### `POST /api/turn`

Request:

```json
{
  "session_id": "conversation uuid",
  "text": "я вчера оплатил, деньги списались, а заказ не подтвердился… и адрес поменять надо",
  "input": "voice",
  "lang_hint": "auto",
  "history": [{ "role": "user", "text": "...", "scenario_id": null }, { "role": "assistant", "text": "...", "scenario_id": "payment_not_confirmed" }],
  "stt_ms": 180,
  "want_audio": true
}
```

Response:

```json
{
  "reply_text": "Вижу платёж, он в обработке… Потом займёмся адресом.",
  "lang": "ru",
  "scenario": { "id": "payment_not_confirmed", "name": "Оплата прошла, полис не активирован", "confidence": 0.91 },
  "reasoning": "Клиент говорит о списании без подтверждения; вторая тема — адрес доставки, отложена.",
  "alternatives": [{ "id": "change_delivery_address", "name": "Изменение адреса доставки", "confidence": 0.35, "why_not": "Упомянуто вторым" }],
  "route_path": "llm",
  "action": "answer",
  "params": { "date": "вчера" },
  "topic_stack": ["change_delivery_address"],
  "resumed_from": null,
  "emotion": "нейтрально",
  "handoff_summary": null,
  "timings": { "route_ms": 320, "llm_ms": 410, "tts_ms": 150, "total_ms": 900 },
  "audio_b64": null,
  "audio_mime": "audio/mpeg"
}
```

User-facing strings (`reply_text`, scenario `name`, `reasoning`, `why_not`) are in the client's language, so the examples are in Russian.

- `lang`: `ru`, `kk` or `mixed`.
- `route_path`: `fast` (a shortcut for obvious phrases) or `llm`.
- `action`:
  - `answer`;
  - `clarify` — ask again instead of guessing;
  - `confirm` — irreversible action, wait for the client's confirmation;
  - `handoff` — transfer to an operator.
- If `audio_b64` is empty, the frontend speaks `reply_text` with browser speech synthesis.

### `POST /api/stt` (optional)

`multipart/form-data` with the fields `audio` (webm/opus) and `lang_hint` (`ru` or `kk`). Response: `{ "text": "...", "lang": "mixed", "stt_ms": 240 }`.

## How latency is measured

- **Scenario selection** is `timings.route_ms` from the server. Target: 500 ms.
- **End of utterance to voice** runs from the moment the client stops speaking (or presses Send) to the first sound of the reply. It is measured in the browser. Target: 1.5 s.
- **The bar under each reply** splits the time into recognition, scenario selection, reply generation, network and synthesis. The black tick on the bar marks 1.5 s.

## `frontend/` layout

```
src/
  api/          contract (types.ts), client, demo stub
  voice/        speech recognition (browser or server, silence detector), synthesis
  state/        conversations in localStorage
  components/   sidebar, chat, composer, trace, supervisor panel, phone frame, cloud shader, icons
```

## Limitations

- Conversation history and supervisor reviews live in the browser's localStorage; there is no shared database yet.
- Browser speech recognition accepts one language at a time (RU or KZ). Mixed speech needs server-side recognition.
- All data is synthetic; no real call recordings are used.
- The Halyk Bank logo and colours are used for the hackathon demo only.
