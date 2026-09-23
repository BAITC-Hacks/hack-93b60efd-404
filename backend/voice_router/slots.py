"""Extract and validate only scenario-relevant values from actual customer speech."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, Field

from .catalog import Catalog


class SlotValue(BaseModel):
    name: str
    value: str = Field(description="Canonical scalar or comma-separated list")


class Extraction(BaseModel):
    slots: list[SlotValue]
    response_language: Literal["ru", "kk"]
    travel_zone: Literal["A", "B", "C", "D"] | None = None


@dataclass(frozen=True)
class ExtractionResult:
    values: dict[str, Any]
    response_language: str
    rejected: list[dict[str, str]]
    extractor_ms: float
    input_tokens: int
    output_tokens: int


def normalize_slot(definition: dict[str, Any], raw: str) -> Any:
    value = raw.strip()
    if not value:
        raise ValueError("empty value")
    kind = definition["type"]
    if kind == "enum":
        matches = [item for item in definition["values"] if str(item).casefold() == value.casefold()]
        if not matches:
            raise ValueError(f"value is not in {definition['values']}")
        return matches[0]
    if kind == "integer":
        number = int(value)
        if number < 0:
            raise ValueError("negative integer")
        return number
    if kind == "date":
        date.fromisoformat(value)
        return value
    if kind == "boolean":
        if value.casefold() not in {"true", "false"}:
            raise ValueError("expected true or false")
        return value.casefold() == "true"
    if kind == "list":
        items = [part.strip() for part in value.split(",") if part.strip()]
        if not items:
            raise ValueError("empty list")
        pattern = definition.get("pattern")
        if pattern and any(re.fullmatch(pattern, item) is None for item in items):
            raise ValueError("list item does not match the official pattern")
        return items
    pattern = definition.get("pattern")
    if pattern and re.fullmatch(pattern, value) is None:
        raise ValueError("value does not match the official pattern")
    return value


class OpenAISlotExtractor:
    def __init__(
        self, catalog: Catalog, *, model: str = "gpt-6-luna", client: OpenAI | None = None
    ) -> None:
        self.catalog = catalog
        self.model = model
        self.client = client or OpenAI()

    def extract(self, transcript: str, scenario_ids: list[str]) -> ExtractionResult:
        allowed: dict[str, dict[str, Any]] = {}
        for scenario_id in scenario_ids:
            scenario = self.catalog.require_route(scenario_id)
            for name in scenario["slots"]["required"] + scenario["slots"]["optional"]:
                allowed[name] = self.catalog.slots[name]
            if scenario.get("requires_identification"):
                allowed["phone"] = self.catalog.slots["phone"]
            if "get_policy" in scenario["actions"] or "resend_documents" in scenario["actions"]:
                allowed["policy_number"] = self.catalog.slots["policy_number"]
        descriptions = [
            {
                "name": name,
                "type": definition["type"],
                "description": definition["description"],
                "values": definition.get("values"),
                "pattern": definition.get("pattern"),
            }
            for name, definition in allowed.items()
        ]
        travel_zones = (
            self.catalog.knowledge_base["products"]["travel"]["zones"]
            if "SC06" in scenario_ids else None
        )
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {
                    "role": "system",
                    "content": (
                        "Extract only explicitly spoken values for the listed scenario slots. "
                        "Do not infer missing personal identifiers or make up a date. "
                        "Normalize spoken phone numbers, dates (dataset today is 2026-10-01), "
                        "enum values, and plate numbers to the listed canonical form. "
                        "For list slots, join values with commas. Return no slot if uncertain. "
                        "Choose ru or kk as the natural response language for this utterance. "
                        "If travel insurance is selected and a destination country is spoken, "
                        "choose its travel_zone from the supplied official zone descriptions; "
                        "leave null when you cannot establish the zone. "
                        "Travel zones: " + json.dumps(travel_zones, ensure_ascii=False) + ". "
                        "Allowed slots: " + json.dumps(descriptions, ensure_ascii=False)
                    ),
                },
                {"role": "user", "content": transcript},
            ],
            text_format=Extraction,
            max_output_tokens=400,
        )
        elapsed = (time.perf_counter() - started) * 1000
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI did not return parsed slot values")
        values: dict[str, Any] = {}
        rejected: list[dict[str, str]] = []
        for slot in parsed.slots:
            definition = allowed.get(slot.name)
            if definition is None:
                rejected.append({"name": slot.name, "reason": "not part of selected scenarios"})
                continue
            try:
                values[slot.name] = normalize_slot(definition, slot.value)
            except ValueError as exc:
                rejected.append({"name": slot.name, "reason": str(exc)})
        if parsed.travel_zone and "trip_country" in values and "SC06" in scenario_ids:
            values["trip_zone"] = parsed.travel_zone
        usage = response.usage
        return ExtractionResult(
            values=values,
            response_language=parsed.response_language,
            rejected=rejected,
            extractor_ms=elapsed,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
        )
