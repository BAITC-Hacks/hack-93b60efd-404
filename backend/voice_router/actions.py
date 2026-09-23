"""Actions over the organizer's synthetic Saqta dataset; no external delivery."""

from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

from .catalog import Catalog


DATA_DATE = date(2026, 10, 1)


class ActionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ActionExecutor:
    """In-process case actions, with explicit approval for irreversible writes."""

    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog
        self.data = deepcopy(catalog.mock_backend)
        self.knowledge = catalog.knowledge_base
        self.events: list[dict[str, Any]] = []

    def execute(self, name: str, *, confirmed: bool = False, **params: Any) -> dict[str, Any]:
        definition = self.catalog.actions.get(name)
        if definition is None:
            raise ActionError("unknown_action", f"Unknown official action: {name}")
        if definition["irreversible"] and not confirmed:
            raise ActionError("confirmation_required", f"{name} needs an explicit confirmation flow")
        handler = getattr(self, f"_handle_{name}", None)
        if handler is None:
            raise ActionError("not_implemented", f"Action {name} is not implemented")
        return handler(**params)

    def _record(self, name: str, **payload: Any) -> dict[str, Any]:
        item = {"id": uuid4().hex[:12], "action": name, "mode": "local_case_simulation", **payload}
        self.events.append(item)
        return item

    def _policy(self, number: str) -> dict[str, Any]:
        policy = next((item for item in self.data["policies"] if item["policy_number"] == number), None)
        if policy is None:
            raise ActionError("not_found", "Policy not found in the official synthetic records")
        return policy

    def _claim(self, number: str) -> dict[str, Any]:
        claim = next((item for item in self.data["claims"] if item["claim_number"] == number), None)
        if claim is None:
            raise ActionError("not_found", "Claim not found in the official synthetic records")
        return claim

    def _handle_find_client(self, *, phone: str | None = None, iin: str | None = None) -> dict[str, Any]:
        if not (phone or iin):
            raise ActionError("missing_input", "A phone number or IIN is required")
        for client in self.data["clients"]:
            if (phone and client["phone"] == phone) or (iin and client["iin"] == iin):
                return {"client_id": client["client_id"], "full_name": client["full_name"]}
        raise ActionError("not_found", "Client not found in the official synthetic records")

    def _handle_get_policies(self, *, client_id: str) -> dict[str, Any]:
        if not any(client["client_id"] == client_id for client in self.data["clients"]):
            raise ActionError("not_found", "Client not found")
        return {
            "policies": [
                policy for policy in self.data["policies"] if policy["client_id"] == client_id
            ]
        }

    def _handle_get_policy(
        self, *, policy_number: str | None = None, vehicle_plate: str | None = None
    ) -> dict[str, Any]:
        if not (policy_number or vehicle_plate):
            raise ActionError("missing_input", "Policy number or vehicle plate is required")
        for policy in self.data["policies"]:
            if (policy_number and policy["policy_number"] == policy_number) or (
                vehicle_plate and policy["details"].get("vehicle_plate") == vehicle_plate
            ):
                return {
                    "policy_number": policy["policy_number"],
                    "product": policy["product"],
                    "status": "active" if date.fromisoformat(policy["end_date"]) >= DATA_DATE else "expired",
                    "end_date": policy["end_date"],
                    "client_id": policy["client_id"],
                }
        raise ActionError("not_found", "Policy not found in the official synthetic records")

    def _handle_get_bm_class(self, *, iin: str) -> dict[str, Any]:
        client = next((item for item in self.data["clients"] if item["iin"] == iin), None)
        return {"bm_class": client["bm_class"] if client else self.data["defaults"]["unknown_iin_bm_class"]}

    def _handle_calc_ogpo_price(
        self, *, region: str, vehicle_type: str, drivers_iin: list[str], term_months: int = 12
    ) -> dict[str, Any]:
        if not drivers_iin:
            raise ActionError("missing_input", "At least one driver IIN is required")
        pricing = self.knowledge["products"]["ogpo"]["pricing"]
        try:
            base = Decimal(str(pricing["base_by_region_kzt"][region]))
            vehicle_coef = Decimal(str(pricing["vehicle_type_coef"][vehicle_type]))
            term_coef = Decimal(str(pricing["term_coef"][str(term_months)]))
            worst_bm_coef = max(
                Decimal(str(pricing["bm_coef"][self._handle_get_bm_class(iin=iin)["bm_class"]]))
                for iin in drivers_iin
            )
        except KeyError as exc:
            raise ActionError("invalid_input", f"Unsupported OGPO price parameter: {exc}") from exc
        price = (base * vehicle_coef * worst_bm_coef * term_coef).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
        return {"price": int(price)}

    def _handle_calc_casco_price(
        self, *, car_value: int, car_year: int, franchise: int = 0
    ) -> dict[str, Any]:
        if car_value <= 0 or car_year > DATA_DATE.year:
            raise ActionError("invalid_input", "Car value and manufacturing year must be valid")
        pricing = self.knowledge["products"]["casco"]["pricing"]
        age = DATA_DATE.year - car_year
        if age > pricing["max_car_age"]["Standard"]:
            raise ActionError("not_eligible", "CASCO Standard is not available for this vehicle age")
        age_band = "0-3" if age <= 3 else "4-7" if age <= 7 else "8-10"
        try:
            rate = Decimal(str(pricing["rate_by_car_age"][age_band]))
            franchise_coef = Decimal(str(pricing["franchise_coef"][str(franchise)]))
            package_coef = Decimal(str(pricing["package_coef"]["Standard"]))
        except KeyError as exc:
            raise ActionError("invalid_input", f"Unsupported CASCO parameter: {exc}") from exc
        price = (
            Decimal(car_value) * rate * franchise_coef * package_coef
        ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return {"price": int(price)}

    def _handle_calc_property_price(self, *, property_type: str, sum_insured: int) -> dict[str, Any]:
        product = self.knowledge["products"]["property"]
        try:
            base = Decimal(str(product["price_per_year_kzt"][str(sum_insured)]))
        except KeyError as exc:
            raise ActionError("invalid_input", "Unsupported property coverage amount") from exc
        if property_type not in {"apartment", "house"}:
            raise ActionError("invalid_input", "Property type must be apartment or house")
        coef = Decimal(str(product["house_coef"])) if property_type == "house" else Decimal("1")
        return {"price": int((base * coef).quantize(Decimal("1"), rounding=ROUND_HALF_UP))}

    def _handle_calc_accident_price(self, *, sum_insured: int) -> dict[str, Any]:
        try:
            return {
                "price": self.knowledge["products"]["accident"]["price_per_year_kzt"][
                    str(sum_insured)
                ]
            }
        except KeyError as exc:
            raise ActionError("invalid_input", "Unsupported accident coverage amount") from exc

    def _handle_get_claim(
        self, *, claim_number: str | None = None, client_id: str | None = None
    ) -> dict[str, Any]:
        if not (claim_number or client_id):
            raise ActionError("missing_input", "Claim number or client ID is required")
        matches = [
            claim for claim in self.data["claims"]
            if (claim_number and claim["claim_number"] == claim_number)
            or (client_id and claim["client_id"] == client_id)
        ]
        if not matches:
            raise ActionError("not_found", "Claim not found")
        if len(matches) > 1:
            raise ActionError("ambiguous", "More than one claim matches; ask for a claim number")
        claim = matches[0]
        return {
            "claim_number": claim["claim_number"],
            "status": claim["status"],
            "next_step": claim["next_step"],
            "client_id": claim["client_id"],
        }

    def _handle_get_offices(self, *, city: str) -> dict[str, Any]:
        office = next(
            (item for item in self.knowledge["offices"] if item["city"].casefold() == city.casefold()),
            None,
        )
        if office is None:
            raise ActionError("not_found", "No office in that city in the official knowledge base")
        return {"address": office["address"], "hours": office["hours"]}

    def _handle_list_clinics(self, *, city: str) -> dict[str, Any]:
        clinics = [
            item for item in self.knowledge["clinics"] if item["city"].casefold() == city.casefold()
        ]
        if not clinics:
            raise ActionError("not_found", "No partner clinics in that city")
        return {"clinics": clinics}

    def _handle_calc_travel_price(
        self, *, trip_country: str, trip_zone: str, trip_start: str, trip_end: str,
        travelers_count: int, traveler_max_age: int,
    ) -> dict[str, Any]:
        if trip_zone not in self.knowledge["products"]["travel"]["zones"]:
            raise ActionError("unknown_country", "Destination zone cannot be verified; transfer to operator")
        days = (date.fromisoformat(trip_end) - date.fromisoformat(trip_start)).days + 1
        if days <= 0 or travelers_count <= 0 or traveler_max_age > 75:
            raise ActionError("not_eligible", "Invalid trip or traveler over 75; transfer to operator")
        plan = self.knowledge["products"]["travel"]["zones"][trip_zone]
        age_coef = 2 if traveler_max_age >= 65 else 1
        return {"price": plan["rate_per_day_kzt"] * days * travelers_count * age_coef,
                "zone": trip_zone, "coverage": plan["coverage"], "destination": trip_country}

    def _handle_check_payment(self, *, client_id: str, payment_date: str) -> dict[str, Any]:
        matches = [p for p in self.data["payments"] if p["client_id"] == client_id and p["date"] == payment_date]
        if not matches:
            raise ActionError("not_found", "Payment not found for this client and date")
        if len(matches) != 1:
            raise ActionError("ambiguous", "More than one payment matched")
        return {"payment_status": matches[0]["status"], "amount": matches[0]["amount"]}

    def _handle_check_coverage(self, *, policy_number: str, service_name: str) -> dict[str, Any]:
        policy = self._policy(policy_number)
        if policy["product"] != "dms":
            raise ActionError("invalid_input", "This is not a DMS policy")
        package_name = policy["details"].get("package")
        package = self.knowledge["products"]["dms"]["packages"].get(package_name)
        if package is None:
            raise ActionError("unknown_package", "DMS package is not present in the knowledge base")
        service = service_name.casefold()
        for entry in package["covered"]:
            if service in entry.casefold() or entry.casefold() in service:
                return {"covered": True, "note": f"{service_name}: covered under {package_name}; {entry}."}
        for entry in package["not_covered"]:
            if service in entry.casefold() or entry.casefold() in service:
                return {"covered": False, "note": f"{service_name}: not covered under {package_name}; {entry}."}
        raise ActionError("unknown_service", "Coverage cannot be determined from the official knowledge base")

    def _handle_kb_lookup(self, *, topic: str) -> dict[str, Any]:
        key = topic.casefold().strip()
        kb = self.knowledge
        topics: dict[str, Any] = {
            "road_accident": kb["claims"]["road_accident_now"],
            "claim_documents": kb["claims"]["documents"],
            "payments": kb["payments"],
            "app_help": kb["app_help"],
            "fraud": kb["fraud_policy"],
            "dms": kb["products"]["dms"],
            "casco": kb["products"]["casco"],
            "travel": kb["products"]["travel"],
            "policy_terms": kb["products"],
            "bonus_malus": kb["bonus_malus"],
        }
        if key not in topics:
            raise ActionError("unknown_topic", "Topic is not covered by the official knowledge base")
        return {"answer": topics[key], "source": f"knowledge_base.json:{key}"}

    def _handle_create_policy(self, *, product_type: str, phone: str, price: int | None = None) -> dict[str, Any]:
        if not any(client["phone"] == phone for client in self.data["clients"]):
            raise ActionError("not_found", "Phone is not in the official synthetic client records")
        number = f"SQ-{product_type.upper()}-{uuid4().hex[:6].upper()}"
        self._record("create_policy", policy_number=number, product_type=product_type, phone=phone, price=price)
        return {"policy_number": number, "status": "pending_payment", "delivery": "not_sent"}

    def _handle_renew_policy(self, *, policy_number: str) -> dict[str, Any]:
        policy = self._policy(policy_number)
        number = f"SQ-{policy['product'].upper()}-{uuid4().hex[:6].upper()}"
        self._record("renew_policy", old_policy_number=policy_number, policy_number=number)
        return {"policy_number": number, "price": policy["premium"], "status": "pending_payment"}

    def _handle_update_policy(self, *, policy_number: str, new_driver_iin: str | None = None,
                              vehicle_plate: str | None = None) -> dict[str, Any]:
        policy = self._policy(policy_number)
        if not (new_driver_iin or vehicle_plate):
            raise ActionError("missing_input", "Policy change is not specified")
        if new_driver_iin:
            policy["details"].setdefault("drivers_iin", []).append(new_driver_iin)
        if vehicle_plate:
            policy["details"]["vehicle_plate"] = vehicle_plate
        self._record("update_policy", policy_number=policy_number, new_driver_iin=new_driver_iin,
                     vehicle_plate=vehicle_plate)
        return {"extra_premium": None, "status": "change_recorded_price_requires_operator"}

    def _handle_cancel_policy(self, *, policy_number: str, cancel_reason: str) -> dict[str, Any]:
        policy = self._policy(policy_number)
        self._record("cancel_policy", policy_number=policy_number, reason=cancel_reason)
        policy["status"] = "cancellation_requested"
        return {"refund_amount": None, "status": "refund_requires_operator_calculation"}

    def _handle_create_claim(self, *, product_type: str, incident_date: str,
                             incident_description: str, client_id: str | None = None,
                             policy_number: str | None = None) -> dict[str, Any]:
        number = f"CL-{uuid4().hex[:6].upper()}"
        claim = {"claim_number": number, "client_id": client_id, "policy_number": policy_number,
                 "claim_type": product_type, "incident_date": incident_date,
                 "incident_description": incident_description, "status": "registered",
                 "next_step": "Submit supporting documents"}
        self.data["claims"].append(claim)
        self._record("create_claim", claim_number=number)
        return {"claim_number": number}

    def _handle_create_dispute(self, *, claim_number: str, complaint_text: str) -> dict[str, Any]:
        self._claim(claim_number)
        event = self._record("create_dispute", claim_number=claim_number, complaint_text=complaint_text)
        return {"ticket_id": event["id"]}

    def _handle_book_inspection(self, *, claim_number: str, city: str,
                                preferred_date: str) -> dict[str, Any]:
        self._claim(claim_number)
        point = next((p for p in self.knowledge["inspection_points"] if p["city"].casefold() == city.casefold()), None)
        if point is None:
            raise ActionError("not_found", "No inspection point in that city")
        self._record("book_inspection", claim_number=claim_number, city=city, preferred_date=preferred_date)
        return {"slot_datetime": f"{preferred_date} (time pending confirmation)", "address": point["address"],
                "status": "request_recorded_not_booked"}

    def _handle_book_appointment(self, *, policy_number: str, doctor_specialty: str,
                                 city: str, preferred_date: str) -> dict[str, Any]:
        self._policy(policy_number)
        clinic = next((p for p in self.knowledge["clinics"] if p["city"].casefold() == city.casefold()), None)
        if clinic is None:
            raise ActionError("not_found", "No partner clinic in that city")
        self._record("book_appointment", policy_number=policy_number, specialty=doctor_specialty,
                     city=city, preferred_date=preferred_date)
        return {"clinic_name": clinic["name"], "slot_datetime": f"{preferred_date} (time pending confirmation)",
                "status": "request_recorded_not_booked"}

    def _handle_update_contact(self, *, client_id: str, contact_field: str, new_value: str) -> dict[str, Any]:
        client = next((item for item in self.data["clients"] if item["client_id"] == client_id), None)
        if client is None or contact_field not in {"phone", "email", "address"}:
            raise ActionError("invalid_input", "Client or contact field is invalid")
        client[contact_field] = new_value
        self._record("update_contact", client_id=client_id, field=contact_field)
        return {"status": "updated_in_local_case_data"}

    def _handle_resend_documents(self, *, policy_number: str) -> dict[str, Any]:
        policy = self._policy(policy_number)
        self._record("resend_documents", policy_number=policy_number)
        return {"sent_to": None, "status": "delivery_not_connected", "client_id": policy["client_id"]}

    def _handle_request_document(self, *, policy_number: str, document_type: str,
                                 email: str) -> dict[str, Any]:
        self._policy(policy_number)
        if document_type not in self.knowledge["documents_available"]:
            raise ActionError("invalid_input", "Document type is not available")
        self._record("request_document", policy_number=policy_number,
                     document_type=document_type, email=email)
        return {"sent_to": None, "status": "request_recorded_delivery_not_connected"}

    def _handle_send_sms(self, *, phone: str | None = None) -> dict[str, Any]:
        return {"status": "not_sent", "reason": "No SMS transport is connected"}

    def _handle_create_callback(self, *, phone: str, callback_time: str) -> dict[str, Any]:
        event = self._record("create_callback", phone=phone, callback_time=callback_time)
        return {"ticket_id": event["id"], "status": "queued_locally_not_scheduled"}

    def _handle_create_complaint(self, *, complaint_text: str) -> dict[str, Any]:
        event = self._record("create_complaint", complaint_text=complaint_text)
        return {"ticket_id": event["id"]}

    def _handle_report_fraud(self, *, fraud_details: str) -> dict[str, Any]:
        event = self._record("report_fraud", fraud_details=fraud_details)
        return {"ticket_id": event["id"]}

    def _handle_transfer_to_operator(self, *, queue: str = "general",
                                     summary: str = "") -> dict[str, Any]:
        event = self._record("transfer_to_operator", queue=queue, summary=summary)
        return {"handoff_id": event["id"], "status": "queued_locally_no_live_operator"}
