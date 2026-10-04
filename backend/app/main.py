"""
TICORE (Timugan Court Reservation System) - FastAPI Backend
Provides server-side authentication verification, role/permission authorization,
and single-court reservation workflow endpoints with IDOR and double-booking protection.
"""

from datetime import date, time
from typing import Any, Dict, List
from uuid import UUID
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .auth import (
    extract_bearer_token,
    get_Request_Supabase_Client,
    require_authenticated_user,
    require_official,
    require_permission,
)

SINGLE_FACILITY_NAME = "Timugan Main Covered Court"

RESIDENT_SAFE_COLUMNS = (
    "id, user_id, facility_name, applicant_name, applicant_mobile, residency_type, "
    "reservation_date, start_time, end_time, activity_type, purpose, expected_attendees, "
    "address_province, address_city, address_barangay, address_purok_street, "
    "address_house_details, address, status, status_reason, reviewed_at, "
    "rescheduled_from_id, created_at, updated_at"
)

app = FastAPI(
    title="TICORE API",
    description="Barangay Timugan Covered Court Reservation System API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class ProfileUpdatePayload(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile_number: str = Field(..., pattern=r"^(\+639|09)\d{9}$")
    residency_type: str = Field(
        default="timugan_resident",
        pattern=r"^(timugan_resident|los_banos_resident|non_resident)$",
    )
    province: str = Field(default="Laguna", min_length=2)
    city_municipality: str = Field(default="Los Baños", min_length=2)
    barangay: str = Field(default="Timugan", min_length=2)
    purok_street: str | None = None
    house_lot_details: str | None = None


class ReservationCreatePayload(BaseModel):
    applicant_name: str = Field(..., min_length=2, max_length=120)
    applicant_mobile: str = Field(..., pattern=r"^(\+639|09)\d{9}$")
    residency_type: str = Field(
        default="timugan_resident",
        pattern=r"^(timugan_resident|los_banos_resident|non_resident)$",
    )
    reservation_date: date
    start_time: time
    end_time: time
    activity_type: str = Field(..., min_length=2, max_length=120)
    purpose: str = Field(..., min_length=5, max_length=1000)
    expected_attendees: int | None = Field(default=None, ge=1, le=500)
    address_province: str = Field(default="Laguna", min_length=2)
    address_city: str = Field(default="Los Baños", min_length=2)
    address_barangay: str = Field(default="Timugan", min_length=2)
    address_purok_street: str = Field(..., min_length=1, max_length=200)
    address_house_details: str | None = Field(default=None, max_length=200)

    @field_validator("reservation_date")
    @classmethod
    def validate_not_past(cls, v: date) -> date:
        if v < date.today():
            raise ValueError("Reservation date cannot be in the past.")
        return v


class ReservationCancelPayload(BaseModel):
    reason: str = Field(default="Cancelled by applicant", max_length=500)


@app.get("/api/health")
async def health_check() -> Dict[str, str]:
    return {"status": "ok", "facility": SINGLE_FACILITY_NAME}


@app.get("/api/auth/me")
async def get_current_profile(
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """Returns the caller's authoritative database profile and verified role."""
    return {
        "authenticated": True,
        "role": current_user["role"],
        "verification_status": current_user["verification_status"],
        "permissions": current_user["permissions"],
        "profile": current_user["profile"],
    }


@app.patch("/api/auth/profile")
async def update_current_profile(
    payload: ProfileUpdatePayload,
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Updates the authenticated user's own allowed profile fields.
    Never accepts role, permissions, or verification_status modifications.
    """
    client = get_Request_Supabase_Client(token)
    safe_update = payload.model_dump()

    response = (
        client.table("profiles")
        .update(safe_update)
        .eq("id", current_user["user_id"])
        .select(
            "id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active"
        )
        .single()
        .execute()
    )

    return {"status": "updated", "profile": getattr(response, "data", None)}


@app.get("/api/reservations/availability")
async def check_availability(
    reservation_date: date = Query(...),
    start_time: time = Query(...),
    end_time: time = Query(...),
    token: str = Depends(extract_bearer_token),
) -> Dict[str, Any]:
    """Checks availability of Timugan Main Covered Court without exposing PII."""
    if reservation_date < date.today():
        return {
            "available": False,
            "conflict_type": "past_date",
            "message": "Reservations cannot be scheduled for past dates.",
        }
    if end_time <= start_time:
        return {
            "available": False,
            "conflict_type": "invalid_time_range",
            "message": "End time must be later than start time.",
        }

    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc(
        "check_court_slot_availability",
        {
            "p_date": reservation_date.isoformat(),
            "p_start_time": start_time.strftime("%H:%M:%S"),
            "p_end_time": end_time.strftime("%H:%M:%S"),
        },
    ).execute()

    return getattr(rpc_res, "data", {"available": False})


@app.post("/api/reservations", status_code=status.HTTP_201_CREATED)
async def create_reservation(
    payload: ReservationCreatePayload,
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Submits a resident court reservation.
    Enforces start_time < end_time, operating hours, non-past date,
    status = 'pending', and relies on PostgreSQL RLS + GiST exclusion constraint
    to prevent double-booking race conditions.
    """
    if payload.end_time <= payload.start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End time must be later than start time.",
        )

    if payload.start_time < time(6, 0) or payload.end_time > time(22, 0):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservations must be within operating hours (06:00 AM to 10:00 PM).",
        )

    formatted_address = ", ".join(
        filter(
            None,
            [
                (payload.address_house_details or "").strip(),
                payload.address_purok_street.strip(),
                f"Brgy. {payload.address_barangay.strip()}",
                payload.address_city.strip(),
                payload.address_province.strip(),
            ],
        )
    )

    client = get_Request_Supabase_Client(token)
    insert_row = {
        "user_id": current_user["user_id"],
        "facility_name": SINGLE_FACILITY_NAME,
        "applicant_name": payload.applicant_name.strip(),
        "applicant_mobile": payload.applicant_mobile.strip(),
        "residency_type": payload.residency_type,
        "reservation_date": payload.reservation_date.isoformat(),
        "start_time": payload.start_time.strftime("%H:%M:%S"),
        "end_time": payload.end_time.strftime("%H:%M:%S"),
        "activity_type": payload.activity_type.strip(),
        "purpose": payload.purpose.strip(),
        "expected_attendees": payload.expected_attendees,
        "address_province": payload.address_province.strip(),
        "address_city": payload.address_city.strip(),
        "address_barangay": payload.address_barangay.strip(),
        "address_purok_street": payload.address_purok_street.strip(),
        "address_house_details": (payload.address_house_details or "").strip() or None,
        "address": formatted_address,
        "status": "pending",
    }

    try:
        response = (
            client.table("reservations")
            .insert(insert_row)
            .select(RESIDENT_SAFE_COLUMNS)
            .single()
            .execute()
        )
        return {"status": "created", "reservation": getattr(response, "data", None)}
    except Exception as exc:
        err_str = str(exc).lower()
        if "conflict" in err_str or "23p01" in err_str or "double_booking" in err_str:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This time slot is no longer available due to an overlapping reservation or court closure.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to complete the reservation request. Please verify your schedule and details.",
        ) from exc


@app.get("/api/reservations/my")
async def list_my_reservations(
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, List[Dict[str, Any]]]:
    """Returns only the authenticated resident's own reservations."""
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("reservations")
        .select(RESIDENT_SAFE_COLUMNS)
        .eq("user_id", current_user["user_id"])
        .order("reservation_date", desc=True)
        .order("start_time", desc=True)
        .execute()
    )
    return {"reservations": getattr(response, "data", []) or []}


@app.get("/api/reservations/{reservation_id}")
async def get_my_reservation_detail(
    reservation_id: UUID,
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Returns details of a single reservation with strict IDOR ownership verification.
    """
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("reservations")
        .select(RESIDENT_SAFE_COLUMNS)
        .eq("id", str(reservation_id))
        .eq("user_id", current_user["user_id"])
        .maybe_single()
        .execute()
    )
    data = getattr(response, "data", None)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reservation not found or you do not have permission to view it.",
        )
    return {"reservation": data}


@app.post("/api/reservations/{reservation_id}/cancel")
async def cancel_my_reservation(
    reservation_id: UUID,
    payload: ReservationCancelPayload,
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Allows a resident to cancel their own pending or approved non-past reservation.
    Never allows setting status to approved or rejected.
    """
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("reservations")
        .update(
            {
                "status": "cancelled",
                "status_reason": payload.reason.strip() or "Cancelled by applicant",
            }
        )
        .eq("id", str(reservation_id))
        .eq("user_id", current_user["user_id"])
        .in_("status", ["pending", "approved"])
        .select(RESIDENT_SAFE_COLUMNS)
        .maybe_single()
        .execute()
    )
    data = getattr(response, "data", None)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservation cannot be cancelled or you are not authorized to modify it.",
        )
    return {"status": "cancelled", "reservation": data}


class OfficialNominationPayload(BaseModel):
    target_user_id: UUID
    full_name: str = Field(..., min_length=2, max_length=120)
    mobile_number: str = Field(..., pattern=r"^(\+639|09)\d{9}$")
    position: str = Field(..., min_length=2, max_length=100)
    id_type: str = Field(..., min_length=2, max_length=80)
    id_number: str = Field(..., min_length=3, max_length=80)
    granted_permissions: Dict[str, bool] = Field(
        default_factory=lambda: {
            "canManageReservations": True,
            "canManageCourtClosures": False,
            "canManageCourt": False,
            "canCreateOfficial": False,
            "canViewReports": True,
        }
    )
    approve_immediately: bool = False
    verification_notes: str | None = Field(default=None, max_length=500)


class OfficialReviewPayload(BaseModel):
    decision: str = Field(..., pattern=r"^(verified|rejected|revoked)$")
    granted_permissions: Dict[str, bool] | None = None
    reason_or_notes: str | None = Field(default=None, max_length=500)


@app.get("/api/auth/verification-status")
async def get_my_verification_status(
    token: str = Depends(extract_bearer_token),
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Returns the authenticated user's own verification status and masked nomination record.
    Never exposes raw official ID numbers or internal notes.
    """
    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc("get_my_official_verification_status").execute()
    return {
        "user_id": current_user["user_id"],
        "verification": getattr(rpc_res, "data", None),
    }


@app.get("/api/official/verify-access")
async def verify_official_portal_access(
    official_user: Dict[str, Any] = Depends(require_official),
) -> Dict[str, Any]:
    """Protected endpoint accessible only to verified Barangay Timugan officials."""
    return {
        "authorized": True,
        "role": official_user["role"],
        "verification_status": official_user["verification_status"],
        "permissions": official_user["permissions"],
    }


@app.get("/api/official/verifications")
async def list_official_verifications(
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canCreateOfficial")),
) -> Dict[str, Any]:
    """
    Protected endpoint returning official verification records (with masked ID numbers).
    Accessible strictly to verified officials holding 'canCreateOfficial'.
    """
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("official_verifications")
        .select(
            "id, user_id, full_name, mobile_number, position, id_type, id_number_masked, "
            "verification_status, granted_permissions, requested_by, verified_by, verified_at, "
            "verification_notes, rejection_or_revocation_reason, created_at, updated_at"
        )
        .order("created_at", desc=True)
        .execute()
    )
    return {
        "actor_id": official_user["user_id"],
        "verifications": getattr(response, "data", []) or [],
    }


@app.post("/api/official/verifications", status_code=status.HTTP_201_CREATED)
async def create_official_verification_record(
    payload: OfficialNominationPayload,
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canCreateOfficial")),
) -> Dict[str, Any]:
    """
    Protected endpoint allowing an authorized official with 'canCreateOfficial'
    to nominate/create another official account record. Blocks self-nomination.
    """
    if str(payload.target_user_id) == official_user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Officials cannot nominate or verify their own account.",
        )

    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc(
        "initiate_official_verification",
        {
            "p_target_user_id": str(payload.target_user_id),
            "p_full_name": payload.full_name.strip(),
            "p_mobile_number": payload.mobile_number.strip(),
            "p_position": payload.position.strip(),
            "p_id_type": payload.id_type.strip(),
            "p_id_number": payload.id_number.strip(),
            "p_granted_permissions": payload.granted_permissions,
            "p_approve_immediately": payload.approve_immediately,
            "p_verification_notes": payload.verification_notes,
        },
    ).execute()
    return {"status": "created", "verification": getattr(rpc_res, "data", None)}


@app.post("/api/official/verifications/{verification_id}/review")
async def review_official_verification_record(
    verification_id: UUID,
    payload: OfficialReviewPayload,
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canCreateOfficial")),
) -> Dict[str, Any]:
    """
    Approves ('verified'), rejects ('rejected'), or revokes ('revoked') an official verification record.
    Accessible strictly to verified officials with 'canCreateOfficial'.
    """
    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc(
        "review_official_verification",
        {
            "p_verification_id": str(verification_id),
            "p_decision": payload.decision,
            "p_granted_permissions": payload.granted_permissions,
            "p_reason_or_notes": payload.reason_or_notes,
        },
    ).execute()
    return {
        "status": payload.decision,
        "actor_id": official_user["user_id"],
        "verification": getattr(rpc_res, "data", None),
    }


class OfficialReservationActionPayload(BaseModel):
    action: str = Field(..., pattern=r"^(approve|reject|cancel|completed|no_show|reschedule)$")
    status_reason: str | None = Field(default=None, max_length=500)
    admin_notes: str | None = Field(default=None, max_length=1000)
    new_date: date | None = None
    new_start_time: time | None = None
    new_end_time: time | None = None


class OfficialCourtClosurePayload(BaseModel):
    closure_date: date
    start_time: time
    end_time: time
    closure_type: str = Field(
        default="maintenance",
        pattern=r"^(maintenance|barangay_event|repair|weather_emergency|holiday|other)$",
    )
    reason: str = Field(..., min_length=3, max_length=500)


@app.get("/api/official/reservations")
async def list_official_reservations(
    status_filter: str | None = Query(default=None),
    reservation_date: date | None = Query(default=None),
    search: str | None = Query(default=None),
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_official),
) -> Dict[str, Any]:
    """
    Returns court reservations for the Official Dashboard, including internal admin_notes.
    Protected by require_official and Supabase RLS (reservations_select_own_or_official).
    """
    client = get_Request_Supabase_Client(token)
    query = client.table("reservations").select("*").order("reservation_date", desc=True).order("start_time", desc=False)

    if status_filter and status_filter != "all":
        query = query.eq("status", status_filter)
    if reservation_date:
        query = query.eq("reservation_date", reservation_date.isoformat())

    response = query.execute()
    rows = getattr(response, "data", []) or []

    if search and search.strip():
        q = search.strip().lower()
        rows = [
            r
            for r in rows
            if q
            in " ".join(
                str(r.get(k) or "")
                for k in ("id", "applicant_name", "applicant_mobile", "purpose", "activity_type", "address")
            ).lower()
        ]

    return {
        "actor_id": official_user["user_id"],
        "count": len(rows),
        "reservations": rows,
    }


@app.post("/api/official/reservations/{reservation_id}/action")
async def process_official_reservation_action(
    reservation_id: UUID,
    payload: OfficialReservationActionPayload,
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canManageReservations")),
) -> Dict[str, Any]:
    """
    Executes an official action (approve, reject, cancel, completed, no_show, reschedule)
    on a court reservation and records an immutable audit trail entry.
    """
    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc(
        "official_process_reservation",
        {
            "p_reservation_id": str(reservation_id),
            "p_action": payload.action,
            "p_status_reason": payload.status_reason,
            "p_admin_notes": payload.admin_notes,
            "p_new_date": payload.new_date.isoformat() if payload.new_date else None,
            "p_new_start_time": payload.new_start_time.strftime("%H:%M:%S") if payload.new_start_time else None,
            "p_new_end_time": payload.new_end_time.strftime("%H:%M:%S") if payload.new_end_time else None,
        },
    ).execute()
    return {
        "status": "processed",
        "action": payload.action,
        "actor_id": official_user["user_id"],
        "reservation": getattr(rpc_res, "data", None),
    }


@app.get("/api/official/closures")
async def list_official_court_closures(
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_official),
) -> Dict[str, Any]:
    """Returns all court closures for Timugan Main Covered Court."""
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("court_closures")
        .select("*")
        .order("closure_date", desc=True)
        .order("start_time", desc=False)
        .execute()
    )
    return {
        "actor_id": official_user["user_id"],
        "closures": getattr(response, "data", []) or [],
    }


@app.post("/api/official/closures", status_code=status.HTTP_201_CREATED)
async def create_official_court_closure(
    payload: OfficialCourtClosurePayload,
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canManageCourtClosures")),
) -> Dict[str, Any]:
    """Schedules a court closure for Timugan Main Covered Court."""
    client = get_Request_Supabase_Client(token)
    rpc_res = client.rpc(
        "official_create_court_closure",
        {
            "p_closure_date": payload.closure_date.isoformat(),
            "p_start_time": payload.start_time.strftime("%H:%M:%S"),
            "p_end_time": payload.end_time.strftime("%H:%M:%S"),
            "p_closure_type": payload.closure_type,
            "p_reason": payload.reason.strip(),
        },
    ).execute()
    return {
        "status": "created",
        "actor_id": official_user["user_id"],
        "closure": getattr(rpc_res, "data", None),
    }


@app.patch("/api/official/closures/{closure_id}/deactivate")
async def deactivate_official_court_closure(
    closure_id: UUID,
    token: str = Depends(extract_bearer_token),
    official_user: Dict[str, Any] = Depends(require_permission("canManageCourtClosures")),
) -> Dict[str, Any]:
    """Deactivates an active court closure and re-opens the time slot."""
    client = get_Request_Supabase_Client(token)
    response = (
        client.table("court_closures")
        .update({"is_active": False})
        .eq("id", str(closure_id))
        .select("*")
        .single()
        .execute()
    )
    return {
        "status": "deactivated",
        "actor_id": official_user["user_id"],
        "closure": getattr(response, "data", None),
    }


@app.get("/api/official/audit-check")
async def check_official_audit_permission(
    official_user: Dict[str, Any] = Depends(require_permission("canViewReports")),
) -> Dict[str, Any]:
    """Protected endpoint requiring the granular 'canViewReports' permission."""
    return {
        "authorized": True,
        "permission": "canViewReports",
        "actor_id": official_user["user_id"],
    }

