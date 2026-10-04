"""
TICORE Backend Authentication & Authorization Guard Module
Enforces server-side verification of Supabase Auth JWT sessions and authoritative
roles/permissions stored in public.profiles (never trusting client-supplied role values).
"""

import os
from typing import Any, Callable, Dict, Optional
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, status
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL", "")
SUPABASE_ANON_KEY = (
    os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY", "")
)


def get_Request_Supabase_Client(access_token: str) -> Client:
    """
    Creates a request-scoped Supabase client authenticated with the caller's Bearer JWT
    so all queries execute under PostgreSQL Row Level Security (RLS).
    Never exposes or relies on service-role bypass for standard user queries.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service configuration is incomplete.",
        )
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(access_token)
    return client


def extract_bearer_token(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        )
    return token


async def require_authenticated_user(
    token: str = Depends(extract_bearer_token),
) -> Dict[str, Any]:
    """
    Verifies the user's Supabase JWT and fetches their authoritative profile from public.profiles.
    Rejects expired tokens or deactivated accounts.
    """
    client = get_Request_Supabase_Client(token)
    try:
        user_resp = client.auth.get_user(token)
        auth_user = getattr(user_resp, "user", None)
        if not auth_user or not auth_user.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your session has expired or is invalid. Please sign in again.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unable to verify authentication session. Please sign in again.",
        ) from exc

    profile_resp = (
        client.table("profiles")
        .select(
            "id, full_name, email, mobile_number, role, permissions, verification_status, residency_type, province, city_municipality, barangay, purok_street, house_lot_details, is_active"
        )
        .eq("id", str(auth_user.id))
        .maybe_single()
        .execute()
    )

    profile = getattr(profile_resp, "data", None)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account profile not found.",
        )

    if profile.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is currently inactive.",
        )

    return {
        "user_id": str(auth_user.id),
        "email": auth_user.email,
        "role": profile.get("role", "resident"),
        "verification_status": profile.get("verification_status", "unverified"),
        "permissions": profile.get("permissions") or {},
        "profile": profile,
    }


async def require_resident(
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Ensures the caller is an active authenticated user (resident or verified official).
    """
    if current_user["role"] not in ("resident", "official"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resident account access required.",
        )
    return current_user


async def require_official(
    current_user: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    """
    Ensures the caller is an authenticated, active, and verified Barangay Official.
    Never trusts frontend role claims.
    """
    if (
        current_user.get("role") != "official"
        or current_user.get("verification_status") != "verified"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Verified Barangay Official credentials are required.",
        )
    return current_user


def require_permission(permission_key: str) -> Callable:
    """
    Factory returning a FastAPI dependency that verifies both verified official status
    and a specific administrative capability in public.profiles.permissions.
    """

    async def _permission_dependency(
        official_user: Dict[str, Any] = Depends(require_official),
    ) -> Dict[str, Any]:
        permissions = official_user.get("permissions") or {}
        if permission_key in ("canManageCourtClosures", "canManageCourt"):
            allowed = bool(
                permissions.get("canManageCourtClosures")
                or permissions.get("canManageCourt")
            )
        else:
            allowed = bool(permissions.get(permission_key))
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Forbidden: Missing required administrative permission '{permission_key}'.",
            )
        return official_user

    return _permission_dependency

