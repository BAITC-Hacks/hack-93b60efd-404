"""Context-aware LLM routing over the organizer's complete scenario catalogue."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, Field

from .catalog import Catalog


class RouteDecision(BaseModel):
    scenario_ids: list[str] = Field(description="One or more ordered, valid scenario IDs")
    alternatives: list[str] = Field(description="Other plausible scenario IDs, if any")
    language: Literal["ru", "kk", "mixed"]
    is_continuation: bool
    reason: str = Field(description="Brief rationale grounded in the utterance and catalogue boundaries")


class ConfirmationDecision(BaseModel):
    decision: Literal["approve", "reject", "change_request", "unclear"]
    reason: str = Field(description="Short explanation grounded in the customer's actual reply")


@dataclass(frozen=True)
class RouteResult:
    decision: RouteDecision
    model: str
    router_ms: float
    input_tokens: int
    output_tokens: int


class OpenAIRouter:
    def __init__(
        self,
        catalog: Catalog,
        *,
        model: str = "gpt-6-luna",
        client: OpenAI | None = None,
    ) -> None:
        if model not in {"gpt-6-luna", "gpt-6-sol"}:
            raise ValueError(f"Unsupported experiment model: {model}")
        self.catalog = catalog
        self.model = model
        self.client = client or OpenAI()
        self.catalogue_prompt = json.dumps(
            [
                {
                    **{key: entry[key] for key in ("id", "name", "description", "not_this_if", "priority")},
                    "examples": {
                        lang: utterances[:2]
                        for lang, utterances in entry["examples"].items()
                    },
                }
                if "name" in entry else entry
                for entry in catalog.routing_context()
            ],
            ensure_ascii=False,
            separators=(",", ":"),
        )

    def route(
        self,
        transcript: str,
        *,
        history: list[dict[str, str]] | None = None,
        active_scenario: str | None = None,
    ) -> RouteResult:
        if not transcript.strip():
            raise ValueError("A real, non-empty transcript is required")
        if active_scenario is not None:
            self.catalog.require_route(active_scenario)

        system = (
            "You are the substantive scenario-selection layer for Saqta Insurance, "
            "a fictional insurer. Choose only IDs from the supplied catalogue. "
            "Use descriptions and not_this_if boundaries, not surface keyword matching. "
            "Handle natural Russian, Kazakh, and mixed-language speech. Preserve all "
            "independent intents in a compound request. Put urgent scenarios first; "
            "otherwise preserve mention order. Use SYS_UNCLEAR when the request is "
            "genuinely ambiguous, SYS_OUT_OF_SCOPE for unsupported services, and "
            "SYS_GOODBYE only when ending the conversation. For a follow-up, use "
            "history and active_scenario without dropping a new topic. "
            "Missing identifiers or slots do not make a clear intent ambiguous: "
            "choose the scenario, then collect its required data downstream. "
            "Do not create a second intent when a product feature, price factor, "
            "or contract term is merely part of the first request; add another "
            "scenario only for a genuinely independent customer task. "
            "Do not invent IDs or imply an action was performed. Keep the reason short and cite "
            "specific words/meaning and a relevant boundary. Never invent numeric confidence."
            "\nCatalogue: " + self.catalogue_prompt
        )
        state = {
            "transcript": transcript,
            "history": (history or [])[-10:],
            "active_scenario": active_scenario,
        }
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(state, ensure_ascii=False)},
            ],
            text_format=RouteDecision,
            max_output_tokens=500,
        )
        router_ms = (time.perf_counter() - started) * 1000
        decision = response.output_parsed
        if decision is None:
            raise RuntimeError("OpenAI did not return a parsed route decision")
        if not 1 <= len(decision.scenario_ids) <= 3:
            raise ValueError(f"Expected 1-3 routes, got {decision.scenario_ids}")
        if len(set(decision.scenario_ids)) != len(decision.scenario_ids):
            raise ValueError("The model repeated a scenario ID")
        for scenario_id in decision.scenario_ids + decision.alternatives:
            self.catalog.require_route(scenario_id)
        if decision.scenario_ids[0].startswith("SYS_") and len(decision.scenario_ids) != 1:
            raise ValueError("A system intent cannot be combined with business scenarios")
        if set(decision.scenario_ids) & set(decision.alternatives):
            raise ValueError("Alternatives must differ from selected routes")

        usage = response.usage
        return RouteResult(
            decision=decision,
            model=self.model,
            router_ms=router_ms,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
        )

    def interpret_confirmation(
        self, transcript: str, *, pending_action: dict, history: list[dict[str, str]]
    ) -> tuple[ConfirmationDecision, float, int, int]:
        """Understand natural RU/KK approval without a keyword-triggered write."""
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "You are interpreting a customer's answer to one pending insurance action. "
                    "Approve only if the customer explicitly and unambiguously authorizes "
                    "that exact action in this turn. Reject if they refuse or cancel it. "
                    "If they change any parameter or switch topics, return change_request; "
                    "if uncertain, return unclear. Understand natural Russian, Kazakh, and "
                    "mixed language. Never treat mere acknowledgement as approval."
                )},
                {"role": "user", "content": json.dumps({
                    "pending_action": pending_action,
                    "recent_history": history[-4:],
                    "customer_reply": transcript,
                }, ensure_ascii=False)},
            ],
            text_format=ConfirmationDecision,
            max_output_tokens=100,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI did not return a parsed confirmation decision")
        usage = response.usage
        return parsed, (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)
