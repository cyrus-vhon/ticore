-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260927000001_reservation_cash_payment_status.sql
-- Purpose: Implements separate Cash-Only Payment Status for court reservations.
--          - Separate payment status: pending_payment, paid
--          - Cash only (physical payment at Barangay Office)
--          - Tracks payment_due_at, paid_at, paid_confirmed_by
--          - Server-side/database-side auto-cancellation when payment deadline expires
--          - Strict authorization: only authorized officials can confirm payment
--          - Residents cannot alter payment fields or self-confirm payment
--          - Immutable audit logging for payment confirmation & expiration
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ADD PAYMENT COLUMNS TO public.reservations
-- ----------------------------------------------------------------------------
ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (payment_status IN ('pending_payment', 'paid')),
    ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
        CHECK (payment_method = 'cash'),
    ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_confirmed_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_reservations_payment_status
    ON public.reservations (payment_status, payment_due_at);

-- Backfill default payment deadlines for existing active reservations if null
UPDATE public.reservations
SET payment_status = 'pending_payment',
    payment_method = 'cash',
    payment_due_at = LEAST(now() + INTERVAL '48 hours', (reservation_date + start_time)::timestamptz)
WHERE payment_due_at IS NULL AND status IN ('pending', 'approved', 'rescheduled');

-- ----------------------------------------------------------------------------
-- 2. SERVER-SIDE AUTOMATIC CANCELLATION OF EXPIRED UNPAID RESERVATIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_expired_unpaid_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    WITH expired AS (
        UPDATE public.reservations
        SET status = 'cancelled',
            status_reason = 'Payment deadline expired without cash payment confirmation.',
            reviewed_at = now()
        WHERE payment_status = 'pending_payment'
          AND status IN ('pending', 'approved', 'rescheduled')
          AND payment_due_at IS NOT NULL
          AND payment_due_at < now()
          AND (
              -- 1. Explicit payment deadline has arrived
              (payment_due_at IS NOT NULL AND payment_due_at <= now())
              OR
              -- 2. Reservation start time has arrived while still unpaid
              (((reservation_date + start_time) AT TIME ZONE 'Asia/Manila') <= now())
          )
        RETURNING id
    )
    SELECT count(*) INTO v_count FROM expired;

    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_expired_unpaid_reservations() TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3. OFFICIAL CONFIRM CASH PAYMENT RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.official_confirm_cash_payment(
    p_reservation_id UUID,
    p_admin_notes TEXT DEFAULT NULL
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
BEGIN
    v_actor_id := auth.uid();

    -- Enforce verified official + canManageReservations permission
    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canManageReservations permission may confirm cash payments.';
    END IF;

    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Reservation ID is required.';
    END IF;

    -- Sweep any expired reservations first
    PERFORM public.cancel_expired_unpaid_reservations();

    SELECT *
    INTO v_existing
    FROM public.reservations
    WHERE id = p_reservation_id;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'Not found: Reservation record does not exist.';
    END IF;

    IF v_existing.payment_status = 'paid' THEN
        RAISE EXCEPTION 'Validation error: This reservation has already been marked as paid.';
    END IF;

    IF v_existing.status IN ('cancelled', 'rejected') THEN
        RAISE EXCEPTION 'Validation error: Cannot confirm payment for a % reservation.', v_existing.status;
    END IF;

    IF (v_existing.payment_due_at IS NOT NULL AND v_existing.payment_due_at <= now())
       OR (((v_existing.reservation_date + v_existing.start_time) AT TIME ZONE 'Asia/Manila') <= now()) THEN
        RAISE EXCEPTION 'Validation error: Payment deadline has expired. This reservation cannot be paid.';
    END IF;

    UPDATE public.reservations
    SET payment_status = 'paid',
        payment_method = 'cash',
        paid_at = now(),
        paid_confirmed_by = v_actor_id,
        admin_notes = CASE
            WHEN p_admin_notes IS NOT NULL AND length(trim(p_admin_notes)) > 0 THEN
                concat_ws(E'\n', admin_notes, trim(p_admin_notes))
            ELSE admin_notes
        END
    WHERE id = p_reservation_id
    RETURNING * INTO v_updated;

    RETURN to_jsonb(v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.official_confirm_cash_payment(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. UPDATE official_process_reservation TO SUPPORT PAYMENT DEADLINE & AUTO-CANCELLATION
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME);
DROP FUNCTION IF EXISTS public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.official_process_reservation(
    p_reservation_id UUID,
    p_action TEXT,
    p_status_reason TEXT DEFAULT NULL,
    p_admin_notes TEXT DEFAULT NULL,
    p_new_date DATE DEFAULT NULL,
    p_new_start_time TIME DEFAULT NULL,
    p_new_end_time TIME DEFAULT NULL,
    p_payment_due_at TIMESTAMPTZ DEFAULT NULL
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
    v_next_payment_due TIMESTAMPTZ;
    v_court_start_tz TIMESTAMPTZ;
BEGIN
    v_actor_id := auth.uid();

    -- 1. Enforce verified official + canManageReservations permission
    IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
        RAISE EXCEPTION 'Security violation: Only verified Barangay Officials with canManageReservations permission may process reservations.';
    END IF;

    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Reservation ID is required.';
    END IF;

    -- Sweep expired unpaid reservations
    PERFORM public.cancel_expired_unpaid_reservations();

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

        v_court_start_tz := (coalesce(p_new_date, v_existing.reservation_date) + coalesce(p_new_start_time, v_existing.start_time)) AT TIME ZONE 'Asia/Manila';
        IF v_court_start_tz <= now() THEN
            RAISE EXCEPTION 'Validation error: Cannot approve a reservation whose start time has already passed.';
        END IF;

        -- Payment rule:
        -- When approved, start payment deadline. Max window is 48 hours after approval.
        -- Payment MUST be completed before the reservation start time.
        -- Actual deadline is whichever comes first: 48 hours after approval OR reservation start time.
        IF p_payment_due_at IS NOT NULL THEN
            IF p_payment_due_at > v_court_start_tz THEN
                RAISE EXCEPTION 'Validation error: Payment deadline cannot be later than the reservation start time.';
            END IF;
            IF p_payment_due_at <= now() THEN
                RAISE EXCEPTION 'Validation error: Payment deadline must be in the future.';
            END IF;
            v_next_payment_due := LEAST(p_payment_due_at, now() + INTERVAL '48 hours', v_court_start_tz);
        ELSE
            v_next_payment_due := LEAST(now() + INTERVAL '48 hours', v_court_start_tz);
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
        -- Applicant must not be allowed to use the court without confirmed payment
        IF v_existing.payment_status <> 'paid' THEN
            RAISE EXCEPTION 'Validation error: Cannot mark a reservation as completed without confirmed cash payment.';
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

        v_court_start_tz := (v_next_date + v_next_start) AT TIME ZONE 'Asia/Manila';
        IF v_court_start_tz <= now() THEN
            RAISE EXCEPTION 'Validation error: Rescheduled reservation start time must be in the future.';
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

        IF v_existing.payment_status = 'pending_payment' THEN
            v_next_payment_due := LEAST(now() + INTERVAL '48 hours', v_court_start_tz);
        ELSE
            v_next_payment_due := v_existing.payment_due_at;
        END IF;
    ELSIF p_action <> 'approve' THEN
        v_next_payment_due := v_existing.payment_due_at;
    END IF;

    UPDATE public.reservations
    SET status = v_target_status,
        reservation_date = v_next_date,
        start_time = v_next_start,
        end_time = v_next_end,
        payment_due_at = v_next_payment_due,
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

GRANT EXECUTE ON FUNCTION public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TIMESTAMPTZ) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. UPGRADE VALIDATION TRIGGER TO ENFORCE CASH PAYMENT SECURITY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_reservation_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot tsrange;
BEGIN
    -- Serialize concurrent reservation writes for the same facility and date
    PERFORM pg_advisory_xact_lock(hashtext(coalesce(NEW.facility_name, 'Timugan Main Covered Court') || ':' || NEW.reservation_date::text));

    -- Auto-populate formatted address from structured fields
    NEW.address := concat_ws(
        ', ',
        nullif(trim(NEW.address_house_details), ''),
        nullif(trim(NEW.address_purok_street), ''),
        'Brgy. ' || trim(NEW.address_barangay),
        trim(NEW.address_city),
        trim(NEW.address_province)
    );

    -- Enforce valid non-past date on new reservations or schedule changes
    IF (TG_OP = 'INSERT' OR NEW.reservation_date IS DISTINCT FROM OLD.reservation_date) THEN
        IF NEW.reservation_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Validation error: Reservation date cannot be in the past.';
        END IF;
    END IF;

    -- Validate time range order and operating hours
    IF NEW.end_time <= NEW.start_time THEN
        RAISE EXCEPTION 'Validation error: End time must be later than start time.';
    END IF;

    IF NEW.start_time < '06:00:00'::time OR NEW.end_time > '22:00:00'::time THEN
        RAISE EXCEPTION 'Validation error: Reservations must be within court operating hours (06:00 AM to 10:00 PM).';
    END IF;

    v_slot := tsrange(NEW.reservation_date + NEW.start_time, NEW.reservation_date + NEW.end_time, '[)');

    -- Enforce court closure and active reservation conflict checks for active statuses
    IF NEW.status IN ('pending', 'approved') THEN
        -- 1. Reject if overlapping an active court closure
        IF EXISTS (
            SELECT 1
            FROM public.court_closures cc
            WHERE cc.is_active = true
              AND cc.facility_name = NEW.facility_name
              AND cc.time_slot && v_slot
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: Timugan Main Covered Court is closed during the selected date and time slot.';
        END IF;

        -- 2. Reject if overlapping any existing pending or approved reservation
        IF EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE r.status IN ('pending', 'approved')
              AND r.facility_name = NEW.facility_name
              AND r.time_slot && v_slot
              AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: The selected time slot overlaps with an existing pending or approved reservation.';
        END IF;
    END IF;

    -- Set default cash payment attributes on INSERT
    IF TG_OP = 'INSERT' THEN
        -- Sweep any expired unpaid reservations first
        IF pg_trigger_depth() = 1 THEN
            PERFORM public.cancel_expired_unpaid_reservations();
        END IF;

        NEW.payment_status := coalesce(NEW.payment_status, 'pending_payment');
        NEW.payment_method := 'cash';
        -- The payment deadline starts when an official approves the reservation
        NEW.payment_due_at := NULL;

        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
            IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
                RAISE EXCEPTION 'Security violation: Authenticated user must match the reservation applicant.';
            END IF;
            IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.admin_notes IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: New resident reservations must be submitted with pending status.';
            END IF;
            IF NEW.payment_status <> 'pending_payment' OR NEW.paid_at IS NOT NULL OR NEW.paid_confirmed_by IS NOT NULL OR NEW.payment_due_at IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: Residents cannot create pre-paid reservations or specify payment confirmations.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Allow system-level auto-cancellation of expired unpaid reservations
        IF OLD.payment_status = 'pending_payment'
           AND (
               (OLD.payment_due_at IS NOT NULL AND OLD.payment_due_at <= now())
               OR
               (((OLD.reservation_date + OLD.start_time) AT TIME ZONE 'Asia/Manila') <= now())
           )
           AND NEW.status = 'cancelled' THEN
            RETURN NEW;
        END IF;

        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
            -- Ordinary residents can only cancel their own pending or approved reservation
            IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() THEN
                RAISE EXCEPTION 'Security violation: Cannot modify another user''s reservation.';
            END IF;

            IF NEW.status <> 'cancelled' OR OLD.status NOT IN ('pending', 'approved') THEN
                RAISE EXCEPTION 'Security violation: Residents may only cancel their own pending or approved reservation.';
            END IF;

            IF OLD.reservation_date < CURRENT_DATE THEN
                RAISE EXCEPTION 'Validation error: Past reservations cannot be cancelled.';
            END IF;

            -- Prevent residents from altering schedule, PII, review metadata, OR PAYMENT FIELDS
            IF NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.reservation_date IS DISTINCT FROM OLD.reservation_date
               OR NEW.start_time IS DISTINCT FROM OLD.start_time
               OR NEW.end_time IS DISTINCT FROM OLD.end_time
               OR NEW.applicant_name IS DISTINCT FROM OLD.applicant_name
               OR NEW.applicant_mobile IS DISTINCT FROM OLD.applicant_mobile
               OR NEW.purpose IS DISTINCT FROM OLD.purpose
               OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
               OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
               OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
               OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
               OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
               OR NEW.payment_due_at IS DISTINCT FROM OLD.payment_due_at
               OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
               OR NEW.paid_confirmed_by IS DISTINCT FROM OLD.paid_confirmed_by THEN
                RAISE EXCEPTION 'Security violation: Residents cannot alter schedule, payment status, or administrative review fields.';
            END IF;
        ELSE
            -- When an official approves/rejects/updates status, record reviewer metadata automatically
            IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected', 'completed', 'no_show', 'rescheduled') THEN
                NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
                NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. UPGRADE AUDIT LOG TRIGGER TO RECORD PAYMENT ACTIONS
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

    -- Profiles role changes
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
                'profile_updated',
                'profile',
                NEW.id,
                NEW.id,
                jsonb_build_object(
                    'previous_role', OLD.role,
                    'new_role', NEW.role,
                    'previous_permissions', OLD.permissions,
                    'new_permissions', NEW.permissions,
                    'previous_verification_status', OLD.verification_status,
                    'new_verification_status', NEW.verification_status,
                    'previous_is_active', OLD.is_active,
                    'new_is_active', NEW.is_active
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
                coalesce(v_actor_id, NEW.verified_by, NEW.user_id),
                v_actor_role,
                CASE
                    WHEN TG_OP = 'INSERT' THEN 'official_verification_submitted'
                    ELSE 'official_verification_' || NEW.verification_status
                END,
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

    -- Reservation approval / rejection / cancellation / completion / payment
    ELSIF TG_TABLE_NAME = 'reservations' AND TG_OP = 'UPDATE' THEN
        -- Status or schedule changes
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
                    'status_reason', NEW.status_reason,
                    'payment_status', NEW.payment_status,
                    'payment_due_at', NEW.payment_due_at
                )
            );
        END IF;

        -- Payment status confirmation
        IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
            INSERT INTO public.audit_logs (
                actor_id,
                actor_role,
                action,
                entity_type,
                entity_id,
                target_user_id,
                details
            ) VALUES (
                coalesce(v_actor_id, NEW.paid_confirmed_by, NEW.reviewed_by, NEW.user_id),
                v_actor_role,
                CASE
                    WHEN NEW.payment_status = 'paid' THEN 'reservation_payment_confirmed'
                    ELSE 'reservation_payment_' || NEW.payment_status
                END,
                'reservation',
                NEW.id,
                NEW.user_id,
                jsonb_build_object(
                    'previous_payment_status', OLD.payment_status,
                    'payment_status', NEW.payment_status,
                    'payment_method', NEW.payment_method,
                    'paid_at', NEW.paid_at,
                    'paid_confirmed_by', NEW.paid_confirmed_by,
                    'payment_due_at', NEW.payment_due_at
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
            target_user_id,
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
            NULL,
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
-- 7. HOOK AUTOMATIC CANCELLATION INTO AVAILABILITY & PUBLIC SCHEDULE RPCS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_court_slot_availability(
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot tsrange;
    v_closure_reason TEXT;
    v_existing_status TEXT;
BEGIN
    -- Automatically cancel expired unpaid reservations before evaluating slot
    PERFORM public.cancel_expired_unpaid_reservations();

    IF p_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'invalid_input',
            'message', 'Please select a valid reservation date, start time, and end time.'
        );
    END IF;

    IF p_date < CURRENT_DATE THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'past_date',
            'message', 'Reservations cannot be scheduled for past dates.'
        );
    END IF;

    IF p_end_time <= p_start_time THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'invalid_time_range',
            'message', 'Reservation end time must be later than start time.'
        );
    END IF;

    IF p_start_time < '06:00:00'::time OR p_end_time > '22:00:00'::time THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'outside_operating_hours',
            'message', 'Timugan Main Covered Court operating hours are 06:00 AM to 10:00 PM.'
        );
    END IF;

    v_slot := tsrange(p_date + p_start_time, p_date + p_end_time, '[)');

    -- Check for court closures
    SELECT reason INTO v_closure_reason
    FROM public.court_closures
    WHERE is_active = true
      AND facility_name = 'Timugan Main Covered Court'
      AND time_slot && v_slot
    LIMIT 1;

    IF v_closure_reason IS NOT NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'court_closure',
            'message', 'Timugan Main Covered Court is closed during this time slot (' || v_closure_reason || ').'
        );
    END IF;

    -- Check for active reservations (pending, approved, rescheduled)
    SELECT status INTO v_existing_status
    FROM public.reservations
    WHERE status IN ('pending', 'approved', 'rescheduled')
      AND facility_name = 'Timugan Main Covered Court'
      AND time_slot && v_slot
    LIMIT 1;

    IF v_existing_status IS NOT NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'reservation_overlap',
            'message', 'This time slot is already reserved or pending review. Please choose another time.'
        );
    END IF;

    RETURN jsonb_build_object(
        'available', true,
        'conflict_type', null,
        'message', 'This time slot is currently available for booking.'
    );
END;
$$;

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
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Cancel expired unpaid reservations before returning public schedule
    PERFORM public.cancel_expired_unpaid_reservations();

    RETURN QUERY
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
            'closed' AS slot_status,
            'Court Closed: ' || cc.reason AS public_label
        FROM public.court_closures cc
        WHERE cc.closure_date BETWEEN p_start_date AND p_end_date
          AND cc.is_active = true

        ORDER BY slot_date ASC, start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_court_schedule(DATE, DATE) TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 8. SCHEDULE AUTOMATIC BACKGROUND SWEEP (RUNS EVEN WHEN FRONTEND IS CLOSED)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
    ) THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        BEGIN
            PERFORM cron.unschedule('ticore-cancel-expired-unpaid-reservations');
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
        PERFORM cron.schedule(
            'ticore-cancel-expired-unpaid-reservations',
            '* * * * *',
            'SELECT public.cancel_expired_unpaid_reservations()'
        );
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pg_cron background scheduler could not be configured: %', SQLERRM;
END;
$$;

COMMIT;
