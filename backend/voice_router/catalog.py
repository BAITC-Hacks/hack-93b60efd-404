"""Load and validate the official Saqta Insurance scenario catalogue."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DATASET_DIR = Path(__file__).resolve().parents[2] / "data" / "voice_router_dataset"


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return value


@dataclass(frozen=True)
class Catalog:
    scenarios: tuple[dict[str, Any], ...]
    system_intents: tuple[dict[str, Any], ...]
    actions: dict[str, dict[str, Any]]
    handoff_queues: frozenset[str]
    slots: dict[str, dict[str, Any]]
    knowledge_base: dict[str, Any]
    mock_backend: dict[str, Any]

    @property
    def scenario_by_id(self) -> dict[str, dict[str, Any]]:
        return {item["scenario_id"]: item for item in self.scenarios}

    @property
    def valid_route_ids(self) -> set[str]:
        return set(self.scenario_by_id) | {item["id"] for item in self.system_intents}

    def require_route(self, scenario_id: str) -> dict[str, Any]:
        scenario = self.scenario_by_id.get(scenario_id)
        if scenario is not None:
            return scenario
        for system_intent in self.system_intents:
            if system_intent["id"] == scenario_id:
                return system_intent
        raise ValueError(f"Unknown route ID: {scenario_id}")

    def routing_context(self) -> list[dict[str, Any]]:
        """Keep the authoritative scenario boundaries visible to the LLM."""
        return [
            {
                "id": scenario["scenario_id"],
                "name": scenario["name"],
                "description": scenario["description"],
                "not_this_if": scenario["not_this_if"],
                "priority": scenario["priority"],
                "examples": scenario["examples"],
            }
            for scenario in self.scenarios
        ] + [
            {"id": intent["id"], "description": intent["description"]}
            for intent in self.system_intents
        ]


def load_catalog(dataset_dir: Path = DATASET_DIR) -> Catalog:
    scenario_doc = _read_json(dataset_dir / "scenarios.json")
    actions_doc = _read_json(dataset_dir / "actions.json")
    slots_doc = _read_json(dataset_dir / "slots.json")
    scenarios = tuple(scenario_doc["scenarios"])
    system_intents = tuple(scenario_doc["system_intents"])
    actions = {item["name"]: item for item in actions_doc["actions"]}
    slots = {item["name"]: item for item in slots_doc["slots"]}

    scenario_ids = [item["scenario_id"] for item in scenarios]
    if len(scenarios) != 40 or len(set(scenario_ids)) != 40:
        raise ValueError("The official catalogue must have 40 unique scenarios")
    all_ids = set(scenario_ids) | {item["id"] for item in system_intents}
    if len(all_ids) != 43:
        raise ValueError("Expected 40 scenarios and 3 distinct system intents")

    for scenario in scenarios:
        for action_name in scenario["actions"]:
            if action_name not in actions:
                raise ValueError(f"{scenario['scenario_id']} references unknown action {action_name}")
        for slot_name in scenario["slots"]["required"] + scenario["slots"]["optional"]:
            if slot_name not in slots:
                raise ValueError(f"{scenario['scenario_id']} references unknown slot {slot_name}")
        for boundary in scenario["not_this_if"]:
            if boundary["use_instead"] not in all_ids:
                raise ValueError(
                    f"{scenario['scenario_id']} references unknown boundary {boundary['use_instead']}"
                )

    return Catalog(
        scenarios=scenarios,
        system_intents=system_intents,
        actions=actions,
        handoff_queues=frozenset(actions_doc["queues"]),
        slots=slots,
        knowledge_base=_read_json(dataset_dir / "knowledge_base.json"),
        mock_backend=_read_json(dataset_dir / "mock_backend.json"),
    )
