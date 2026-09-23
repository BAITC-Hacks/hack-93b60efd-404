"""Session state and truthful first-turn responses for the official case."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from .actions import ActionError, ActionExecutor
from .catalog import Catalog
from .router import OpenAIRouter
from .slots import OpenAISlotExtractor


@dataclass
class SessionState:
    session_id: str
    active_scenario: str | None = None
    active_completed: bool = False
    pending_scenarios: list[str] = field(default_factory=list)
    response_language: str = "ru"
    slot_values: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, str]] = field(default_factory=list)
    turn_count: int = 0
    pending_confirmation: dict[str, Any] | None = None
    executed_action_keys: set[str] = field(default_factory=set)
    response_ms: float = 0
    response_input_tokens: int = 0
    response_output_tokens: int = 0
    travel_quote: dict[str, Any] | None = None
    travel_purchase_requested: bool = False
    lock: Lock = field(default_factory=Lock, repr=False)


class DialogueService:
    def __init__(
        self,
        catalog: Catalog,
        router: OpenAIRouter,
        slot_extractor: OpenAISlotExtractor,
        actions: ActionExecutor,
    ) -> None:
        self.catalog = catalog
        self.router = router
        self.slot_extractor = slot_extractor
        self.actions = actions
        self.sessions: dict[str, SessionState] = {}

    def create_session(self) -> SessionState:
        session = SessionState(session_id=uuid.uuid4().hex)
        self.sessions[session.session_id] = session
        return session

    def process_text(self, session_id: str, transcript: str) -> dict[str, Any]:
        state = self.sessions.get(session_id)
        if state is None:
            raise KeyError(f"Unknown session ID: {session_id}")
        with state.lock:
            return self._process_locked(state, transcript)

    def _process_locked(self, state: SessionState, transcript: str) -> dict[str, Any]:
        session_id = state.session_id
        if state.turn_count >= 10:
            raise ValueError("The official dialogue limit is ten customer turns")
        if not transcript.strip():
            raise ValueError("A non-empty customer utterance is required")

        if state.pending_confirmation is not None:
            interpretation, model_ms, input_tokens, output_tokens = self.router.interpret_confirmation(
                transcript, pending_action=state.pending_confirmation, history=state.history
            )
            if interpretation.has_new_request and interpretation.decision in {"reject", "change_request"}:
                state.pending_confirmation = None
            elif interpretation.decision in {"approve", "reject", "unclear"}:
                return self._resolve_confirmation(
                    state, transcript, interpretation.decision,
                    interpretation.reason, model_ms, input_tokens, output_tokens,
                )
            state.pending_confirmation = None

        started = time.perf_counter()
        state.response_ms = 0
        state.response_input_tokens = 0
        state.response_output_tokens = 0
        result = self.router.route(
            transcript,
            history=state.history,
            active_scenario=state.active_scenario,
            pending_scenarios=state.pending_scenarios,
        )
        decision = result.decision
        response_language = decision.language if decision.language != "mixed" else state.response_language
        state.response_language = response_language
        route_ids = decision.scenario_ids
        first_id = route_ids[0]
        extraction = None
        action_trace: list[dict[str, Any]] = []
        if first_id.startswith("SYS_"):
            answer = self._system_answer(first_id, response_language, decision.alternatives)
            if first_id == "SYS_GOODBYE":
                state.active_scenario = None
                state.active_completed = False
                state.pending_scenarios.clear()
                state.pending_confirmation = None
                state.slot_values.clear()
                state.travel_quote = None
                state.travel_purchase_requested = False
        else:
            if state.active_scenario and state.active_scenario != first_id and not state.active_completed:
                if state.active_scenario not in state.pending_scenarios:
                    state.pending_scenarios.insert(0, state.active_scenario)
            if first_id in state.pending_scenarios:
                state.pending_scenarios.remove(first_id)
            state.active_scenario = first_id
            state.active_completed = False
            for extra_id in route_ids[1:]:
                if extra_id not in state.pending_scenarios and extra_id != first_id:
                    state.pending_scenarios.append(extra_id)
            scenario = self.catalog.require_route(first_id)
            needs_slots = any(
                self.catalog.require_route(route_id)["slots"]["required"]
                or self.catalog.require_route(route_id)["slots"]["optional"]
                or self.catalog.require_route(route_id)["requires_identification"]
                for route_id in route_ids
            )
            if needs_slots:
                extraction = self.slot_extractor.extract(
                    transcript, route_ids, response_language=response_language
                )
                if ("phone" in extraction.values and state.slot_values.get("phone")
                        not in {None, extraction.values["phone"]}):
                    state.slot_values.pop("policy_number", None)
                    state.slot_values.pop("claim_number", None)
                if ("trip_country" in extraction.values and
                        state.slot_values.get("trip_country")
                        not in {None, extraction.values["trip_country"]}):
                    state.slot_values.pop("trip_zone", None)
                if any(
                    key in extraction.values and state.slot_values.get(key)
                    not in {None, extraction.values[key]}
                    for key in ("trip_country", "trip_start", "trip_end", "travelers_count", "traveler_max_age")
                ):
                    state.travel_quote = None
                    state.travel_purchase_requested = False
                state.slot_values.update(extraction.values)
                response_language = extraction.response_language
                state.response_language = response_language
            self._resolve_known_slots(state, scenario)
            missing = [
                name for name in scenario["slots"]["required"] if name not in state.slot_values
            ]
            if missing:
                answer = self.catalog.slots[missing[0]]["prompt"][response_language]
                if first_id == "SC17" and missing[0] == "claim_number" and "phone" not in state.slot_values:
                    answer = scenario["responses"][response_language]["opening"]
                if first_id == "SC11":
                    answer = (
                        "Если есть пострадавшие, сначала звоните 112. Включите аварийку, выставьте знак и не перемещайте машины до оформления. "
                        if response_language == "ru" else
                        "Зардап шеккендер болса, алдымен 112-ге қоңырау шалыңыз. Апат белгісін қойып, рәсімдеуге дейін көліктерді қозғамаңыз. "
                    ) + answer
                elif first_id == "SC15":
                    answer = (
                        "При медицинском случае за границей сначала позвоните в круглосуточный медицинский ассистанс. "
                        if response_language == "ru" else
                        "Шетелде медициналық жағдай болса, алдымен тәулік бойғы медициналық ассистансқа хабарласыңыз. "
                    ) + answer
            else:
                answer, action_trace = self._answer_with_data(
                    state, first_id, response_language, state.slot_values, transcript
                )
                state.active_completed = any(
                    action.get("status") == "executed" for action in action_trace
                )
            for extra_id in route_ids[1:]:
                if extra_id not in state.pending_scenarios or extra_id.startswith("SYS_"):
                    continue
                extra = self.catalog.require_route(extra_id)
                if (extra["slots"]["required"] or extra["requires_identification"]
                        or "kb_lookup" not in extra["actions"]
                        or any(self.catalog.actions[name]["irreversible"] for name in extra["actions"])):
                    continue
                extra_answer, extra_trace = self._answer_with_data(
                    state, extra_id, response_language, state.slot_values, transcript
                )
                if any(item.get("status") == "executed" for item in extra_trace):
                    answer = extra_answer + " " + answer
                    action_trace.extend(extra_trace)
                    state.pending_scenarios.remove(extra_id)
            if any(extra_id in state.pending_scenarios for extra_id in route_ids[1:]):
                answer += (
                    " Я также сохранил ваш другой вопрос."
                    if response_language == "ru"
                    else " Басқа сұрағыңызды да сақтап қойдым."
                )

        state.history.extend(
            [
                {"role": "client", "content": transcript},
                {"role": "assistant", "content": answer},
            ]
        )
        state.history = state.history[-20:]
        state.turn_count += 1
        total_ms = (time.perf_counter() - started) * 1000
        return {
            "session_id": session_id,
            "turn": state.turn_count,
            "answer_text": answer,
            "language": response_language,
            "route": route_ids,
            "route_details": [self.catalog.route_summary(item) for item in route_ids],
            "active_scenario": state.active_scenario,
            "pending_scenarios": list(state.pending_scenarios),
            "trace": {
                "transcript": transcript,
                "selected_scenarios": route_ids,
                "alternatives": decision.alternatives,
                "alternative_details": [
                    self.catalog.route_summary(item) for item in decision.alternatives
                ],
                "reason": decision.reason,
                "is_continuation": decision.is_continuation,
                "model": result.model,
                "ambiguity_reviewed": result.ambiguity_reviewed,
                "router_ms": round(result.router_ms, 1),
                "extractor_ms": round(extraction.extractor_ms, 1) if extraction else None,
                "jev_ms": round(extraction.jev_ms, 1) if extraction else None,
                "jev_probability": extraction.jev_probability if extraction else None,
                "jev_skipped_luna": extraction.jev_skipped_luna if extraction else False,
                "response_ms": round(state.response_ms, 1),
                "total_ms": round(total_ms, 1),
                "stt_ms": None,
                "tts_first_audio_ms": None,
                "input_tokens": result.input_tokens + (extraction.input_tokens if extraction else 0) + state.response_input_tokens,
                "output_tokens": result.output_tokens + (extraction.output_tokens if extraction else 0) + state.response_output_tokens,
                "rejected_slots": extraction.rejected if extraction else [],
                "actions": action_trace,
            },
        }

    def _resolve_known_slots(self, state: SessionState, scenario: dict[str, Any]) -> None:
        """Reuse unique official case records, never guess among multiple matches."""
        values = state.slot_values
        if "claim_number" in values and "product_type" in scenario["slots"]["required"]:
            try:
                claim = self.actions.execute("get_claim", claim_number=values["claim_number"])
                values.setdefault("product_type", claim["claim_type"])
            except ActionError:
                pass
        if not scenario["requires_identification"] or "phone" not in values:
            return
        try:
            client_id = self.actions.execute("find_client", phone=values["phone"])["client_id"]
        except ActionError:
            return
        if "city" in scenario["slots"]["required"] and "city" not in values:
            client = next(
                item for item in self.actions.data["clients"] if item["client_id"] == client_id
            )
            values["city"] = client["city"]
        if "claim_number" in scenario["slots"]["required"] and "claim_number" not in values:
            try:
                claim = self.actions.execute("get_claim", client_id=client_id)
                values["claim_number"] = claim["claim_number"]
            except ActionError:
                pass
        if ("policy_number" in scenario["slots"]["required"] or
                scenario["scenario_id"] == "SC26") and "policy_number" not in values:
            try:
                policies = self.actions.execute("get_policies", client_id=client_id)["policies"]
            except ActionError:
                return
            product = values.get("product_type")
            if product:
                policies = [policy for policy in policies if policy["product"] == product]
            if len(policies) == 1:
                values["policy_number"] = policies[0]["policy_number"]

    def _answer_with_data(
        self, state: SessionState, scenario_id: str, language: str,
        values: dict[str, Any], transcript: str,
    ) -> tuple[str, list[dict[str, Any]]]:
        scenario = self.catalog.require_route(scenario_id)
        identified_client_id = None
        if scenario["requires_identification"]:
            if "phone" not in values:
                return self.catalog.slots["phone"]["prompt"][language], []
            try:
                identified_client_id = self.actions.execute(
                    "find_client", phone=values["phone"]
                )["client_id"]
            except ActionError as exc:
                return str(exc), [{"name": "find_client", "status": "error", "error_code": exc.code}]

        # Verify synthetic-record ownership before any lookup or write involving a
        # known claim or policy. A spoken number alone is never authorization.
        if identified_client_id and "policy_number" in values:
            try:
                record = self.actions.execute("get_policy", policy_number=values["policy_number"])
            except ActionError as exc:
                return str(exc), [{"name": "get_policy", "status": "error", "error_code": exc.code}]
            if record["client_id"] != identified_client_id:
                return self._ownership_denied(language), [
                    {"name": "get_policy", "status": "denied", "error_code": "ownership_mismatch"}
                ]
        if identified_client_id and "claim_number" in values:
            try:
                record = self.actions.execute("get_claim", claim_number=values["claim_number"])
            except ActionError as exc:
                return str(exc), [{"name": "get_claim", "status": "error", "error_code": exc.code}]
            if record["client_id"] != identified_client_id:
                return self._ownership_denied(language), [
                    {"name": "get_claim", "status": "denied", "error_code": "ownership_mismatch"}
                ]

        primary: dict[str, tuple[str, tuple[str, ...]]] = {
            "SC01": ("calc_ogpo_price", ("region", "vehicle_type", "drivers_iin")),
            "SC02": ("create_policy", ("vehicle_plate", "drivers_iin", "phone", "region", "vehicle_type")),
            "SC03": ("calc_casco_price", ("car_value", "car_year")),
            "SC04": ("update_policy", ("policy_number", "new_driver_iin")),
            "SC05": ("update_policy", ("policy_number", "vehicle_plate")),
            "SC06": ("create_policy", ("trip_country", "trip_start", "trip_end", "travelers_count", "traveler_max_age")),
            "SC07": ("calc_property_price", ("property_type", "sum_insured")),
            "SC08": ("calc_accident_price", ("sum_insured",)),
            "SC09": ("kb_lookup", ()),
            "SC10": ("transfer_to_operator", ("company_name", "employees_count", "phone")),
            "SC11": ("transfer_to_operator", ("injured", "location")),
            "SC12": ("create_claim", ("culprit_vehicle_plate", "incident_date", "incident_description", "phone")),
            "SC13": ("create_claim", ("policy_number", "incident_date", "incident_description")),
            "SC14": ("create_claim", ("policy_number", "incident_date", "incident_description")),
            "SC15": ("transfer_to_operator", ("policy_number", "location", "incident_description")),
            "SC16": ("create_claim", ("policy_number", "incident_date", "incident_description")),
            "SC17": ("get_claim", ("claim_number",)),
            "SC18": ("kb_lookup", ("product_type",)),
            "SC19": ("create_dispute", ("claim_number", "complaint_text")),
            "SC20": ("book_inspection", ("claim_number", "city", "preferred_date")),
            "SC21": ("book_appointment", ("policy_number", "doctor_specialty", "city", "preferred_date")),
            "SC22": ("check_coverage", ("policy_number", "service_name")),
            "SC23": ("list_clinics", ("city",)),
            "SC24": ("kb_lookup", ("phone",)),
            "SC25": ("get_policy", ("policy_number",)),
            "SC26": ("resend_documents", ("policy_number",)),
            "SC27": ("renew_policy", ("policy_number",)),
            "SC28": ("cancel_policy", ("policy_number", "cancel_reason")),
            "SC29": ("update_contact", ("contact_field", "new_value")),
            "SC30": ("check_payment", ("payment_date",)),
            "SC31": ("kb_lookup", ()),
            "SC32": ("get_bm_class", ("iin",)),
            "SC33": ("get_offices", ("city",)),
            "SC34": ("kb_lookup", ()),
            "SC35": ("create_complaint", ("complaint_text",)),
            "SC36": ("create_callback", ("phone", "callback_time")),
            "SC37": ("transfer_to_operator", ()),
            "SC38": ("report_fraud", ("fraud_details",)),
            "SC39": ("request_document", ("policy_number", "document_type", "email")),
            "SC40": ("kb_lookup", ()),
        }
        action_name, required = primary[scenario_id]
        for name in required:
            if name not in values:
                return self.catalog.slots[name]["prompt"][language], []
        params = {name: values[name] for name in required}
        if scenario_id == "SC03" and "franchise" in values:
            params["franchise"] = values["franchise"]
        if scenario_id == "SC02":
            try:
                quote = self.actions.execute("calc_ogpo_price", region=values["region"],
                    vehicle_type=values["vehicle_type"], drivers_iin=values["drivers_iin"])
            except ActionError as exc:
                return str(exc), [{"name": "calc_ogpo_price", "status": "error", "error_code": exc.code}]
            params = {"product_type": "ogpo", "phone": values["phone"], "price": quote["price"],
                      "vehicle_plate": values["vehicle_plate"], "drivers_iin": values["drivers_iin"]}
        elif scenario_id == "SC06":
            if "trip_zone" not in values:
                return (
                    "Не могу надёжно определить тарифную зону для этой страны. Уточните страну поездки."
                    if language == "ru" else
                    "Бұл елдің тарифтік аймағын сенімді анықтай алмаймын. Баратын елді нақтылаңыз."
                ), []
            try:
                quote = self.actions.execute("calc_travel_price", **{
                    key: values[key] for key in ("trip_country", "trip_zone", "trip_start", "trip_end", "travelers_count", "traveler_max_age")
                })
            except ActionError as exc:
                return str(exc), [{"name": "calc_travel_price", "status": "error", "error_code": exc.code}]
            if state.travel_quote is not None and not state.travel_purchase_requested:
                offer, offer_ms, offer_input, offer_output = self.router.interpret_purchase_offer(
                    transcript=transcript, history=state.history, quote=state.travel_quote,
                )
                state.response_ms += offer_ms
                state.response_input_tokens += offer_input
                state.response_output_tokens += offer_output
                if offer.decision == "approve":
                    state.travel_purchase_requested = True
                elif offer.decision == "reject":
                    state.travel_quote = None
                    return ("Хорошо, оформление не начинаю." if language == "ru"
                        else "Жақсы, рәсімдеуді бастамаймын."), []
                elif offer.decision == "unclear":
                    return ("Хотите оформить этот рассчитанный полис?" if language == "ru"
                        else "Осы есептелген полисті рәсімдегіңіз келе ме?"), []
            if not state.travel_purchase_requested:
                state.travel_quote = quote
                answer, state.response_ms, state.response_input_tokens, state.response_output_tokens = (
                    self.router.compose_answer(
                        transcript=transcript, scenario=scenario, language=language,
                        facts={**quote, "travelers_count": values["travelers_count"],
                               "traveler_max_age": values["traveler_max_age"],
                               "trip_country": values["trip_country"],
                               "trip_start": values["trip_start"], "trip_end": values["trip_end"],
                               "quote_complete": True,
                               "next_step": "State the price and coverage, then ask whether to purchase. Do not ask more quote questions."},
                        history=state.history,
                    )
                )
                return answer, [{"name": "calc_travel_price", "status": "executed", "result": quote}]
            if "phone" not in values:
                return self.catalog.slots["phone"]["prompt"][language], []
            params = {"product_type": "travel", "phone": values["phone"], "price": quote["price"],
                      "trip_country": values["trip_country"], "trip_start": values["trip_start"],
                      "trip_end": values["trip_end"], "travelers_count": values["travelers_count"]}
        elif scenario_id in {"SC12", "SC13", "SC14", "SC16"}:
            if scenario_id == "SC12" and "phone" in values:
                try:
                    identified_client_id = self.actions.execute(
                        "find_client", phone=values["phone"]
                    )["client_id"]
                except ActionError:
                    pass
            params = {"product_type": {"SC12": "ogpo", "SC13": "casco", "SC14": "property", "SC16": "accident"}[scenario_id],
                      "incident_date": values["incident_date"], "incident_description": values["incident_description"],
                      "client_id": identified_client_id, "policy_number": values.get("policy_number")}
            if scenario_id == "SC12":
                try:
                    culprit_policy = self.actions.execute(
                        "get_policy", vehicle_plate=values["culprit_vehicle_plate"]
                    )
                except ActionError as exc:
                    return str(exc), [{"name": "get_policy", "status": "error", "error_code": exc.code}]
                if culprit_policy["product"] != "ogpo":
                    return ("По этому номеру не найден полис ОГПО в данных кейса."
                        if language == "ru" else "Бұл нөмірге кейс деректерінде ОГПО полисі табылмады."), [
                        {"name": "get_policy", "status": "error", "error_code": "wrong_product"}
                    ]
                params["policy_number"] = culprit_policy["policy_number"]
        elif scenario_id in {"SC04", "SC05"}:
            params = {"policy_number": values["policy_number"]}
            params["new_driver_iin" if scenario_id == "SC04" else "vehicle_plate"] = values[
                "new_driver_iin" if scenario_id == "SC04" else "vehicle_plate"]
        elif scenario_id in {"SC29", "SC30"}:
            params["client_id"] = identified_client_id
        elif scenario_id == "SC22":
            try:
                package_name, package = self.actions.coverage_reference(values["policy_number"])
                match, match_ms, match_input, match_output = self.router.match_coverage(
                    service_name=values["service_name"], package_name=package_name,
                    package=package,
                )
            except ActionError as exc:
                return str(exc), [{"name": action_name, "status": "error", "error_code": exc.code}]
            state.response_ms += match_ms
            state.response_input_tokens += match_input
            state.response_output_tokens += match_output
            params["covered"] = match.covered
            params["evidence"] = match.evidence
        elif action_name == "kb_lookup":
            params = {"topic": {"SC09": "dms", "SC18": "claim_documents", "SC24": "dms",
                "SC31": "payments", "SC34": "app_help", "SC40": "policy_terms"}[scenario_id]}
        elif action_name == "transfer_to_operator":
            params = {"queue": (scenario.get("handoff") or {}).get("queue", "operator_general"),
                      "summary": " | ".join(
                          [entry["content"] for entry in state.history[-6:] if entry["role"] == "client"]
                          + [transcript]
                      )[-700:]}

        action_key = self._action_key(action_name, params)
        if action_key in state.executed_action_keys:
            return (
                "Это действие уже записано в текущем разговоре; повторно его не выполняю."
                if language == "ru" else
                "Бұл әрекет осы сөйлесуде тіркелген; оны қайта орындамаймын."
            ), [{"name": action_name, "status": "already_executed"}]

        if self.catalog.actions[action_name]["irreversible"]:
            preview = (
                self.actions.preview_cancel_policy(params["policy_number"])
                if action_name == "cancel_policy" else {}
            )
            if scenario_id == "SC06":
                preview = {"destination": values["trip_country"], "dates": [values["trip_start"], values["trip_end"]],
                           "travelers_count": values["travelers_count"], "coverage": quote["coverage"],
                           "price_kzt": quote["price"]}
            elif scenario_id == "SC02":
                preview = {"vehicle_plate": values["vehicle_plate"],
                           "drivers_count": len(values["drivers_iin"]), "price_kzt": quote["price"]}
            elif scenario_id == "SC27":
                preview = {"previous_policy": params["policy_number"],
                           "price_kzt": self.actions._policy(params["policy_number"])["premium"]}
            state.pending_confirmation = {"name": action_name, "params": params, "scenario_id": scenario_id,
                                          "language": language, "preview": preview,
                                          "request_transcript": transcript}
            prompt, state.response_ms, state.response_input_tokens, state.response_output_tokens = (
                self.router.compose_approval_prompt(
                    scenario=scenario, language=language, action_name=action_name,
                    params=params, preview=preview,
                )
            )
            return prompt, [{"name": action_name, "status": "awaiting_confirmation",
                             "params": params, "preview": preview}]
        try:
            result = self.actions.execute(action_name, **params)
        except ActionError as exc:
            return str(exc), [{"name": action_name, "status": "error", "error_code": exc.code}]
        if scenario_id == "SC18":
            selected = result["answer"].get(values["product_type"])
            if selected is None:
                return ("Для этого продукта списка документов нет в базе кейса." if language == "ru"
                    else "Бұл өнімнің құжат тізімі кейс базасында жоқ."), [
                    {"name": action_name, "status": "not_found"}
                ]
            result = {"answer": selected, "product_type": values["product_type"],
                      "source": result["source"]}
            if "claim_number" in values and "phone" in values:
                try:
                    client = self.actions.execute("find_client", phone=values["phone"])
                    claim = self.actions.execute("get_claim", claim_number=values["claim_number"])
                    if claim["client_id"] == client["client_id"]:
                        result["claim_status"] = claim["status"]
                        result["claim_next_step"] = claim["next_step"]
                except ActionError:
                    pass
        if scenario_id == "SC31" and "policy_number" in values:
            try:
                result["current_policy_product"] = self.actions._policy(
                    values["policy_number"]
                )["product"]
            except ActionError:
                pass
        if scenario_id == "SC30" and result["payment_status"] == "charged_policy_not_issued":
            handoff_params = {"queue": scenario["handoff"]["queue"],
                              "summary": " | ".join(
                                  [entry["content"] for entry in state.history[-6:]
                                   if entry["role"] == "client"] + [transcript]
                              )[-700:]}
            handoff_key = self._action_key("transfer_to_operator", handoff_params)
            if handoff_key not in state.executed_action_keys:
                handoff = self.actions.execute("transfer_to_operator", **handoff_params)
                state.executed_action_keys.add(handoff_key)
                handoff_status = "executed"
            else:
                handoff = {"status": "already_queued"}
                handoff_status = "already_executed"
            answer = (
                f"В данных кейса найден платёж {result['amount']} тенге без выпущенного полиса. "
                f"Обращение {handoff.get('handoff_id', '')} записано в локальную очередь специалиста; живое соединение пока не подключено."
                if language == "ru" else
                f"Кейс деректерінде {result['amount']} теңге төлем бар, бірақ полис шықпаған. "
                f"{handoff.get('handoff_id', '')} өтініші маманның жергілікті кезегіне жазылды; тікелей қосылу әлі жоқ."
            )
            return answer, [{"name": action_name, "status": "executed", "result": result},
                            {"name": "transfer_to_operator", "status": handoff_status,
                             "result": handoff}]
        if self._has_side_effect(action_name):
            state.executed_action_keys.add(action_key)

        if not self._has_side_effect(action_name):
            facts = dict(result)
            product_key = {"SC01": "ogpo", "SC03": "casco", "SC07": "property",
                           "SC08": "accident"}.get(scenario_id)
            if product_key:
                product = self.catalog.knowledge_base["products"][product_key]
                facts["product_facts"] = (
                    {"packages": {"Standard": product["packages"]["Standard"]}}
                    if product_key == "casco" else
                    {"covers": product["covers"]}
                )
            if scenario_id == "SC32":
                facts["bonus_malus_facts"] = self.catalog.knowledge_base["bonus_malus"]
            answer, answer_ms, answer_input, answer_output = (
                self.router.compose_answer(
                    transcript=transcript, scenario=scenario, language=language,
                    facts=facts, history=state.history,
                )
            )
            state.response_ms += answer_ms
            state.response_input_tokens += answer_input
            state.response_output_tokens += answer_output
        elif action_name == "transfer_to_operator":
            answer = (f"Запрос {result['handoff_id']} записан для оператора в локальной системе. Живое соединение пока не подключено."
                if language == "ru" else f"{result['handoff_id']} сұрауы жергілікті жүйеге жазылды. Оператормен тікелей қосылу әлі қосылмаған.")
            if scenario_id == "SC11":
                answer = ("Если есть пострадавшие, немедленно звоните 112. Включите аварийку и не перемещайте машины до оформления. "
                    if language == "ru" else "Зардап шеккендер болса, дереу 112-ге қоңырау шалыңыз. Апат белгісін қосып, рәсімдеуге дейін көліктерді қозғамаңыз. ") + answer
            elif scenario_id == "SC15":
                answer = ("Сначала свяжитесь с круглосуточным медицинским ассистансом по вашему полису. "
                    if language == "ru" else "Алдымен полистегі тәулік бойғы медициналық ассистансқа хабарласыңыз. ") + answer
        elif action_name in {"create_callback", "create_complaint", "report_fraud"}:
            answer = (f"Обращение {result['ticket_id']} записано в локальной системе кейса. Реальный звонок или отправка пока не подключены."
                if language == "ru" else f"{result['ticket_id']} өтініші жергілікті жүйеге жазылды. Нақты қоңырау немесе жіберу әлі қосылмаған.")
            if action_name == "report_fraud":
                answer += (" Никому не сообщайте SMS-код, PIN или CVV."
                    if language == "ru" else " SMS-кодты, PIN немесе CVV-ді ешкімге айтпаңыз.")
        elif action_name in {"resend_documents", "request_document"}:
            answer = ("Запрос записан локально, но отправка документов сейчас не подключена."
                if language == "ru" else "Сұрау жергілікті жүйеге жазылды, бірақ құжат жіберу қосылмаған.")
        else:
            try:
                answer = scenario["responses"][language]["closing"].format(**result)
            except KeyError:
                answer = scenario["responses"][language]["opening"]
        action_trace = [{"name": action_name, "status": "executed", "result": result}]
        if scenario_id in {"SC34", "SC35", "SC38"}:
            suffix, handoff_trace = self._conditional_handoff(
                state, scenario, transcript, result, language
            )
            answer += suffix
            action_trace.extend(handoff_trace)
        return answer, action_trace

    @staticmethod
    def _ownership_denied(language: str) -> str:
        return ("Эта запись не принадлежит указанному клиенту. Не раскрываю данные; обратитесь к оператору."
            if language == "ru" else "Бұл жазба көрсетілген клиентке тиесілі емес. Деректерді бермеймін; операторға хабарласыңыз.")

    @staticmethod
    def _action_key(name: str, params: dict[str, Any]) -> str:
        return name + ":" + json.dumps(params, ensure_ascii=False, sort_keys=True, default=str)

    def _has_side_effect(self, name: str) -> bool:
        return self.catalog.actions[name]["irreversible"] or name in {
            "create_callback", "create_complaint", "report_fraud", "transfer_to_operator",
            "resend_documents", "request_document",
        }

    def _conditional_handoff(
        self, state: SessionState, scenario: dict[str, Any], transcript: str,
        action_result: dict[str, Any], language: str,
    ) -> tuple[str, list[dict[str, Any]]]:
        decision, elapsed, input_tokens, output_tokens = self.router.decide_conditional_handoff(
            scenario=scenario, transcript=transcript, history=state.history,
            action_result=action_result,
        )
        state.response_ms += elapsed
        state.response_input_tokens += input_tokens
        state.response_output_tokens += output_tokens
        if not decision.handoff:
            return "", []
        params = {"queue": scenario["handoff"]["queue"],
                  "summary": " | ".join(
                      [entry["content"] for entry in state.history[-6:] if entry["role"] == "client"]
                      + [transcript]
                  )[-700:]}
        key = self._action_key("transfer_to_operator", params)
        if key in state.executed_action_keys:
            return "", [{"name": "transfer_to_operator", "status": "already_executed"}]
        result = self.actions.execute("transfer_to_operator", **params)
        state.executed_action_keys.add(key)
        suffix = (
            f" Обращение {result['handoff_id']} также записано в локальную очередь специалиста; живое соединение не подключено."
            if language == "ru" else
            f" {result['handoff_id']} өтініші маманның жергілікті кезегіне жазылды; тікелей қосылу қосылмаған."
        )
        return suffix, [{"name": "transfer_to_operator", "status": "executed",
                         "reason": decision.reason, "result": result}]

    def _resolve_confirmation(self, state: SessionState, transcript: str,
                              decision: str, reason: str, model_ms: float,
                              input_tokens: int, output_tokens: int) -> dict[str, Any]:
        pending = state.pending_confirmation
        assert pending is not None
        language = pending["language"]
        started = time.perf_counter()
        state.response_ms = 0
        state.response_input_tokens = 0
        state.response_output_tokens = 0
        action_trace: list[dict[str, Any]] = []
        if decision == "unclear":
            answer = ("Не расслышал однозначного подтверждения. Подтвердите именно это действие или отмените его."
                if language == "ru" else "Нақты растауды түсінбедім. Осы әрекетті нақты растаңыз немесе тоқтатыңыз.")
        elif decision == "reject":
            state.pending_confirmation = None
            answer = "Действие отменено." if language == "ru" else "Әрекет тоқтатылды."
        else:
            state.pending_confirmation = None
            action_key = self._action_key(pending["name"], pending["params"])
            try:
                if action_key in state.executed_action_keys:
                    answer = ("Это действие уже выполнено; повторно не записываю." if language == "ru"
                        else "Бұл әрекет орындалған; қайта жазбаймын.")
                    action_trace = [{"name": pending["name"], "status": "already_executed"}]
                else:
                    result = self.actions.execute(pending["name"], confirmed=True, **pending["params"])
                    state.executed_action_keys.add(action_key)
                    action_trace = [{"name": pending["name"], "status": "executed", "result": result}]
                    state.active_completed = True
                    identifier = result.get("policy_number") or result.get("claim_number") or result.get("ticket_id")
                    answer = (f"Подтверждено: действие записано в локальной системе кейса{f' под номером {identifier}' if identifier else ''}. "
                        "SMS, оплату и живое соединение с оператором эта версия не выполняет."
                        if language == "ru" else
                        f"Расталды: әрекет жергілікті кейс жүйесіне жазылды{f' ({identifier})' if identifier else ''}. "
                        "SMS, төлем және оператормен тікелей қосылу бұл нұсқада орындалмайды.")
                    if pending["scenario_id"] in {"SC13", "SC14", "SC19"}:
                        suffix, additional = self._conditional_handoff(
                            state, self.catalog.require_route(pending["scenario_id"]),
                            pending["request_transcript"], result, language,
                        )
                        answer += suffix
                        action_trace.extend(additional)
            except ActionError as exc:
                answer = str(exc)
                action_trace = [{"name": pending["name"], "status": "error", "error_code": exc.code}]
        state.history.extend([{"role": "client", "content": transcript}, {"role": "assistant", "content": answer}])
        state.history = state.history[-20:]
        state.turn_count += 1
        return {"session_id": state.session_id, "turn": state.turn_count, "answer_text": answer,
                "language": language, "route": [pending["scenario_id"]],
                "route_details": [self.catalog.route_summary(pending["scenario_id"])],
                "active_scenario": state.active_scenario,
                "pending_scenarios": list(state.pending_scenarios),
                "trace": {"transcript": transcript, "selected_scenarios": [pending["scenario_id"]],
                          "alternatives": [], "alternative_details": [], "reason": reason,
                          "model": self.router.model, "router_ms": round(model_ms, 1), "extractor_ms": 0,
                          "response_ms": round(state.response_ms, 1),
                          "total_ms": round((time.perf_counter() - started) * 1000, 1),
                          "stt_ms": None, "tts_first_audio_ms": None,
                          "input_tokens": input_tokens + state.response_input_tokens,
                          "output_tokens": output_tokens + state.response_output_tokens,
                          "rejected_slots": [],
                          "actions": action_trace}}

    def _system_answer(self, route_id: str, language: str, alternatives: list[str]) -> str:
        intent = self.catalog.require_route(route_id)
        if route_id != "SYS_UNCLEAR":
            return intent["response"][language]
        plausible = [self.catalog.require_route(sid) for sid in alternatives[:2]]
        if len(plausible) == 2:
            return intent["response"][language].format(
                option_a=plausible[0]["name"],
                option_b=plausible[1]["name"],
            )
        return (
            "Уточните, пожалуйста, что вы хотите сделать со страховкой?"
            if language == "ru"
            else "Сақтандыру бойынша не істегіңіз келетінін нақтылап айтыңызшы?"
        )
