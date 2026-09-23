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
    has_new_request: bool = Field(description="Whether this reply also asks a separate customer question")
    reason: str = Field(description="Short explanation grounded in the customer's actual reply")


class SpokenAnswer(BaseModel):
    answer_text: str = Field(description="One or two short, voice-friendly sentences in the requested language")


class CoverageMatch(BaseModel):
    covered: bool | None
    evidence: str | None = Field(description="Exact matching entry from the supplied package lists")
    reason: str


class HandoffDecision(BaseModel):
    handoff: bool
    reason: str


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
        pending_scenarios: list[str] | None = None,
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
            "independent intents in a compound request. Put urgent scenarios "
            "and explicit requests for a human operator first; otherwise preserve "
            "mention order. Use SYS_UNCLEAR when the request is "
            "genuinely ambiguous, SYS_OUT_OF_SCOPE for unsupported services, and "
            "SYS_GOODBYE only when ending the conversation. For a follow-up, use "
            "history, active_scenario, and pending_scenarios without dropping a new topic. "
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
            "pending_scenarios": pending_scenarios or [],
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
                    "If they change a parameter, return change_request. A refusal can "
                    "coexist with a separate new question: return reject and set "
                    "has_new_request true. A topic switch without a clear refusal is "
                    "change_request with has_new_request true. "
                    "if uncertain, return unclear. Understand natural Russian, Kazakh, and "
                    "mixed language. A direct, unambiguous affirmation of the read-back "
                    "details in response to the explicit approval question authorizes "
                    "the pending action, even when brief. Merely acknowledging that "
                    "information was heard does not."
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

    def compose_answer(
        self, *, transcript: str, scenario: dict, language: str,
        facts: dict, history: list[dict[str, str]],
    ) -> tuple[str, float, int, int]:
        """Speak naturally from verified case facts, never from model memory."""
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "You are Saqta Insurance's AI voice assistant for a fictional case. "
                    "Use only the supplied verified facts and scenario; do not invent prices, "
                    "coverage, legal rules, bookings, sent messages, or operator connections. "
                    "Answer the customer's actual question in one or two short spoken sentences. "
                    "Use the requested language (ru or kk), translate factual English labels "
                    "naturally, and ask one precise follow-up only if the facts truly do not "
                    "answer the question. Never request a value already supplied in "
                    "verified_facts. Follow a verified next_step explicitly when provided. "
                    "Do not say an action was performed unless its "
                    "verified result says so. Do not expose internal scenario IDs. "
                    "SMS delivery, payment, booking and live operator connections are "
                    "NOT available in this local backend. Never claim they were done, "
                    "even if a style reference or product description mentions them. "
                    "The voice is AI-generated, not a human operator."
                )},
                {"role": "user", "content": json.dumps({
                    "customer_utterance": transcript,
                    "recent_history": history[-4:],
                    "language": language,
                    "scenario_name": scenario["name"],
                    "scenario_description": scenario["description"],
                    "verified_facts": facts,
                    "live_integrations": {"sms": False, "payments": False,
                                          "bookings": False, "operator_connection": False},
                    "style_reference": scenario["responses"][language],
                }, ensure_ascii=False)},
            ],
            text_format=SpokenAnswer,
            max_output_tokens=220,
        )
        parsed = response.output_parsed
        if parsed is None or not parsed.answer_text.strip():
            raise RuntimeError("OpenAI did not return a grounded spoken answer")
        usage = response.usage
        return parsed.answer_text.strip(), (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)

    def compose_approval_prompt(
        self, *, scenario: dict, language: str, action_name: str,
        params: dict, preview: dict,
    ) -> tuple[str, float, int, int]:
        """Read back the concrete action before a separate approval turn."""
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "Prepare a concise spoken approval request for a fictional insurance case. "
                    "Speak in the requested language. State the exact operation and its "
                    "important supplied parameters or verified preview amount; mask most "
                    "digits of phone numbers and personal IDs. Ask for a separate explicit "
                    "yes or no. Do not state that the operation, SMS, booking, transfer, "
                    "refund, or payment has already happened. The backend only records "
                    "actions in the local synthetic case system. Do not invent facts."
                )},
                {"role": "user", "content": json.dumps({
                    "scenario": scenario["name"], "language": language,
                    "action": action_name, "parameters": params,
                    "verified_preview": preview,
                }, ensure_ascii=False)},
            ],
            text_format=SpokenAnswer,
            max_output_tokens=180,
        )
        parsed = response.output_parsed
        if parsed is None or not parsed.answer_text.strip():
            raise RuntimeError("OpenAI did not return an approval prompt")
        usage = response.usage
        return parsed.answer_text.strip(), (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)

    def match_coverage(
        self, *, service_name: str, package_name: str, package: dict
    ) -> tuple[CoverageMatch, float, int, int]:
        """Match multilingual spoken services to exact official DMS entries."""
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "Determine whether the requested service is explicitly covered by "
                    "this fictional DMS package. Understand Russian, Kazakh, and English "
                    "synonyms, but do not infer coverage from broad similarity. Return "
                    "covered true with an EXACT entry from the covered list, false with an "
                    "EXACT entry from the not_covered list, or null and null if uncertain. "
                    "A backend validator will reject any fabricated evidence entry."
                )},
                {"role": "user", "content": json.dumps({
                    "service": service_name, "package": package_name,
                    "covered": package["covered"],
                    "not_covered": package["not_covered"],
                }, ensure_ascii=False)},
            ],
            text_format=CoverageMatch,
            max_output_tokens=130,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI did not return a DMS coverage match")
        usage = response.usage
        return parsed, (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)

    def interpret_purchase_offer(
        self, *, transcript: str, history: list[dict[str, str]],
        quote: dict,
    ) -> tuple[ConfirmationDecision, float, int, int]:
        """Distinguish accepting a quote from merely updating travel details."""
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "The fictional insurer has quoted travel insurance and offered to "
                    "start a purchase. Decide whether the current customer utterance "
                    "explicitly ACCEPTS starting that purchase (approve), DECLINES it "
                    "(reject), CHANGES quote details or switches topic (change_request), "
                    "or is unclear. Providing a phone number together with acceptance "
                    "is still approval. Set has_new_request true only for a separate "
                    "additional question. This is only permission to collect details and "
                    "show a later irreversible-action preview, NOT permission to issue "
                    "a policy. Understand Russian, Kazakh, and mixed speech."
                )},
                {"role": "user", "content": json.dumps({
                    "quote": quote, "recent_history": history[-4:],
                    "customer_reply": transcript,
                }, ensure_ascii=False)},
            ],
            text_format=ConfirmationDecision,
            max_output_tokens=100,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI did not return a purchase-offer decision")
        usage = response.usage
        return parsed, (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)

    def decide_conditional_handoff(
        self, *, scenario: dict, transcript: str,
        history: list[dict[str, str]], action_result: dict,
    ) -> tuple[HandoffDecision, float, int, int]:
        """Apply the official scenario's handoff condition semantically."""
        handoff = scenario.get("handoff")
        if handoff is None:
            raise ValueError("Scenario has no handoff condition")
        started = time.perf_counter()
        response = self.client.responses.parse(
            model=self.model,
            reasoning={"effort": "none"},
            input=[
                {"role": "system", "content": (
                    "Apply ONLY the supplied official handoff condition to the "
                    "customer's actual conversation and verified action result. "
                    "Understand Russian, Kazakh, and mixed speech. Choose true when "
                    "the condition is clearly met; otherwise false. Do not infer an "
                    "injury, theft, payment failure, or code disclosure that was not said "
                    "or verified. This queues context locally; it does not connect a live operator."
                )},
                {"role": "user", "content": json.dumps({
                    "scenario": scenario["name"],
                    "handoff_condition": handoff["when"],
                    "customer_utterance": transcript,
                    "recent_history": history[-6:],
                    "verified_action_result": action_result,
                }, ensure_ascii=False)},
            ],
            text_format=HandoffDecision,
            max_output_tokens=100,
        )
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI did not return a handoff decision")
        usage = response.usage
        return parsed, (time.perf_counter() - started) * 1000, (
            usage.input_tokens if usage else 0
        ), (usage.output_tokens if usage else 0)
