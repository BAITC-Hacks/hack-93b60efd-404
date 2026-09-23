"""Local HTTP backend for real text and microphone-audio Voice Router turns."""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from openai import OpenAI, OpenAIError

from .actions import ActionExecutor
from .catalog import load_catalog
from .dialogue import DialogueService
from .router import OpenAIRouter
from .slots import OpenAISlotExtractor


AUDIO_TYPES = {
    "audio/webm": "webm",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/m4a": "m4a",
}
MAX_BODY_BYTES = 10 * 1024 * 1024

class Application:
    def __init__(self) -> None:
        self.catalog = load_catalog()
        self.openai = OpenAI()
        self.dialogue = DialogueService(
            self.catalog,
            OpenAIRouter(self.catalog, client=self.openai),
            OpenAISlotExtractor(self.catalog, client=self.openai),
            ActionExecutor(self.catalog),
        )
        self.audio: dict[str, bytes] = {}
        self.audio_lock = Lock()

    def create_gemini_token(self) -> dict[str, Any]:
        # One use, one minute to connect, thirty minutes of session lifetime.
        body = b'{"uses":1}'
        request = Request(
            "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
            data=body,
            headers={
                "x-goog-api-key": os.environ["GEMINI_API_KEY"],
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def process_audio(self, session_id: str, audio: bytes, content_type: str) -> dict[str, Any]:
        extension = AUDIO_TYPES.get(content_type)
        if extension is None:
            raise ValueError(f"Unsupported audio type: {content_type}")
        started = time.perf_counter()
        stt_started = time.perf_counter()
        transcript = self.openai.audio.transcriptions.create(
            model="gpt-transcribe",
            file=(f"customer-turn.{extension}", audio, content_type),
        ).text
        stt_ms = (time.perf_counter() - stt_started) * 1000
        if not transcript.strip():
            raise ValueError("Speech recognition returned an empty transcript")
        response = self.dialogue.process_text(session_id, transcript)
        response["trace"]["stt_ms"] = round(stt_ms, 1)
        self._attach_speech(response)
        response["trace"]["server_total_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return response

    def process_text(self, session_id: str, text: str, *, speak: bool) -> dict[str, Any]:
        started = time.perf_counter()
        response = self.dialogue.process_text(session_id, text)
        if speak:
            self._attach_speech(response)
        response["trace"]["server_total_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return response

    def _attach_speech(self, response: dict[str, Any]) -> None:
        started = time.perf_counter()
        with self.openai.audio.speech.with_streaming_response.create(
            model="gpt-4o-mini-tts",
            voice="coral",
            input=response["answer_text"],
            instructions="Speak clearly and naturally in the language of the input text.",
        ) as generated:
            audio = generated.read()
        if not audio:
            raise RuntimeError("OpenAI TTS returned no audio")
        audio_id = uuid.uuid4().hex
        with self.audio_lock:
            if len(self.audio) >= 100:
                self.audio.pop(next(iter(self.audio)))
            self.audio[audio_id] = audio
        response["audio_url"] = f"/audio/{audio_id}"
        response["audio_content_type"] = "audio/mpeg"
        response["trace"]["tts_generation_ms"] = round((time.perf_counter() - started) * 1000, 1)
        # Browser playback is not instrumented yet; do not claim first-audio latency.
        response["trace"]["tts_first_audio_ms"] = None


def create_handler(app: Application) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def _cors(self) -> None:
            origin = self.headers.get("Origin")
            allowed = os.environ.get("VOICE_ROUTER_CORS_ORIGIN", "*")
            if origin and (allowed == "*" or origin == allowed):
                self.send_header("Access-Control-Allow-Origin", allowed if allowed != "*" else "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _send_json(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self._cors()
            self.end_headers()
            self.wfile.write(payload)

        def _read_body(self) -> bytes:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as exc:
                raise ValueError("Invalid Content-Length") from exc
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("Request body must be between 1 byte and 10 MB")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete request body")
            return body

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send_json(200, {"status": "process_running"})
                return
            if self.path == "/catalog":
                self._send_json(200, {
                    "scenarios": [app.catalog.route_summary(item["scenario_id"])
                                  for item in app.catalog.scenarios],
                    "system_intents": [app.catalog.route_summary(item["id"])
                                       for item in app.catalog.system_intents],
                })
                return
            match = re.fullmatch(r"/audio/([a-f0-9]{32})", self.path)
            if match:
                with app.audio_lock:
                    audio = app.audio.get(match.group(1))
                if audio is None:
                    self._send_json(404, {"error": "Unknown audio ID"})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(audio)))
                self._cors()
                self.end_headers()
                self.wfile.write(audio)
                return
            self._send_json(404, {"error": "Unknown endpoint"})

        def do_POST(self) -> None:
            try:
                if self.path == "/gemini/token":
                    origin = self.headers.get("Origin")
                    allowed = os.environ.get("VOICE_ROUTER_CORS_ORIGIN")
                    local_origins = {"http://localhost:5173", "http://127.0.0.1:5173"}
                    if origin not in ({allowed} if allowed else local_origins):
                        self._send_json(403, {"error": "Unexpected browser origin"})
                        return
                    if self.headers.get("Content-Length", "0") not in {"0", ""}:
                        raise ValueError("Token request must have no body")
                    self._send_json(201, app.create_gemini_token())
                    return
                if self.path == "/sessions":
                    session = app.dialogue.create_session()
                    self._send_json(201, {"session_id": session.session_id})
                    return
                match = re.fullmatch(
                    r"/sessions/([a-f0-9]{32})/turns/(text|audio)", self.path
                )
                if not match:
                    self._send_json(404, {"error": "Unknown endpoint"})
                    return
                session_id, mode = match.groups()
                body = self._read_body()
                if mode == "text":
                    if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                        raise ValueError("Text turns require application/json")
                    request = json.loads(body)
                    if not isinstance(request, dict) or not isinstance(request.get("text"), str):
                        raise ValueError("Text turn must contain a text string")
                    response = app.process_text(
                        session_id, request["text"], speak=request.get("speak", False) is True
                    )
                else:
                    content_type = self.headers.get("Content-Type", "").split(";")[0]
                    response = app.process_audio(session_id, body, content_type)
                self._send_json(200, response)
            except KeyError as exc:
                self._send_json(404, {"error": str(exc)})
            except (ValueError, json.JSONDecodeError) as exc:
                self._send_json(422, {"error": str(exc)})
            except OpenAIError as exc:
                logging.exception("OpenAI request failed")
                self._send_json(502, {"error": type(exc).__name__, "message": "External AI request failed"})
            except (HTTPError, URLError) as exc:
                logging.exception("Gemini token creation failed")
                self._send_json(502, {"error": type(exc).__name__, "message": "Gemini voice connection failed"})
            except Exception as exc:
                logging.exception("Voice Router request failed")
                self._send_json(500, {"error": type(exc).__name__, "message": "Internal request failed"})

    return Handler


def main() -> None:
    host = os.environ.get("VOICE_ROUTER_HOST", "127.0.0.1")
    port = int(os.environ.get("VOICE_ROUTER_PORT", "8000"))
    app = Application()
    server = ThreadingHTTPServer((host, port), create_handler(app))
    print(f"Voice Router backend listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
