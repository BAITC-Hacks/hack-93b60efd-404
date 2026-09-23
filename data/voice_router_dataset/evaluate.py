"""Reference router evaluator for Voice Router.

Usage:
    python evaluate.py predictions.json [dev_utterances.json]

predictions.json:
    {"U001": ["SC01"], "U097": ["SC27", "SC04"], ...}
    Scenario IDs in the order your router returns them. Missing IDs count as errors.

Metrics:
    primary_accuracy  first predicted scenario == first expected scenario
    full_match        set of predicted scenarios == set of expected scenarios
    intent_recall     share of expected scenarios found (multi-intent only)
"""
import json
import sys
from collections import defaultdict


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    preds = json.load(open(sys.argv[1], encoding="utf-8"))
    dev_path = sys.argv[2] if len(sys.argv) > 2 else "dev_utterances.json"
    utts = json.load(open(dev_path, encoding="utf-8"))["utterances"]
    known = {u["id"] for u in utts}

    extra = sorted(set(preds) - known)
    if extra:
        print(f"Warning: {len(extra)} prediction IDs not in the dev set: {extra[:5]}")

    groups = defaultdict(lambda: {"n": 0, "primary": 0, "full": 0})
    recall_hit = recall_total = 0
    errors = []
    for u in utts:
        exp = u["expected"]
        got = preds.get(u["id"], [])
        if isinstance(got, str):
            got = [got]
        primary = bool(got) and got[0] == exp[0]
        full = set(got) == set(exp)
        if u["type"] == "multi_intent":
            recall_hit += len(set(exp) & set(got))
            recall_total += len(exp)
        for key in ("all", f"lang={u['lang']}", f"type={u['type']}"):
            g = groups[key]
            g["n"] += 1
            g["primary"] += primary
            g["full"] += full
        if not full:
            errors.append((u["id"], u["text"], exp, got))

    print(f"{'group':<22}{'n':>5}{'primary_acc':>14}{'full_match':>12}")
    order = ["all"] + sorted(k for k in groups if k.startswith("lang=")) + sorted(k for k in groups if k.startswith("type="))
    for k in order:
        g = groups[k]
        print(f"{k:<22}{g['n']:>5}{g['primary'] / g['n']:>14.3f}{g['full'] / g['n']:>12.3f}")
    if recall_total:
        print(f"\nintent_recall (multi-intent): {recall_hit / recall_total:.3f}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for i, t, e, g in errors:
            print(f"  {i}  expected={e}  got={g}  | {t}")


if __name__ == "__main__":
    main()
