-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260924000004_official_dashboard_workflow.sql
-- Purpose: Supports the Official Dashboard workflow for Barangay Timugan's
--          single court (Timugan Main Covered Court), including:
--          1. Expanded court_closures types ('maintenance', 'barangay_event',
--             'repair', 'weather_emergency', 'holiday', 'other')
--          2. Atomic official reservation processing RPC (approve, reject,
--             cancel, completed, no_show, reschedule) with conflict checks
--          3. Official court closure creation & deactivation RPC
--          4. Enhanced audit logging for rescheduling and official actions
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXPAND COURT CLOSURES TYPE CHECK CONSTRAINT TO INCLUDE 'repair'
-- ----------------------------------------------------------------------------
ALTER TABLE public.court_closures
    DROP CONSTRAINT IF EXISTS court_closures_closure_type_check;

ALTER TABLE public.court_closures
    ADD CONSTRAINT court_closures_closure_type_check CHECK (
        closure_type IN (
            'maintenance',
            'barangay_event',
            'repair',
            'weather_emergency',
            'holiday',
            'other'
        )
    );

-- ----------------------------------------------------------------------------
-- 2. ENHANCE AUDIT LOGGING TRIGGER FOR RESCHEDULING & OFFICIAL NOTES
-- ----------------------------------------------------------------------------
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

    -- Reservation approval / rejection / cancellation / completion / no_show / rescheduling
    ELSIF TG_TABLE_NAME = 'reservations' AND TG_OP = 'UPDATE' THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.reservation_date IS DISTINCT FROM OLD.reservation_date
           OR NEW.start_time IS DISTINCT FROM OLD.start_time
           OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
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
                CASE
                    WHEN (
                        NEW.reservation_date IS DISTINCT FROM OLD.reservation_date
                        OR NEW.start_time IS DISTINCT FROM OLD.start_time
                        OR NEW.end_time IS DISTINCT FROM OLD.end_time
                    ) AND NEW.status <> 'rescheduled' THEN 'reservation_rescheduled'
                    ELSE 'reservation_' || NEW.status
                END,
                'reservation',
                NEW.id,
                NEW.user_id,
                jsonb_build_object(
                    'previous_status', OLD.status,
                    'new_status', NEW.status,
                    'previous_date', OLD.reservation_date,
                    'reservation_date', NEW.reservation_date,
                    'previous_start_time', OLD.start_time,
                    'start_time', NEW.start_time,
                    'previous_end_time', OLD.end_time,
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

-- ----------------------------------------------------------------------------
-- 3. OFFICIAL RESERVATION ACTION RPC (Approve, Reject, Cancel, Complete, No-Show, Reschedule)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.official_process_reservation(
    p_reservation_id UUID,
    p_action TEXT,
    p_status_reason TEXT DEFAULT NULL,
    p_admin_notes TEXT DEFAULT NULL,
    p_new_date DATE DEFAULT NULL,
    p_new_start_time TIME DEFAULT NULL,
    p_new_end_time TIME DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_existing public.reservations;
    v_updated public.reservations;
    v_target_status TEXT;
    v_next_date DATE;
    v_next_start TIME;
    v_next_end TIME;
BEGIN
    v_actor_id := auth.uid();

    -- 1. Enforce verified official + canManageReservations permission
    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canManageReservations permission may process reservations.';
    END IF;

    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Reservation ID is required.';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.reservations
    WHERE id = p_reservation_id;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Not found: Reservation record does not exist.';
    END IF;

    IF p_action NOT IN ('approve', 'reject', 'cancel', 'completed', 'no_show', 'reschedule') THEN
        RAISE EXCEPTION 'Validation error: Invalid reservation action (%).', p_action;
    END IF;

    -- 2. Validate state transitions and required reasons
    IF p_action = 'approve' THEN
        IF v_existing.status NOT IN ('pending', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only pending or rescheduled reservations can be approved (current status: %).', v_existing.status;
        END IF;
        v_target_status := 'approved';

    ELSIF p_action = 'reject' THEN
        IF v_existing.status <> 'pending' THEN
            RAISE EXCEPTION 'Validation error: Only pending reservations can be rejected (current status: %).', v_existing.status;
        END IF;
        IF p_status_reason IS NULL OR char_length(trim(p_status_reason)) < 3 THEN
            RAISE EXCEPTION 'Validation error: A clear rejection reason (at least 3 characters) is required.';
        END IF;
        v_target_status := 'rejected';

    ELSIF p_action = 'cancel' THEN
        IF v_existing.status NOT IN ('pending', 'approved', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only pending, approved, or rescheduled reservations can be cancelled.';
        END IF;
        IF p_status_reason IS NULL OR char_length(trim(p_status_reason)) < 3 THEN
            RAISE EXCEPTION 'Validation error: A clear cancellation reason (at least 3 characters) is required.';
        END IF;
        v_target_status := 'cancelled';

    ELSIF p_action = 'completed' THEN
        IF v_existing.status NOT IN ('approved', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only approved reservations can be marked as completed.';
        END IF;
        v_target_status := 'completed';

    ELSIF p_action = 'no_show' THEN
        IF v_existing.status NOT IN ('approved', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only approved reservations can be marked as no-show.';
        END IF;
        v_target_status := 'no_show';

    ELSIF p_action = 'reschedule' THEN
        IF v_existing.status NOT IN ('pending', 'approved', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only pending or approved reservations can be rescheduled.';
        END IF;
        IF p_new_date IS NULL OR p_new_start_time IS NULL OR p_new_end_time IS NULL THEN
            RAISE EXCEPTION 'Validation error: New reservation date, start time, and end time are required when rescheduling.';
        END IF;
        IF p_status_reason IS NULL OR char_length(trim(p_status_reason)) < 3 THEN
            RAISE EXCEPTION 'Validation error: Please provide a reason for rescheduling.';
        END IF;
        v_target_status := 'rescheduled';
    END IF;

    v_next_date := coalesce(p_new_date, v_existing.reservation_date);
    v_next_start := coalesce(p_new_start_time, v_existing.start_time);
    v_next_end := coalesce(p_new_end_time, v_existing.end_time);

    -- If rescheduled, also ensure the rescheduled slot has no court closure or active booking conflict
    IF p_action = 'reschedule' THEN
        IF v_next_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Validation error: Cannot reschedule a reservation to a past date.';
        END IF;
        IF v_next_end <= v_next_start THEN
            RAISE EXCEPTION 'Validation error: End time must be later than start time.';
        END IF;
        IF v_next_start < '06:00:00'::time OR v_next_end > '22:00:00'::time THEN
            RAISE EXCEPTION 'Validation error: Rescheduled time must be within court operating hours (06:00 AM to 10:00 PM).';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.court_closures cc
            WHERE cc.is_active = true
              AND cc.facility_name = v_existing.facility_name
              AND cc.time_slot && tsrange(v_next_date + v_next_start, v_next_date + v_next_end, '[)')
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: Timugan Main Covered Court is closed during the requested rescheduled time slot.';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE r.id <> v_existing.id
              AND r.status IN ('pending', 'approved', 'rescheduled')
              AND r.facility_name = v_existing.facility_name
              AND r.time_slot && tsrange(v_next_date + v_next_start, v_next_date + v_next_end, '[)')
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: The requested rescheduled slot overlaps with another active reservation.';
        END IF;
    END IF;

    UPDATE public.reservations
    SET status = v_target_status,
        reservation_date = v_next_date,
        start_time = v_next_start,
        end_time = v_next_end,
        status_reason = coalesce(nullif(trim(coalesce(p_status_reason, '')), ''), status_reason),
        admin_notes = CASE
            WHEN p_admin_notes IS NOT NULL THEN nullif(trim(p_admin_notes), '')
            ELSE admin_notes
        END,
        reviewed_by = coalesce(v_actor_id, reviewed_by),
        reviewed_at = now()
    WHERE id = p_reservation_id
    RETURNING * INTO v_updated;

    RETURN to_jsonb(v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. OFFICIAL COURT CLOSURE CREATION & MANAGEMENT RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.official_create_court_closure(
    p_closure_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_closure_type TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_slot tsrange;
    v_conflict_count INTEGER;
    v_closure public.court_closures;
BEGIN
    v_actor_id := auth.uid();

    IF NOT (
        public.is_privileged_db_context()
        OR public.has_official_permission('canManageCourtClosures')
        OR public.has_official_permission('canManageCourt')
    ) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canManageCourtClosures permission may create court closures.';
    END IF;

    IF p_closure_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
        RAISE EXCEPTION 'Validation error: Closure date, start time, and end time are required.';
    END IF;

    IF p_end_time <= p_start_time THEN
        RAISE EXCEPTION 'Validation error: Closure end time must be later than start time.';
    END IF;

    IF p_closure_type NOT IN ('maintenance', 'barangay_event', 'repair', 'weather_emergency', 'holiday', 'other') THEN
        RAISE EXCEPTION 'Validation error: Invalid court closure type (%).', p_closure_type;
    END IF;

    IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Validation error: Please provide a clear reason for the court closure (at least 3 characters).';
    END IF;

    v_slot := tsrange(p_closure_date + p_start_time, p_closure_date + p_end_time, '[)');

    -- Check overlapping active reservations so the official is alerted if an approved booking already exists
    SELECT count(*)
    INTO v_conflict_count
    FROM public.reservations r
    WHERE r.facility_name = 'Timugan Main Covered Court'
      AND r.status IN ('approved', 'rescheduled')
      AND r.time_slot && v_slot;

    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Schedule conflict: Cannot close the court during a slot that already has an approved reservation. Please cancel or reschedule the existing reservation first.';
    END IF;

    INSERT INTO public.court_closures (
        facility_name,
        closure_date,
        start_time,
        end_time,
        closure_type,
        reason,
        is_active,
        created_by
    ) VALUES (
        'Timugan Main Covered Court',
        p_closure_date,
        p_start_time,
        p_end_time,
        p_closure_type,
        trim(p_reason),
        true,
        v_actor_id
    )
    RETURNING * INTO v_closure;

    RETURN to_jsonb(v_closure);
END;
$$;

GRANT EXECUTE ON FUNCTION public.official_create_court_closure(DATE, TIME, TIME, TEXT, TEXT) TO authenticated;

COMMIT;

