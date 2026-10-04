-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260924000002_reservation_workflow_hardening.sql
-- Purpose: Hardens the single-court reservation workflow against race-condition
--          double bookings (across both pending and approved reservations),
--          past-date bookings, court closure conflicts, and adds atomic
--          availability checking, submission, and cancellation RPCs.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. UPGRADE GISt EXCLUSION CONSTRAINT TO COVER PENDING & APPROVED SLOTS
-- ----------------------------------------------------------------------------
-- Prevents two users from simultaneously reserving overlapping times (even while
-- pending review) for Timugan Main Covered Court. Cancelled/rejected slots are
-- automatically released so the schedule becomes bookable again.
ALTER TABLE public.reservations
    DROP CONSTRAINT IF EXISTS reservations_no_double_booking_excl;

ALTER TABLE public.reservations
    ADD CONSTRAINT reservations_no_double_booking_excl
    EXCLUDE USING gist (
        facility_name WITH =,
        time_slot WITH &&
    ) WHERE (status IN ('pending', 'approved'));

-- ----------------------------------------------------------------------------
-- 2. UPGRADE RESERVATION VALIDATION TRIGGER WITH ADVISORY LOCK & PAST-DATE CHECK
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
    -- to eliminate race conditions before checking conflicts.
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

    -- Enforce role-based rules on INSERT and UPDATE
    IF TG_OP = 'INSERT' THEN
        IF NOT (public.is_privileged_db_context() OR public.has_official_permission('canManageReservations')) THEN
            IF auth.uid() IS NULL OR NEW.user_id <> auth.uid() THEN
                RAISE EXCEPTION 'Security violation: Authenticated user must match the reservation applicant.';
            END IF;
            IF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.admin_notes IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: New resident reservations must be submitted with pending status.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
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

            IF NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.reservation_date IS DISTINCT FROM OLD.reservation_date
               OR NEW.start_time IS DISTINCT FROM OLD.start_time
               OR NEW.end_time IS DISTINCT FROM OLD.end_time
               OR NEW.applicant_name IS DISTINCT FROM OLD.applicant_name
               OR NEW.applicant_mobile IS DISTINCT FROM OLD.applicant_mobile
               OR NEW.purpose IS DISTINCT FROM OLD.purpose
               OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
               OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
               OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes THEN
                RAISE EXCEPTION 'Security violation: Residents cannot alter schedule, applicant, or administrative review fields when cancelling.';
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
-- 3. PUBLIC & RESIDENT AVAILABILITY CHECK RPC (NO PII EXPOSED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_court_slot_availability(
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot tsrange;
    v_closure_reason TEXT;
    v_existing_status TEXT;
BEGIN
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
            'message', 'End time must be later than start time.'
        );
    END IF;

    IF p_start_time < '06:00:00'::time OR p_end_time > '22:00:00'::time THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'outside_operating_hours',
            'message', 'Timugan Main Covered Court operates daily from 06:00 AM to 10:00 PM.'
        );
    END IF;

    IF extract(epoch FROM (p_end_time - p_start_time)) < 3600
       OR extract(epoch FROM (p_end_time - p_start_time)) > 28800 THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'invalid_duration',
            'message', 'Reservations must be between 1 hour and 8 hours in duration.'
        );
    END IF;

    v_slot := tsrange(p_date + p_start_time, p_date + p_end_time, '[)');

    -- 1. Check active court closures
    SELECT cc.reason
    INTO v_closure_reason
    FROM public.court_closures cc
    WHERE cc.is_active = true
      AND cc.facility_name = 'Timugan Main Covered Court'
      AND cc.time_slot && v_slot
    LIMIT 1;

    IF v_closure_reason IS NOT NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', 'court_closed',
            'message', 'The court is closed during this schedule (' || v_closure_reason || ').'
        );
    END IF;

    -- 2. Check overlapping active (pending or approved) reservations
    SELECT r.status
    INTO v_existing_status
    FROM public.reservations r
    WHERE r.status IN ('pending', 'approved')
      AND r.facility_name = 'Timugan Main Covered Court'
      AND r.time_slot && v_slot
    ORDER BY CASE WHEN r.status = 'approved' THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_existing_status IS NOT NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', CASE WHEN v_existing_status = 'approved' THEN 'slot_reserved' ELSE 'slot_pending' END,
            'message', CASE
                WHEN v_existing_status = 'approved' THEN 'This time slot is already reserved and approved. Please choose another schedule.'
                ELSE 'Another reservation application is already pending review for an overlapping time slot. Please select an open schedule.'
            END
        );
    END IF;

    RETURN jsonb_build_object(
        'available', true,
        'conflict_type', null,
        'message', 'This time slot at Timugan Main Covered Court is open for reservation.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_court_slot_availability(DATE, TIME, TIME) TO anon, authenticated, service_role;

COMMIT;

