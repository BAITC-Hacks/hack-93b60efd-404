# Experiment: real Russian, Kazakh, and mixed voice turns

**Status:** completed for the current local backend. Browser microphone integration and human acceptance of playback are not yet complete.

**Date:** 2026-09-23

**Question:** can the actual audio path transcribe two human speakers, preserve the expected route, and produce spoken answers on the official synthetic-insurance case?

## Inputs and method

Nikita and Altinay recorded 12 Telegram voice messages in their own voices in the private `altysha` chat, after the team's script message 870682. Only the 12 voice messages after that boundary were downloaded. The original `audio/ogg` files were transcoded losslessly for the API path to 16 kHz mono WAV; both originals and WAV files remain under ignored local `artifacts/voice-inputs/`, not in Git. Each utterance was sent to the running local HTTP service, which called OpenAI `gpt-transcribe`, `gpt-6-luna` for routing, the scenario-specific slot extractor and data actions where applicable, and `gpt-4o-mini-tts` for speech. Generated MP3s also remain local and ignored. The experiment driver is `python -m voice_router.evaluate_voice`; the private local manifest associates the Telegram message IDs with expected routes. No real customer call or personal identifier was used.

Messages 870690, 870691, and 870692 were replayed as **one session** in their actual spoken order to test topic switching and return; the other recordings each received a fresh session. Message 870692 was excluded from the route score before the run because its recording ends after “вернёмся к…” rather than speaking the intended final object.

## Results

The backend selected the expected ordered routes on **11/11 scorable voice files**. The truncated twelfth recording also returned to SC03 using session context, but is not counted as an independent route success. The covered cases include simple Russian and Kazakh pricing, a Russian disagreement with a claim decision, two-intent renewal/driver change, a Kazakh urgent accident, mixed Kazakh/Russian claim plus inspection, an unclear request, an out-of-scope loan request, an explicit request to answer in Russian, and topic switching away from and back to CASCO.

Across all 12 real files, median/p95 (nearest-rank) stage times were: STT **893 / 2,462 ms**; router **1,976 / 2,779 ms**; slot extraction (10 business turns only) **1,429 / 2,473 ms**; TTS generation **1,629 / 3,566 ms**; full server request **6,678 / 9,339 ms**. These are real wall-clock measurements on this Mac and network. Browser playback start was **not measured**, so these figures must not be presented as end-of-speech-to-first-audio latency. The 1.5-second speed bonus is not achieved by this sequential path.

The audio service generated 12 valid MP3 files; a sampled mixed-language response was verified as an MP3 of about eight seconds. The current implementation returns an audio URL and a trace for each turn. This validates the HTTP backend and provider path, **not** the teammate's eventual browser microphone UI.

## Failure reading and next decision

Routing survived notable STT distortions. In the Kazakh price request, `көлікті` was rendered approximately as `көрікті`; the urgent accident phrase and mixed-language insurance phrases also had misspelled words. The explicit Russian-language request was still understood and answered in Russian. These are recognizer errors, not route errors on this set, but harder hidden speech could fail. A later bounded comparison of transcription models or language hints is justified; do not claim Kazakh transcription is solved.

The first topic-switch run preserved the paused CASCO task but incorrectly kept a completed office lookup on the pending-task stack. We fixed the state transition so completed tasks are not requeued, then replayed those three **real audio files**: SC03 → SC33 → SC03, with a single office lookup and no spurious pending office task. The unfinished CASCO request still asks for the missing vehicle value. No hard-coded transcript phrase was added.

Next: confirm the Kazakh synthesized voice with a human listener, test a real browser microphone session, and improve first-audio latency without sacrificing route quality. Do not commit the original recordings or generated audio to the repository.
