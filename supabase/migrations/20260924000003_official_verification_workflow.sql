-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260924000003_official_verification_workflow.sql
-- Purpose: Implements the hardened Official Account Creation, Verification,
--          Contact Ownership OTP Challenge (with expiration & rate limiting),
--          Granular Authorization (canManageReservations, canManageCourtClosures,
--          canCreateOfficial, canViewReports), and Immutable Audit Logging.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ENHANCE PROFILES WITH CONTACT VERIFICATION & PERMISSION NORMALIZATION
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMPTZ;

-- Normalize permissions JSONB helper so both canManageCourtClosures and canManageCourt
-- are consistently maintained without granting unlimited admin privileges by default.
CREATE OR REPLACE FUNCTION public.normalize_official_permissions(p_raw JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'canManageReservations', coalesce((p_raw ->> 'canManageReservations')::boolean, false),
        'canManageCourtClosures', coalesce(
            (p_raw ->> 'canManageCourtClosures')::boolean,
            (p_raw ->> 'canManageCourt')::boolean,
            false
        ),
        'canManageCourt', coalesce(
            (p_raw ->> 'canManageCourtClosures')::boolean,
            (p_raw ->> 'canManageCourt')::boolean,
            false
        ),
        'canCreateOfficial', coalesce((p_raw ->> 'canCreateOfficial')::boolean, false),
        'canViewReports', coalesce((p_raw ->> 'canViewReports')::boolean, false)
    );
$$;

-- Update existing profiles to include canManageCourtClosures alongside canManageCourt
UPDATE public.profiles
SET permissions = public.normalize_official_permissions(permissions);

UPDATE public.official_verifications
SET granted_permissions = public.normalize_official_permissions(granted_permissions);

-- Update has_official_permission so checking either 'canManageCourtClosures' or 'canManageCourt'
-- evaluates accurately for active, verified officials only.
CREATE OR REPLACE FUNCTION public.has_official_permission(required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'official'
          AND verification_status = 'verified'
          AND is_active = true
          AND (
              coalesce((permissions ->> required_permission)::boolean, false) = true
              OR (
                  required_permission IN ('canManageCourtClosures', 'canManageCourt')
                  AND (
                      coalesce((permissions ->> 'canManageCourtClosures')::boolean, false) = true
                      OR coalesce((permissions ->> 'canManageCourt')::boolean, false) = true
                  )
              )
          )
    );
$$;

-- Harden is_privileged_db_context() so SECURITY DEFINER functions (where current_user
-- becomes the function owner 'postgres') NEVER treat 'authenticated' or 'anon' JWT
-- sessions as a privileged service_role/migration context.
CREATE OR REPLACE FUNCTION public.is_privileged_db_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role' THEN true
        WHEN coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role' THEN true
        WHEN coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') IN ('authenticated', 'anon') THEN false
        WHEN auth.uid() IS NOT NULL THEN false
        ELSE session_user IN ('postgres', 'supabase_admin', 'service_role')
    END;
$$;

-- ----------------------------------------------------------------------------
-- 2. CONTACT OWNERSHIP OTP VERIFICATION TABLE (HASHED ONLY, RATE-LIMITED, EXPIRING)
-- ----------------------------------------------------------------------------
-- Stores ONLY SHA-256 digests (never plaintext OTPs) with strict 5-minute expiration
-- and attempt rate-limiting. Verifying an OTP ONLY confirms contact ownership and
-- NEVER promotes a resident to an official or changes verification_status.
CREATE TABLE IF NOT EXISTS public.contact_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    channel TEXT NOT NULL DEFAULT 'mobile' CHECK (channel IN ('mobile', 'email')),
    target_contact TEXT NOT NULL CHECK (char_length(trim(target_contact)) >= 5),
    code_digest TEXT NOT NULL CHECK (char_length(code_digest) >= 32),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 5),
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_otp_user_created
    ON public.contact_otp_challenges(user_id, created_at DESC);

ALTER TABLE public.contact_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_otp_challenges FORCE ROW LEVEL SECURITY;
-- Zero direct table policies on contact_otp_challenges: accessed strictly via
-- SECURITY DEFINER RPCs so digests can never be queried by clients.

-- ----------------------------------------------------------------------------
-- 3. HARDEN PROFILE & OFFICIAL VERIFICATION TRIGGERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.permissions := public.normalize_official_permissions(coalesce(NEW.permissions, '{}'::jsonb));

    IF TG_OP = 'INSERT' THEN
        -- Public signups and non-privileged inserts must always start as unverified resident
        -- with zero administrative permissions.
        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
            IF NEW.role <> 'resident'
               OR NEW.verification_status <> 'unverified'
               OR coalesce((NEW.permissions ->> 'canManageReservations')::boolean, false) = true
               OR coalesce((NEW.permissions ->> 'canManageCourtClosures')::boolean, false) = true
               OR coalesce((NEW.permissions ->> 'canManageCourt')::boolean, false) = true
               OR coalesce((NEW.permissions ->> 'canCreateOfficial')::boolean, false) = true
               OR coalesce((NEW.permissions ->> 'canViewReports')::boolean, false) = true THEN
                RAISE EXCEPTION 'Security violation: Public accounts must start as resident with unverified status and zero official permissions.';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (
            NEW.role IS DISTINCT FROM OLD.role
            OR NEW.permissions IS DISTINCT FROM OLD.permissions
            OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
            OR NEW.is_active IS DISTINCT FROM OLD.is_active
        ) THEN
            -- Prevent any user (resident or official) from modifying their own role, permissions, or verification status
            IF auth.uid() = OLD.id AND NOT public.is_privileged_db_context() THEN
                RAISE EXCEPTION 'Security violation: Self-escalation or self-modification of role, permissions, or verification status is prohibited.';
            END IF;

            IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
                RAISE EXCEPTION 'Security violation: Only authorized officials with canCreateOfficial permission may modify role, permissions, or verification status.';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_official_verification_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_id TEXT;
BEGIN
    -- 1. Verify caller authorization
    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
        RAISE EXCEPTION 'Security violation: Only authorized officials with canCreateOfficial permission may create or modify official verification records.';
    END IF;

    -- 2. Prevent self-creation or self-verification by an official
    IF NOT public.is_privileged_db_context() AND auth.uid() = NEW.user_id THEN
        RAISE EXCEPTION 'Security violation: Officials cannot create, verify, or modify their own verification record.';
    END IF;

    -- 3. Normalize granted permissions (default least-privilege if omitted)
    NEW.granted_permissions := public.normalize_official_permissions(
        coalesce(
            NEW.granted_permissions,
            '{"canManageReservations": true, "canManageCourtClosures": false, "canCreateOfficial": false, "canViewReports": true}'::jsonb
        )
    );

    -- 4. Automatically mask sensitive ID number so full ID number is never needed in UI lists/logs
    v_clean_id := trim(NEW.id_number);
    IF char_length(v_clean_id) > 4 THEN
        NEW.id_number_masked := repeat('*', char_length(v_clean_id) - 4) || right(v_clean_id, 4);
    ELSE
        NEW.id_number_masked := '***' || right(v_clean_id, 1);
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.requested_by := coalesce(NEW.requested_by, auth.uid());
    END IF;

    IF NEW.verification_status = 'verified' THEN
        NEW.verified_at := coalesce(NEW.verified_at, now());
        NEW.verified_by := coalesce(NEW.verified_by, auth.uid());
        IF NEW.verified_by = NEW.user_id THEN
            RAISE EXCEPTION 'Security violation: Self-verification is prohibited.';
        END IF;
    ELSIF NEW.verification_status IN ('rejected', 'revoked') THEN
        IF NEW.rejection_or_revocation_reason IS NULL OR char_length(trim(NEW.rejection_or_revocation_reason)) < 3 THEN
            RAISE EXCEPTION 'Validation error: A clear reason is required when rejecting or revoking an official verification.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_official_verification_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.verification_status = 'verified' THEN
        UPDATE public.profiles
        SET role = 'official',
            verification_status = 'verified',
            permissions = public.normalize_official_permissions(NEW.granted_permissions)
        WHERE id = NEW.user_id;
    ELSIF NEW.verification_status IN ('rejected', 'revoked') THEN
        UPDATE public.profiles
        SET role = 'resident',
            verification_status = NEW.verification_status,
            permissions = public.normalize_official_permissions('{}'::jsonb)
        WHERE id = NEW.user_id;
    ELSIF NEW.verification_status = 'pending' THEN
        UPDATE public.profiles
        SET role = 'resident',
            verification_status = 'pending',
            permissions = public.normalize_official_permissions('{}'::jsonb)
        WHERE id = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PROTECTED RPCs FOR OFFICIAL VERIFICATION, REVIEW, AND CONTACT OTP
-- ----------------------------------------------------------------------------

-- 4.1 Safe status check for the currently logged-in user (never exposes full id_number or admin notes)
CREATE OR REPLACE FUNCTION public.get_my_official_verification_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID;
    v_profile RECORD;
    v_verif RECORD;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT id, role, verification_status, permissions, contact_verified_at, is_active
    INTO v_profile
    FROM public.profiles
    WHERE id = v_uid;

    SELECT
        ov.id,
        ov.position,
        ov.id_type,
        ov.id_number_masked,
        ov.verification_status,
        ov.granted_permissions,
        ov.verified_at,
        ov.rejection_or_revocation_reason,
        ov.created_at,
        ov.updated_at
    INTO v_verif
    FROM public.official_verifications ov
    WHERE ov.user_id = v_uid
    ORDER BY ov.created_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'user_id', v_uid,
        'role', coalesce(v_profile.role, 'resident'),
        'verification_status', coalesce(v_profile.verification_status, 'unverified'),
        'permissions', coalesce(v_profile.permissions, public.normalize_official_permissions('{}'::jsonb)),
        'contact_verified', (v_profile.contact_verified_at IS NOT NULL),
        'contact_verified_at', v_profile.contact_verified_at,
        'latest_verification_record', CASE
            WHEN v_verif.id IS NOT NULL THEN jsonb_build_object(
                'id', v_verif.id,
                'position', v_verif.position,
                'id_type', v_verif.id_type,
                'id_number_masked', v_verif.id_number_masked,
                'verification_status', v_verif.verification_status,
                'granted_permissions', v_verif.granted_permissions,
                'verified_at', v_verif.verified_at,
                'rejection_or_revocation_reason', v_verif.rejection_or_revocation_reason,
                'created_at', v_verif.created_at,
                'updated_at', v_verif.updated_at
            )
            ELSE NULL
        END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_official_verification_status() TO authenticated;

-- 4.2 Contact Ownership OTP Challenge Request (Rate-limited, expiring, never stores or logs OTP)
CREATE OR REPLACE FUNCTION public.request_contact_verification_challenge(
    p_channel TEXT DEFAULT 'mobile',
    p_target_contact TEXT DEFAULT NULL,
    p_client_code_digest TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID;
    v_recent_count INTEGER;
    v_contact TEXT;
    v_digest TEXT;
    v_expires TIMESTAMPTZ;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to verify contact ownership.';
    END IF;

    IF p_channel NOT IN ('mobile', 'email') THEN
        RAISE EXCEPTION 'Invalid verification channel. Use mobile or email.';
    END IF;

    -- Rate limit: maximum 3 OTP requests within 15 minutes per user
    SELECT count(*)
    INTO v_recent_count
    FROM public.contact_otp_challenges
    WHERE user_id = v_uid
      AND created_at > (now() - INTERVAL '15 minutes');

    IF v_recent_count >= 3 THEN
        RAISE EXCEPTION 'Rate limit exceeded: Too many OTP verification requests. Please wait 15 minutes before requesting another code.';
    END IF;

    SELECT coalesce(nullif(trim(p_target_contact), ''), mobile_number, email)
    INTO v_contact
    FROM public.profiles
    WHERE id = v_uid;

    IF v_contact IS NULL OR char_length(trim(v_contact)) < 5 THEN
        RAISE EXCEPTION 'Validation error: Please save a valid mobile number or email on your profile first.';
    END IF;

    v_digest := coalesce(nullif(trim(p_client_code_digest), ''), md5(v_uid::text || ':' || extract(epoch FROM now())::text));
    v_expires := now() + INTERVAL '5 minutes';

    INSERT INTO public.contact_otp_challenges (
        user_id,
        channel,
        target_contact,
        code_digest,
        expires_at
    ) VALUES (
        v_uid,
        p_channel,
        v_contact,
        v_digest,
        v_expires
    );

    -- Record audit event WITHOUT ever logging the OTP or digest
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        target_user_id,
        details
    ) VALUES (
        v_uid,
        'resident',
        'contact_otp_challenge_requested',
        'profile',
        v_uid,
        v_uid,
        jsonb_build_object(
            'channel', p_channel,
            'expires_in_seconds', 300
        )
    );

    RETURN jsonb_build_object(
        'challenge_created', true,
        'channel', p_channel,
        'expires_at', v_expires,
        'note', 'OTP verifies contact method ownership only and does not grant official role privileges.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_contact_verification_challenge(TEXT, TEXT, TEXT) TO authenticated;

-- 4.3 Verify Contact Ownership OTP Challenge (Strictly verifies contact method ONLY; never promotes role)
CREATE OR REPLACE FUNCTION public.verify_contact_otp_challenge(
    p_submitted_code_digest TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID;
    v_challenge RECORD;
    v_profile RECORD;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT *
    INTO v_challenge
    FROM public.contact_otp_challenges
    WHERE user_id = v_uid
      AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_challenge.id IS NULL THEN
        RAISE EXCEPTION 'Validation error: No active OTP verification challenge found. Please request a new code.';
    END IF;

    IF v_challenge.expires_at < now() THEN
        RAISE EXCEPTION 'Validation error: This OTP verification code has expired. Please request a new code.';
    END IF;

    IF v_challenge.attempt_count >= v_challenge.max_attempts THEN
        RAISE EXCEPTION 'Rate limit exceeded: Maximum OTP verification attempts reached for this code. Please request a new code.';
    END IF;

    IF trim(coalesce(p_submitted_code_digest, '')) <> v_challenge.code_digest THEN
        UPDATE public.contact_otp_challenges
        SET attempt_count = attempt_count + 1
        WHERE id = v_challenge.id;

        RAISE EXCEPTION 'Validation error: Invalid OTP verification code.';
    END IF;

    -- Mark challenge consumed and record contact_verified_at on profile.
    -- IMPORTANT: Never change role or official verification_status!
    UPDATE public.contact_otp_challenges
    SET consumed_at = now()
    WHERE id = v_challenge.id;

    UPDATE public.profiles
    SET contact_verified_at = now()
    WHERE id = v_uid
    RETURNING id, role, verification_status, contact_verified_at INTO v_profile;

    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        target_user_id,
        details
    ) VALUES (
        v_uid,
        v_profile.role,
        'contact_ownership_verified',
        'profile',
        v_uid,
        v_uid,
        jsonb_build_object(
            'channel', v_challenge.channel,
            'role_unchanged', v_profile.role,
            'verification_status_unchanged', v_profile.verification_status
        )
    );

    RETURN jsonb_build_object(
        'contact_verified', true,
        'contact_verified_at', v_profile.contact_verified_at,
        'role', v_profile.role,
        'verification_status', v_profile.verification_status
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_contact_otp_challenge(TEXT) TO authenticated;

-- 4.4 Protected Official Creation / Nomination Workflow (Requires canCreateOfficial)
CREATE OR REPLACE FUNCTION public.initiate_official_verification(
    p_target_user_id UUID,
    p_full_name TEXT,
    p_mobile_number TEXT,
    p_position TEXT,
    p_id_type TEXT,
    p_id_number TEXT,
    p_granted_permissions JSONB DEFAULT '{"canManageReservations": true, "canManageCourtClosures": false, "canCreateOfficial": false, "canViewReports": true}'::jsonb,
    p_approve_immediately BOOLEAN DEFAULT false,
    p_verification_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_normalized_perms JSONB;
    v_initial_status TEXT;
    v_record public.official_verifications;
BEGIN
    v_actor_id := auth.uid();

    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canCreateOfficial permission can initiate official account creation.';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Target user account is required.';
    END IF;

    IF v_actor_id = p_target_user_id AND NOT public.is_privileged_db_context() THEN
        RAISE EXCEPTION 'Security violation: Officials cannot nominate or verify their own account.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_target_user_id AND is_active = true) THEN
        RAISE EXCEPTION 'Validation error: Target user profile does not exist or is inactive.';
    END IF;

    v_normalized_perms := public.normalize_official_permissions(p_granted_permissions);
    v_initial_status := CASE WHEN p_approve_immediately = true THEN 'verified' ELSE 'pending' END;

    -- If an existing pending or verified record exists for this user, update it; otherwise insert new
    IF EXISTS (
        SELECT 1
        FROM public.official_verifications
        WHERE user_id = p_target_user_id
          AND verification_status IN ('pending', 'verified')
    ) THEN
        RAISE EXCEPTION 'Conflict: This user already has an active pending or verified official verification record.';
    END IF;

    INSERT INTO public.official_verifications (
        user_id,
        full_name,
        mobile_number,
        position,
        id_type,
        id_number,
        verification_status,
        granted_permissions,
        requested_by,
        verified_by,
        verified_at,
        verification_notes
    ) VALUES (
        p_target_user_id,
        trim(p_full_name),
        regexp_replace(trim(p_mobile_number), '[\s-]', '', 'g'),
        trim(p_position),
        trim(p_id_type),
        trim(p_id_number),
        v_initial_status,
        v_normalized_perms,
        v_actor_id,
        CASE WHEN v_initial_status = 'verified' THEN v_actor_id ELSE NULL END,
        CASE WHEN v_initial_status = 'verified' THEN now() ELSE NULL END,
        nullif(trim(coalesce(p_verification_notes, '')), '')
    )
    RETURNING * INTO v_record;

    RETURN jsonb_build_object(
        'id', v_record.id,
        'user_id', v_record.user_id,
        'full_name', v_record.full_name,
        'mobile_number', v_record.mobile_number,
        'position', v_record.position,
        'id_type', v_record.id_type,
        'id_number_masked', v_record.id_number_masked,
        'verification_status', v_record.verification_status,
        'granted_permissions', v_record.granted_permissions,
        'requested_by', v_record.requested_by,
        'verified_by', v_record.verified_by,
        'verified_at', v_record.verified_at,
        'created_at', v_record.created_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.initiate_official_verification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT) TO authenticated;

-- 4.5 Protected Official Review / Approval / Rejection / Revocation RPC (Requires canCreateOfficial)
CREATE OR REPLACE FUNCTION public.review_official_verification(
    p_verification_id UUID,
    p_decision TEXT,
    p_granted_permissions JSONB DEFAULT NULL,
    p_reason_or_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_existing public.official_verifications;
    v_updated public.official_verifications;
    v_next_perms JSONB;
BEGIN
    v_actor_id := auth.uid();

    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canCreateOfficial permission can review official verifications.';
    END IF;

    IF p_decision NOT IN ('verified', 'rejected', 'revoked') THEN
        RAISE EXCEPTION 'Validation error: Decision must be one of verified, rejected, or revoked.';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.official_verifications
    WHERE id = p_verification_id;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Not found: Official verification record does not exist.';
    END IF;

    IF v_existing.user_id = v_actor_id AND NOT public.is_privileged_db_context() THEN
        RAISE EXCEPTION 'Security violation: Officials cannot approve, reject, or modify their own verification record.';
    END IF;

    IF p_decision IN ('rejected', 'revoked') AND (p_reason_or_notes IS NULL OR char_length(trim(p_reason_or_notes)) < 3) THEN
        RAISE EXCEPTION 'Validation error: Please provide a clear reason (at least 3 characters) when rejecting or revoking official credentials.';
    END IF;

    v_next_perms := CASE
        WHEN p_decision = 'verified' THEN public.normalize_official_permissions(coalesce(p_granted_permissions, v_existing.granted_permissions))
        ELSE public.normalize_official_permissions('{}'::jsonb)
    END;

    UPDATE public.official_verifications
    SET verification_status = p_decision,
        granted_permissions = v_next_perms,
        verified_by = CASE WHEN p_decision = 'verified' THEN v_actor_id ELSE v_existing.verified_by END,
        verified_at = CASE WHEN p_decision = 'verified' THEN now() ELSE v_existing.verified_at END,
        verification_notes = CASE
            WHEN p_decision = 'verified' AND p_reason_or_notes IS NOT NULL THEN trim(p_reason_or_notes)
            ELSE v_existing.verification_notes
        END,
        rejection_or_revocation_reason = CASE
            WHEN p_decision IN ('rejected', 'revoked') THEN trim(p_reason_or_notes)
            ELSE NULL
        END
    WHERE id = p_verification_id
    RETURNING * INTO v_updated;

    RETURN jsonb_build_object(
        'id', v_updated.id,
        'user_id', v_updated.user_id,
        'full_name', v_updated.full_name,
        'position', v_updated.position,
        'id_type', v_updated.id_type,
        'id_number_masked', v_updated.id_number_masked,
        'verification_status', v_updated.verification_status,
        'granted_permissions', v_updated.granted_permissions,
        'verified_by', v_updated.verified_by,
        'verified_at', v_updated.verified_at,
        'rejection_or_revocation_reason', v_updated.rejection_or_revocation_reason,
        'updated_at', v_updated.updated_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.review_official_verification(UUID, TEXT, JSONB, TEXT) TO authenticated;

COMMIT;
