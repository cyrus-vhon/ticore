-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260923000001_initial_ticore_schema.sql
-- Purpose: Initial PostgreSQL database foundation for Barangay Timugan's
--          single covered court reservation system.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ----------------------------------------------------------------------------
-- 2. CORE TABLES
-- ----------------------------------------------------------------------------

-- 2.1 User Profiles (1:1 with Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2 AND char_length(full_name) <= 120),
    email TEXT UNIQUE CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    mobile_number TEXT UNIQUE CHECK (mobile_number IS NULL OR mobile_number ~ '^(\+639|09)\d{9}$'),
    role TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('resident', 'official')),
    permissions JSONB NOT NULL DEFAULT '{
        "canManageReservations": false,
        "canManageCourt": false,
        "canCreateOfficial": false,
        "canViewReports": false
    }'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (
        verification_status IN ('unverified', 'pending', 'verified', 'rejected', 'revoked')
    ),
    residency_type TEXT NOT NULL DEFAULT 'timugan_resident' CHECK (
        residency_type IN ('timugan_resident', 'los_banos_resident', 'non_resident')
    ),
    province TEXT NOT NULL DEFAULT 'Laguna' CHECK (char_length(trim(province)) >= 2),
    city_municipality TEXT NOT NULL DEFAULT 'Los Baños' CHECK (char_length(trim(city_municipality)) >= 2),
    barangay TEXT NOT NULL DEFAULT 'Timugan' CHECK (char_length(trim(barangay)) >= 2),
    purok_street TEXT,
    house_lot_details TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- An account cannot hold the 'official' role unless its verification_status is 'verified'
    CONSTRAINT profiles_official_requires_verification CHECK (
        role = 'resident' OR verification_status = 'verified'
    )
);

COMMENT ON TABLE public.profiles IS 'User profiles linked 1:1 to Supabase Auth users. Defaults strictly to the resident role.';

-- 2.2 Court Closures (Single Facility: Timugan Main Covered Court)
CREATE TABLE IF NOT EXISTS public.court_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_name TEXT NOT NULL DEFAULT 'Timugan Main Covered Court' CHECK (
        facility_name = 'Timugan Main Covered Court'
    ),
    closure_date DATE NOT NULL,
    start_time TIME NOT NULL DEFAULT '06:00:00'::time,
    end_time TIME NOT NULL DEFAULT '22:00:00'::time,
    time_slot tsrange GENERATED ALWAYS AS (
        tsrange(closure_date + start_time, closure_date + end_time, '[)')
    ) STORED,
    closure_type TEXT NOT NULL DEFAULT 'maintenance' CHECK (
        closure_type IN ('maintenance', 'barangay_event', 'weather_emergency', 'holiday', 'other')
    ),
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 3 AND char_length(reason) <= 500),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT court_closures_valid_time_order CHECK (end_time > start_time),
    CONSTRAINT court_closures_operating_hours CHECK (
        start_time >= '00:00:00'::time AND end_time <= '23:59:59'::time
    ),
    CONSTRAINT court_closures_no_overlap_excl EXCLUDE USING gist (
        facility_name WITH =,
        time_slot WITH &&
    ) WHERE (is_active = true)
);

COMMENT ON TABLE public.court_closures IS 'Stores dates and times when the single Barangay Timugan Covered Court is closed or unavailable.';

-- 2.3 Reservations (Single Facility: Timugan Main Covered Court)
CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    facility_name TEXT NOT NULL DEFAULT 'Timugan Main Covered Court' CHECK (
        facility_name = 'Timugan Main Covered Court'
    ),
    applicant_name TEXT NOT NULL CHECK (char_length(trim(applicant_name)) >= 2 AND char_length(applicant_name) <= 120),
    applicant_mobile TEXT NOT NULL CHECK (applicant_mobile ~ '^(\+639|09)\d{9}$'),
    residency_type TEXT NOT NULL DEFAULT 'timugan_resident' CHECK (
        residency_type IN ('timugan_resident', 'los_banos_resident', 'non_resident')
    ),
    reservation_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    time_slot tsrange GENERATED ALWAYS AS (
        tsrange(reservation_date + start_time, reservation_date + end_time, '[)')
    ) STORED,
    activity_type TEXT NOT NULL DEFAULT 'Basketball Practice / Friendly Match' CHECK (
        char_length(trim(activity_type)) >= 2 AND char_length(activity_type) <= 120
    ),
    purpose TEXT NOT NULL CHECK (char_length(trim(purpose)) >= 3 AND char_length(purpose) <= 1000),
    expected_attendees INTEGER CHECK (
        expected_attendees IS NULL OR (expected_attendees >= 1 AND expected_attendees <= 500)
    ),
    address_province TEXT NOT NULL DEFAULT 'Laguna' CHECK (char_length(trim(address_province)) >= 2),
    address_city TEXT NOT NULL DEFAULT 'Los Baños' CHECK (char_length(trim(address_city)) >= 2),
    address_barangay TEXT NOT NULL DEFAULT 'Timugan' CHECK (char_length(trim(address_barangay)) >= 2),
    address_purok_street TEXT NOT NULL CHECK (char_length(trim(address_purok_street)) >= 1),
    address_house_details TEXT,
    address TEXT NOT NULL CHECK (char_length(trim(address)) >= 5 AND char_length(address) <= 500),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'rejected', 'cancelled', 'completed', 'no_show', 'rescheduled')
    ),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    status_reason TEXT,
    admin_notes TEXT,
    rescheduled_from_id UUID REFERENCES public.reservations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT reservations_valid_time_order CHECK (end_time > start_time),
    CONSTRAINT reservations_operating_hours CHECK (
        start_time >= '06:00:00'::time AND end_time <= '22:00:00'::time
    ),
    CONSTRAINT reservations_duration_bounds CHECK (
        extract(epoch FROM (end_time - start_time)) >= 3600
        AND extract(epoch FROM (end_time - start_time)) <= 28800
    ),
    -- Database-level atomic double-booking prevention for overlapping approved reservations
    CONSTRAINT reservations_no_double_booking_excl EXCLUDE USING gist (
        facility_name WITH =,
        time_slot WITH &&
    ) WHERE (status = 'approved')
);

COMMENT ON TABLE public.reservations IS 'Reservations for Timugan Main Covered Court with GiST exclusion constraint preventing double booking.';

-- 2.4 Official Verifications (Sensitive Barangay Official Credential Records)
CREATE TABLE IF NOT EXISTS public.official_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2 AND char_length(full_name) <= 120),
    mobile_number TEXT NOT NULL CHECK (mobile_number ~ '^(\+639|09)\d{9}$'),
    position TEXT NOT NULL CHECK (char_length(trim(position)) >= 2 AND char_length(position) <= 100),
    id_type TEXT NOT NULL CHECK (char_length(trim(id_type)) >= 2 AND char_length(id_type) <= 80),
    id_number TEXT NOT NULL CHECK (char_length(trim(id_number)) >= 3 AND char_length(id_number) <= 80),
    id_number_masked TEXT NOT NULL CHECK (char_length(trim(id_number_masked)) >= 3),
    verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        verification_status IN ('pending', 'verified', 'rejected', 'revoked')
    ),
    granted_permissions JSONB NOT NULL DEFAULT '{
        "canManageReservations": true,
        "canManageCourt": false,
        "canCreateOfficial": false,
        "canViewReports": true
    }'::jsonb CHECK (jsonb_typeof(granted_permissions) = 'object'),
    requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    rejection_or_revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Verified records must record who verified them and when
    CONSTRAINT official_verifications_verified_metadata_chk CHECK (
        (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
        OR (verification_status <> 'verified')
    ),
    -- Prevent self-verification
    CONSTRAINT official_verifications_no_self_verify_chk CHECK (
        verified_by IS NULL OR verified_by <> user_id
    )
);

COMMENT ON TABLE public.official_verifications IS 'Protected official verification records. Never exposed to ordinary residents.';

-- 2.5 Audit Logs (Immutable Security & Administrative Trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('resident', 'official', 'system', 'service_role')),
    action TEXT NOT NULL CHECK (char_length(trim(action)) >= 3 AND char_length(action) <= 100),
    entity_type TEXT NOT NULL CHECK (
        entity_type IN ('profile', 'reservation', 'court_closure', 'official_verification', 'system')
    ),
    entity_id UUID,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent storing sensitive credentials/secrets in audit metadata
    CONSTRAINT audit_logs_no_sensitive_keys_chk CHECK (
        NOT (details ?| ARRAY[
            'password',
            'plain_password',
            'otp',
            'otp_code',
            'access_token',
            'refresh_token',
            'service_role_key',
            'secret_key'
        ])
    )
);

COMMENT ON TABLE public.audit_logs IS 'Append-only security and administrative audit logs protected from ordinary users and modification.';

-- ----------------------------------------------------------------------------
-- 3. INDEXES FOR COMMON QUERY PATTERNS
-- ----------------------------------------------------------------------------

-- Profiles indexes
CREATE INDEX IF NOT EXISTS idx_profiles_role_active
    ON public.profiles(role, is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_residency_type
    ON public.profiles(residency_type);

-- Reservations indexes
CREATE INDEX IF NOT EXISTS idx_reservations_user_id_created
    ON public.reservations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reservations_date_status
    ON public.reservations(reservation_date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_status_date
    ON public.reservations(status, reservation_date, start_time);
CREATE INDEX IF NOT EXISTS idx_reservations_time_slot_gist
    ON public.reservations USING gist (time_slot);

-- Court closures indexes
CREATE INDEX IF NOT EXISTS idx_court_closures_date_active
    ON public.court_closures(closure_date, is_active);
CREATE INDEX IF NOT EXISTS idx_court_closures_time_slot_gist
    ON public.court_closures USING gist (time_slot);

-- Official verifications indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_official_verifications_active_user
    ON public.official_verifications(user_id)
    WHERE verification_status IN ('pending', 'verified');
CREATE INDEX IF NOT EXISTS idx_official_verifications_status_created
    ON public.official_verifications(verification_status, created_at DESC);

-- Audit logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
    ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_lookup
    ON public.audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
    ON public.audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user
    ON public.audit_logs(target_user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. AUTHORIZATION & SECURITY HELPER FUNCTIONS
-- ----------------------------------------------------------------------------

-- 4.1 Check if current authenticated user is an active, verified barangay official
CREATE OR REPLACE FUNCTION public.is_active_official()
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
    );
$$;

-- 4.2 Check if current authenticated user is an active, verified official with a specific permission
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
          AND coalesce((permissions ->> required_permission)::boolean, false) = true
    );
$$;

-- 4.3 Internal helper to check if the current DB execution context is privileged (service_role / postgres)
CREATE OR REPLACE FUNCTION public.is_privileged_db_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT current_user IN ('postgres', 'supabase_admin', 'service_role')
        OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
        OR coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.is_active_official() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_official() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_official_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_official_permission(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_privileged_db_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_privileged_db_context() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS FOR INTEGRITY, ROLE PROTECTION, AND AUDIT LOGGING
-- ----------------------------------------------------------------------------

-- 5.1 Generic updated_at maintenance trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_set_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_reservations_set_updated_at
    BEFORE UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_court_closures_set_updated_at
    BEFORE UPDATE ON public.court_closures
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_official_verifications_set_updated_at
    BEFORE UPDATE ON public.official_verifications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5.2 Auto-create resident profile upon Supabase Auth signup (never honours client role metadata)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
    v_mobile TEXT;
BEGIN
    v_full_name := coalesce(
        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        'Barangay Resident'
    );

    v_mobile := nullif(regexp_replace(coalesce(NEW.phone, NEW.raw_user_meta_data ->> 'mobile_number', ''), '\s+', '', 'g'), '');
    IF v_mobile IS NOT NULL AND v_mobile !~ '^(\+639|09)\d{9}$' THEN
        v_mobile := NULL;
    END IF;

    INSERT INTO public.profiles (
        id,
        full_name,
        email,
        mobile_number,
        role,
        permissions,
        verification_status,
        residency_type
    )
    VALUES (
        NEW.id,
        v_full_name,
        NEW.email,
        v_mobile,
        'resident',
        '{
            "canManageReservations": false,
            "canManageCourt": false,
            "canCreateOfficial": false,
            "canViewReports": false
        }'::jsonb,
        'unverified',
        'timugan_resident'
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 5.3 Prevent Role & Permission Self-Escalation on profiles
CREATE OR REPLACE FUNCTION public.enforce_profile_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Unless inserted by service_role/admin or an authorized official with canCreateOfficial,
        -- force default resident role and zero administrative permissions.
        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
            IF NEW.role <> 'resident'
               OR NEW.verification_status <> 'unverified'
               OR NEW.permissions <> '{
                    "canManageReservations": false,
                    "canManageCourt": false,
                    "canCreateOfficial": false,
                    "canViewReports": false
               }'::jsonb THEN
                RAISE EXCEPTION 'Security violation: Users cannot assign themselves an official role or administrative permissions.';
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
            -- Prevent any user (including an official) from self-promoting or editing their own role/permissions
            IF auth.uid() = OLD.id AND NOT public.is_privileged_db_context() THEN
                RAISE EXCEPTION 'Security violation: Self-escalation or self-modification of role, permissions, or verification status is prohibited.';
            END IF;

            IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canCreateOfficial')) THEN
                RAISE EXCEPTION 'Security violation: Only authorized officials with canCreateOfficial permission or the backend service role may modify role, permissions, or verification status.';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_enforce_security
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_security();

-- 5.4 Reservation Validation: Structured Address Sync, Closure Conflict Check, & Update Rules
CREATE OR REPLACE FUNCTION public.validate_reservation_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot tsrange;
BEGIN
    -- Auto-populate formatted address if blank or keep consistent with structured fields
    IF NEW.address IS NULL OR char_length(trim(NEW.address)) < 5 THEN
        NEW.address := concat_ws(
            ', ',
            nullif(trim(NEW.address_house_details), ''),
            nullif(trim(NEW.address_purok_street), ''),
            'Brgy. ' || trim(NEW.address_barangay),
            trim(NEW.address_city),
            trim(NEW.address_province)
        );
    END IF;

    v_slot := tsrange(NEW.reservation_date + NEW.start_time, NEW.reservation_date + NEW.end_time, '[)');

    -- Enforce court closure rules and active reservation conflict checks for active statuses
    IF NEW.status IN ('pending', 'approved') THEN
        -- 1. Reject if overlapping an active court closure
        IF EXISTS (
            SELECT 1
            FROM public.court_closures cc
            WHERE cc.is_active = true
              AND cc.facility_name = NEW.facility_name
              AND cc.time_slot && v_slot
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: Timugan Main Covered Court is closed during the requested date and time slot.';
        END IF;

        -- 2. Reject if overlapping an already approved reservation
        IF EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE r.status = 'approved'
              AND r.facility_name = NEW.facility_name
              AND r.time_slot && v_slot
              AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: The requested time slot overlaps with an already approved reservation.';
        END IF;
    END IF;

    -- Enforce role-based rules on INSERT and UPDATE
    IF TG_OP = 'INSERT' THEN
        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
            IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.admin_notes IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: New resident reservations must be submitted with pending status.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
            -- Ordinary residents can only cancel their own pending/approved reservation
            IF OLD.user_id <> auth.uid() THEN
                RAISE EXCEPTION 'Security violation: Cannot modify another user''s reservation.';
            END IF;

            IF NEW.status <> 'cancelled' OR OLD.status NOT IN ('pending', 'approved') THEN
                RAISE EXCEPTION 'Security violation: Residents may only cancel their own pending or approved reservation.';
            END IF;

            IF NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.reservation_date IS DISTINCT FROM OLD.reservation_date
               OR NEW.start_time IS DISTINCT FROM OLD.start_time
               OR NEW.end_time IS DISTINCT FROM OLD.end_time
               OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
               OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
               OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
                RAISE EXCEPTION 'Security violation: Residents cannot alter schedule or administrative review fields when cancelling.';
            END IF;
        ELSE
            -- When an official approves/rejects/updates status, record reviewer metadata automatically if not set
            IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected', 'completed', 'no_show', 'rescheduled') THEN
                NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
                NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservations_validate_before_write
    BEFORE INSERT OR UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.validate_reservation_before_write();

-- 5.5 Mask Official ID Number & Synchronize Verified Official Status to Profile
CREATE OR REPLACE FUNCTION public.handle_official_verification_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_id TEXT;
BEGIN
    v_clean_id := trim(NEW.id_number);
    IF NEW.id_number_masked IS NULL OR trim(NEW.id_number_masked) = '' THEN
        IF char_length(v_clean_id) > 4 THEN
            NEW.id_number_masked := repeat('*', char_length(v_clean_id) - 4) || right(v_clean_id, 4);
        ELSE
            NEW.id_number_masked := '***';
        END IF;
    END IF;

    IF NEW.verification_status = 'verified' THEN
        NEW.verified_at := coalesce(NEW.verified_at, now());
        NEW.verified_by := coalesce(NEW.verified_by, auth.uid());
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_official_verifications_before_write
    BEFORE INSERT OR UPDATE ON public.official_verifications
    FOR EACH ROW EXECUTE FUNCTION public.handle_official_verification_lifecycle();

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
            permissions = NEW.granted_permissions
        WHERE id = NEW.user_id;
    ELSIF NEW.verification_status IN ('rejected', 'revoked') THEN
        UPDATE public.profiles
        SET role = 'resident',
            verification_status = NEW.verification_status,
            permissions = '{
                "canManageReservations": false,
                "canManageCourt": false,
                "canCreateOfficial": false,
                "canViewReports": false
            }'::jsonb
        WHERE id = NEW.user_id;
    ELSIF NEW.verification_status = 'pending' THEN
        UPDATE public.profiles
        SET verification_status = 'pending'
        WHERE id = NEW.user_id
          AND role = 'resident';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_official_verifications_sync_profile
    AFTER INSERT OR UPDATE ON public.official_verifications
    FOR EACH ROW EXECUTE FUNCTION public.sync_official_verification_to_profile();

-- 5.6 Enforce Immutability on audit_logs (Append-Only)
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Security violation: Audit logs are immutable and cannot be updated or deleted.';
END;
$$;

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_modification();

-- 5.7 Automated Security & Administrative Audit Logging Triggers
CREATE OR REPLACE FUNCTION public.record_audit_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL THEN
        SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
    ELSE
        v_actor_role := 'system';
    END IF;

    -- Profile role / permission / status changes
    IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'UPDATE' THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           OR NEW.permissions IS DISTINCT FROM OLD.permissions
           OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
           OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            INSERT INTO public.audit_logs (
                actor_id,
                actor_role,
                action,
                entity_type,
                entity_id,
                target_user_id,
                details
            ) VALUES (
                v_actor_id,
                v_actor_role,
                CASE
                    WHEN NEW.role IS DISTINCT FROM OLD.role THEN 'profile_role_changed'
                    WHEN NEW.permissions IS DISTINCT FROM OLD.permissions THEN 'profile_permissions_changed'
                    ELSE 'profile_security_status_changed'
                END,
                'profile',
                NEW.id,
                NEW.id,
                jsonb_build_object(
                    'previous_role', OLD.role,
                    'new_role', NEW.role,
                    'previous_verification_status', OLD.verification_status,
                    'new_verification_status', NEW.verification_status,
                    'previous_permissions', OLD.permissions,
                    'new_permissions', NEW.permissions,
                    'is_active', NEW.is_active
                )
            );
        END IF;

    -- Official verification actions
    ELSIF TG_TABLE_NAME = 'official_verifications' THEN
        IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.verification_status IS DISTINCT FROM OLD.verification_status) THEN
            INSERT INTO public.audit_logs (
                actor_id,
                actor_role,
                action,
                entity_type,
                entity_id,
                target_user_id,
                details
            ) VALUES (
                 coalesce(NEW.verified_by, NEW.requested_by, v_actor_id),
                v_actor_role,
                'official_verification_' || NEW.verification_status,
                'official_verification',
                NEW.id,
                NEW.user_id,
                jsonb_build_object(
                    'position', NEW.position,
                    'id_type', NEW.id_type,
                    'id_number_masked', NEW.id_number_masked,
                    'verification_status', NEW.verification_status,
                    'verified_by', NEW.verified_by
                )
            );
        END IF;

    -- Reservation approval / rejection / cancellation / status changes
    ELSIF TG_TABLE_NAME = 'reservations' AND TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            INSERT INTO public.audit_logs (
                actor_id,
                actor_role,
                action,
                entity_type,
                entity_id,
                target_user_id,
                details
            ) VALUES (
                coalesce(v_actor_id, NEW.reviewed_by, NEW.user_id),
                v_actor_role,
                'reservation_' || NEW.status,
                'reservation',
                NEW.id,
                NEW.user_id,
                jsonb_build_object(
                    'previous_status', OLD.status,
                    'new_status', NEW.status,
                    'reservation_date', NEW.reservation_date,
                    'start_time', NEW.start_time,
                    'end_time', NEW.end_time,
                    'status_reason', NEW.status_reason
                )
            );
        END IF;

    -- Court closure administrative changes
    ELSIF TG_TABLE_NAME = 'court_closures' THEN
        INSERT INTO public.audit_logs (
            actor_id,
            actor_role,
            action,
            entity_type,
            entity_id,
            details
        ) VALUES (
            coalesce(v_actor_id, NEW.created_by),
            v_actor_role,
            CASE
                WHEN TG_OP = 'INSERT' THEN 'court_closure_created'
                WHEN NEW.is_active = false AND OLD.is_active = true THEN 'court_closure_deactivated'
                ELSE 'court_closure_updated'
            END,
            'court_closure',
            NEW.id,
            jsonb_build_object(
                'closure_date', NEW.closure_date,
                'start_time', NEW.start_time,
                'end_time', NEW.end_time,
                'closure_type', NEW.closure_type,
                'reason', NEW.reason,
                'is_active', NEW.is_active
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_audit
    AFTER UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.record_audit_events();

CREATE TRIGGER trg_official_verifications_audit
    AFTER INSERT OR UPDATE ON public.official_verifications
    FOR EACH ROW EXECUTE FUNCTION public.record_audit_events();

CREATE TRIGGER trg_reservations_audit
    AFTER UPDATE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.record_audit_events();

CREATE TRIGGER trg_court_closures_audit
    AFTER INSERT OR UPDATE ON public.court_closures
    FOR EACH ROW EXECUTE FUNCTION public.record_audit_events();

-- ----------------------------------------------------------------------------
-- 6. SAFE PUBLIC CALENDAR AVAILABILITY RPC (NO PII EXPOSED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_court_schedule(
    p_start_date DATE DEFAULT CURRENT_DATE,
    p_end_date DATE DEFAULT (CURRENT_DATE + INTERVAL '7 days')::DATE
)
RETURNS TABLE (
    slot_date DATE,
    start_time TIME,
    end_time TIME,
    facility_name TEXT,
    slot_status TEXT,
    public_label TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Active reservations (pending or approved only; exposes zero personal/applicant data)
    SELECT
        r.reservation_date AS slot_date,
        r.start_time,
        r.end_time,
        r.facility_name,
        CASE
            WHEN r.status = 'approved' THEN 'reserved'
            ELSE 'pending'
        END AS slot_status,
        CASE
            WHEN r.status = 'approved' THEN 'Reserved'
            ELSE 'Application Under Review'
        END AS public_label
    FROM public.reservations r
    WHERE r.reservation_date BETWEEN p_start_date AND p_end_date
      AND r.status IN ('pending', 'approved')

    UNION ALL

    -- Active court closures
    SELECT
        cc.closure_date AS slot_date,
        cc.start_time,
        cc.end_time,
        cc.facility_name,
        'closed'::TEXT AS slot_status,
        cc.reason AS public_label
    FROM public.court_closures cc
    WHERE cc.closure_date BETWEEN p_start_date AND p_end_date
      AND cc.is_active = true
    ORDER BY slot_date ASC, start_time ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_court_schedule(DATE, DATE) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.court_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_closures FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_verifications FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- 7.1 RLS Policies for public.profiles
-- ============================================================================

-- Residents can view their own profile; active verified officials can view profiles for verification/reservation administration
CREATE POLICY profiles_select_own_or_official
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR public.is_active_official()
    );

-- Users can insert only their own resident profile with unverified status and zero admin permissions
CREATE POLICY profiles_insert_self_resident_only
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        id = auth.uid()
        AND role = 'resident'
        AND verification_status = 'unverified'
        AND is_active = true
        AND permissions = '{
            "canManageReservations": false,
            "canManageCourt": false,
            "canCreateOfficial": false,
            "canViewReports": false
        }'::jsonb
    );

-- Users can update their own non-protected profile info (trigger strictly blocks role/permission/status changes)
CREATE POLICY profiles_update_self_safe_fields
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid() AND is_active = true)
    WITH CHECK (
        id = auth.uid()
        AND is_active = true
    );

-- Authorized officials with canCreateOfficial can update profile roles/permissions
CREATE POLICY profiles_update_by_authorized_official
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (public.has_official_permission('canCreateOfficial'))
    WITH CHECK (public.has_official_permission('canCreateOfficial'));

-- ============================================================================
-- 7.2 RLS Policies for public.reservations
-- ============================================================================

-- Residents can ONLY view their own reservations (prevents IDOR); active verified officials can view all reservations
CREATE POLICY reservations_select_own_or_official
    ON public.reservations
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR public.is_active_official()
    );

-- Authenticated active users can create pending reservations only for themselves
CREATE POLICY reservations_insert_own_pending
    ON public.reservations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND status = 'pending'
        AND reviewed_by IS NULL
        AND reviewed_at IS NULL
        AND admin_notes IS NULL
    );

-- Residents can update their own reservation only to cancel it
CREATE POLICY reservations_update_cancel_own
    ON public.reservations
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND status IN ('pending', 'approved')
    )
    WITH CHECK (
        user_id = auth.uid()
        AND status = 'cancelled'
    );

-- Authorized officials with canManageReservations can manage and review all reservations
CREATE POLICY reservations_update_official_manage
    ON public.reservations
    FOR UPDATE
    TO authenticated
    USING (public.has_official_permission('canManageReservations'))
    WITH CHECK (public.has_official_permission('canManageReservations'));

-- ============================================================================
-- 7.3 RLS Policies for public.court_closures
-- ============================================================================

-- Public/residents can view active court closures so calendar availability is accurate; officials can view all
CREATE POLICY court_closures_select_active_or_official
    ON public.court_closures
    FOR SELECT
    TO anon, authenticated
    USING (
        is_active = true
        OR public.is_active_official()
    );

-- Only officials with canManageCourt permission can create court closures
CREATE POLICY court_closures_insert_official
    ON public.court_closures
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.has_official_permission('canManageCourt')
        OR public.has_official_permission('canManageCourts')
    );

-- Only officials with canManageCourt permission can update court closures
CREATE POLICY court_closures_update_official
    ON public.court_closures
    FOR UPDATE
    TO authenticated
    USING (
        public.has_official_permission('canManageCourt')
        OR public.has_official_permission('canManageCourts')
    )
    WITH CHECK (
        public.has_official_permission('canManageCourt')
        OR public.has_official_permission('canManageCourts')
    );

-- ============================================================================
-- 7.4 RLS Policies for public.official_verifications
-- ============================================================================

-- Strictly protected: ONLY officials with canCreateOfficial permission can view official verification records.
-- Normal residents have zero access to official_verifications.
CREATE POLICY official_verifications_select_authorized_official
    ON public.official_verifications
    FOR SELECT
    TO authenticated
    USING (public.has_official_permission('canCreateOfficial'));

-- Only officials with canCreateOfficial permission can create verification records
CREATE POLICY official_verifications_insert_authorized_official
    ON public.official_verifications
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_official_permission('canCreateOfficial'));

-- Only officials with canCreateOfficial permission can update/verify records (and cannot self-verify)
CREATE POLICY official_verifications_update_authorized_official
    ON public.official_verifications
    FOR UPDATE
    TO authenticated
    USING (public.has_official_permission('canCreateOfficial'))
    WITH CHECK (
        public.has_official_permission('canCreateOfficial')
        AND (verified_by IS NULL OR verified_by <> user_id)
    );

-- ============================================================================
-- 7.5 RLS Policies for public.audit_logs
-- ============================================================================

-- Protected from ordinary users: only officials with canViewReports or canCreateOfficial can read audit logs
CREATE POLICY audit_logs_select_authorized_official
    ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.has_official_permission('canViewReports')
        OR public.has_official_permission('canCreateOfficial')
    );

-- Active officials can insert audit log entries where actor_id matches their own auth.uid()
CREATE POLICY audit_logs_insert_official
    ON public.audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_active_official()
        AND actor_id = auth.uid()
    );

COMMIT;

