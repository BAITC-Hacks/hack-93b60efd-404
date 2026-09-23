"""Evaluate real recorded utterances through the running HTTP voice backend."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def _post(url: str, body: bytes, content_type: str) -> dict:
    request = Request(url, data=body, headers={"Content-Type": content_type}, method="POST")
    with urlopen(request, timeout=120) as response:
        return json.load(response)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--ids", help="Comma-separated message IDs to replay in manifest order")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    samples = json.loads(args.manifest.read_text(encoding="utf-8"))
    if args.ids:
        selected = {int(part) for part in args.ids.split(",")}
        samples = [sample for sample in samples if sample["message_id"] in selected]
        if len(samples) != len(selected):
            parser.error("Some --ids are not present in the manifest")
    sessions: dict[str, str] = {}
    results: list[dict] = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    audio_output_dir = args.output.parent / "voice-outputs"
    audio_output_dir.mkdir(exist_ok=True)

    for sample in samples:
        group = sample.get("group") or str(sample["message_id"])
        if group not in sessions:
            sessions[group] = _post(f"{args.base_url}/sessions", b"", "application/json")[
                "session_id"
            ]
        audio_path = Path(sample["file"])
        item = {
            "message_id": sample["message_id"],
            "speaker": sample["speaker"],
            "expected": sample["expected"],
            "score_route": sample.get("score_route", True),
            "group": group,
        }
        try:
            response = _post(
                f"{args.base_url}/sessions/{sessions[group]}/turns/audio",
                audio_path.read_bytes(),
                "audio/wav",
            )
            audio_url = response["audio_url"]
            with urlopen(f"{args.base_url}{audio_url}", timeout=30) as audio_response:
                generated_audio = audio_response.read()
            output_audio = audio_output_dir / f"{sample['message_id']}.mp3"
            output_audio.write_bytes(generated_audio)
            item.update(
                {
                    "transcript": response["trace"]["transcript"],
                    "predicted": response["route"],
                    "language": response["language"],
                    "answer_text": response["answer_text"],
                    "match": response["route"] == sample["expected"],
                    "trace": response["trace"],
                    "audio_file": str(output_audio),
                }
            )
            print(
                f"{sample['message_id']} expected={sample['expected']} "
                f"got={response['route']} "
                f"stt_ms={response['trace']['stt_ms']:.0f} "
                f"total_ms={response['trace']['server_total_ms']:.0f}",
                flush=True,
            )
        except HTTPError as exc:
            item["error"] = {"status": exc.code, "body": exc.read().decode("utf-8", "replace")}
            print(f"{sample['message_id']} HTTP {exc.code}: {item['error']['body']}", flush=True)
        results.append(item)
        args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    scored = [item for item in results if item["score_route"]]
    matched = sum(item.get("match", False) for item in scored)
    print(f"matched={matched}/{len(scored)} results={args.output}")


if __name__ == "__main__":
    main()
