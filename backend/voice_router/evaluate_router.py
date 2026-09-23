"""Run a real OpenAI router against the official development utterances."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .catalog import DATASET_DIR, load_catalog
from .router import OpenAIRouter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=("gpt-6-luna", "gpt-6-sol"), default="gpt-6-luna")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--ids", help="Comma-separated official utterance IDs for a matched comparison")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    utterances = json.loads((DATASET_DIR / "dev_utterances.json").read_text(encoding="utf-8"))[
        "utterances"
    ]
    if args.ids:
        requested = args.ids.split(",")
        known = {item["id"] for item in utterances}
        unknown = set(requested) - known
        if unknown:
            parser.error(f"Unknown utterance IDs: {sorted(unknown)}")
        utterances = [item for item in utterances if item["id"] in requested]
    if args.limit is not None:
        if args.limit < 1:
            parser.error("--limit must be positive")
        utterances = utterances[: args.limit]
    router = OpenAIRouter(load_catalog(), model=args.model)
    predictions: dict[str, list[str]] = {}
    records: list[dict[str, object]] = []
    args.output.parent.mkdir(parents=True, exist_ok=True)

    for utterance in utterances:
        result = router.route(utterance["text"])
        predictions[utterance["id"]] = result.decision.scenario_ids
        record = {
            "id": utterance["id"],
            "lang": utterance["lang"],
            "type": utterance["type"],
            "expected": utterance["expected"],
            "predicted": result.decision.scenario_ids,
            "alternatives": result.decision.alternatives,
            "language": result.decision.language,
            "is_continuation": result.decision.is_continuation,
            "reason": result.decision.reason,
            "router_ms": round(result.router_ms, 1),
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "model": result.model,
            "ambiguity_reviewed": result.ambiguity_reviewed,
        }
        records.append(record)
        args.output.write_text(
            json.dumps({"predictions": predictions, "records": records}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(
            f"{utterance['id']} expected={utterance['expected']} "
            f"predicted={result.decision.scenario_ids} "
            f"router_ms={result.router_ms:.0f}",
            flush=True,
        )

    exact = sum(record["predicted"] == record["expected"] for record in records)
    print(f"exact_order_match={exact}/{len(records)} output={args.output}")


if __name__ == "__main__":
    main()
