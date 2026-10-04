-- TICORE Migration 8: Reservation Fees, Strict Rate Tiers & Monthly Reports
-- Enforces server-side fee calculations based on duration and residency/student category:
-- 1. Student rate: ₱150/hour (applies to all students, including Timugan residents)
-- 2. Timugan resident non-student: ₱200/hour
-- 3. Outside Brgy. Timugan: ₱300/hour
-- Stores final fee on reservations for historical reporting integrity.
-- Implements secure get_monthly_reservation_report RPC restricted to canViewReports.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ADD FEE & RATE CATEGORY COLUMNS TO public.reservations
-- ----------------------------------------------------------------------------
ALTER TABLE public.reservations
    ADD COLUMN IF NOT EXISTS is_student BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rate_category TEXT NOT NULL DEFAULT 'timugan_resident'
        CHECK (rate_category IN ('student', 'timugan_resident', 'outside_timugan')),
    ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 200.00
        CHECK (hourly_rate >= 0),
    ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10, 2) NOT NULL DEFAULT 200.00
        CHECK (total_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_reservations_rate_category
    ON public.reservations(rate_category);

CREATE INDEX IF NOT EXISTS idx_reservations_month_lookup
    ON public.reservations(reservation_date, status, payment_status);

-- ----------------------------------------------------------------------------
-- 2. IMMUTABLE FEE CALCULATION FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_reservation_fee(
    p_is_student BOOLEAN,
    p_residency_type TEXT,
    p_start_time TIME,
    p_end_time TIME,
    OUT r_rate_category TEXT,
    OUT r_hourly_rate NUMERIC,
    OUT r_duration_hours NUMERIC,
    OUT r_total_amount NUMERIC
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    r_duration_hours := round((extract(epoch from (p_end_time - p_start_time)) / 3600.0)::numeric, 2);

    -- Rate logic:
    -- 1. Student (including Timugan resident student): ₱150/hr
    -- 2. Timugan resident (non-student): ₱200/hr
    -- 3. Outside Brgy. Timugan: ₱300/hr
    IF coalesce(p_is_student, false) = true THEN
        r_rate_category := 'student';
        r_hourly_rate := 150.00;
    ELSIF p_residency_type = 'timugan_resident' THEN
        r_rate_category := 'timugan_resident';
        r_hourly_rate := 200.00;
    ELSE
        r_rate_category := 'outside_timugan';
        r_hourly_rate := 300.00;
    END IF;

    r_total_amount := round((r_duration_hours * r_hourly_rate)::numeric, 2);
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. BACKFILL EXISTING RESERVATIONS WITH HISTORICAL ACCURACY
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_calc RECORD;
BEGIN
    FOR r IN SELECT id, is_student, residency_type, start_time, end_time FROM public.reservations LOOP
        SELECT * INTO v_calc FROM public.calculate_reservation_fee(r.is_student, r.residency_type, r.start_time, r.end_time);
        UPDATE public.reservations
        SET rate_category = v_calc.r_rate_category,
            hourly_rate = v_calc.r_hourly_rate,
            total_amount = v_calc.r_total_amount
        WHERE id = r.id;
    END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. UPDATE VALIDATION TRIGGER TO ENFORCE SERVER-SIDE FEE CALCULATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_reservation_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_slot tsrange;
    v_calc RECORD;
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
    IF NEW.status IN ('pending', 'approved', 'rescheduled') THEN
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

        -- 2. Reject if overlapping any existing active reservation
        IF EXISTS (
            SELECT 1
            FROM public.reservations r
            WHERE r.status IN ('pending', 'approved', 'rescheduled')
              AND r.facility_name = NEW.facility_name
              AND r.time_slot && v_slot
              AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
        ) THEN
            RAISE EXCEPTION 'Reservation conflict: The selected time slot overlaps with an existing reservation.';
        END IF;
    END IF;

    -- Calculate official fee server-side (never trust client-supplied fee amounts)
    SELECT * INTO v_calc FROM public.calculate_reservation_fee(
        NEW.is_student,
        NEW.residency_type,
        NEW.start_time,
        NEW.end_time
    );

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

        -- Enforce calculated fee
        NEW.rate_category := v_calc.r_rate_category;
        NEW.hourly_rate := v_calc.r_hourly_rate;
        NEW.total_amount := v_calc.r_total_amount;

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

        -- If schedule or category changes, re-evaluate fee
        IF (NEW.start_time IS DISTINCT FROM OLD.start_time)
           OR (NEW.end_time IS DISTINCT FROM OLD.end_time)
           OR (NEW.is_student IS DISTINCT FROM OLD.is_student)
           OR (NEW.residency_type IS DISTINCT FROM OLD.residency_type) THEN
            NEW.rate_category := v_calc.r_rate_category;
            NEW.hourly_rate := v_calc.r_hourly_rate;
            NEW.total_amount := v_calc.r_total_amount;
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

            -- Prevent residents from altering schedule, PII, review metadata, OR PAYMENT/FEE FIELDS
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
               OR NEW.paid_confirmed_by IS DISTINCT FROM OLD.paid_confirmed_by
               OR NEW.is_student IS DISTINCT FROM OLD.is_student
               OR NEW.rate_category IS DISTINCT FROM OLD.rate_category
               OR NEW.hourly_rate IS DISTINCT FROM OLD.hourly_rate
               OR NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
                RAISE EXCEPTION 'Security violation: Residents cannot alter schedule, fees, payment status, or administrative review fields.';
            END IF;
        ELSE
            -- When an official updates, ensure reviewer metadata is recorded
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
-- 5. UPDATE official_process_reservation WITH RECALCULATED FEES ON RESCHEDULE
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.official_process_reservation(
    p_reservation_id UUID,
    p_action TEXT,
    p_status_reason TEXT DEFAULT NULL,
    p_admin_notes TEXT DEFAULT NULL,
    p_new_date DATE DEFAULT NULL,
    p_new_start_time TIME DEFAULT NULL,
    p_new_end_time TIME DEFAULT NULL,
    p_payment_due_at TIMESTAMPTZ DEFAULT NULL,
    p_is_student BOOLEAN DEFAULT NULL,
    p_custom_amount NUMERIC DEFAULT NULL
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
    v_next_is_student BOOLEAN;
    v_calc RECORD;
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

    v_next_date := coalesce(p_new_date, v_existing.reservation_date);
    v_next_start := coalesce(p_new_start_time, v_existing.start_time);
    v_next_end := coalesce(p_new_end_time, v_existing.end_time);
    v_next_is_student := coalesce(p_is_student, v_existing.is_student);

    -- Calculate fee parameters
    SELECT * INTO v_calc FROM public.calculate_reservation_fee(
        v_next_is_student,
        v_existing.residency_type,
        v_next_start,
        v_next_end
    );

    -- 2. Validate state transitions and required reasons
    IF p_action = 'approve' THEN
        IF v_existing.status NOT IN ('pending', 'rescheduled') THEN
            RAISE EXCEPTION 'Validation error: Only pending or rescheduled reservations can be approved (current status: %).', v_existing.status;
        END IF;

        v_court_start_tz := (v_next_date + v_next_start) AT TIME ZONE 'Asia/Manila';
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

        v_target_status := 'rescheduled';
    END IF;

    UPDATE public.reservations
    SET status = v_target_status,
        reservation_date = v_next_date,
        start_time = v_next_start,
        end_time = v_next_end,
        payment_due_at = coalesce(v_next_payment_due, payment_due_at),
        is_student = v_next_is_student,
        rate_category = v_calc.r_rate_category,
        hourly_rate = v_calc.r_hourly_rate,
        total_amount = coalesce(p_custom_amount, v_calc.r_total_amount),
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

GRANT EXECUTE ON FUNCTION public.official_process_reservation(UUID, TEXT, TEXT, TEXT, DATE, TIME, TIME, TIMESTAMPTZ, BOOLEAN, NUMERIC) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. MONTHLY RESERVATION & EARNINGS REPORT RPC (canViewReports RESTRICTED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_monthly_reservation_report(
    p_year INT,
    p_month INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_summary JSONB;
    v_category_breakdown JSONB;
    v_reservations JSONB;
    v_result JSONB;
BEGIN
    -- Strict authorization check: Only verified officials with canViewReports or canCreateOfficial
    IF NOT (
        public.is_privileged_db_context()
        OR public.has_official_permission('canViewReports')
        OR public.has_official_permission('canCreateOfficial')
    ) THEN
        RAISE EXCEPTION 'Security violation: Only authorized Barangay Officials with canViewReports permission may view reports.';
    END IF;

    -- Validate input month/year
    IF p_year < 2020 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Validation error: Invalid year (%).', p_year;
    END IF;
    IF p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Validation error: Invalid month (%).', p_month;
    END IF;

    -- Auto-cancel any expired unpaid reservations first
    PERFORM public.cancel_expired_unpaid_reservations();

    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::DATE;

    -- 1. Monthly Summary
    SELECT jsonb_build_object(
        'year', p_year,
        'month', p_month,
        'start_date', v_start_date,
        'end_date', v_end_date,
        'total_reservations', COUNT(*),
        'approved_count', COUNT(*) FILTER (WHERE status = 'approved'),
        'rejected_count', COUNT(*) FILTER (WHERE status = 'rejected'),
        'cancelled_count', COUNT(*) FILTER (WHERE status = 'cancelled'),
        'completed_count', COUNT(*) FILTER (WHERE status = 'completed'),
        'no_show_count', COUNT(*) FILTER (WHERE status = 'no_show'),
        'rescheduled_count', COUNT(*) FILTER (WHERE status = 'rescheduled'),
        'paid_count', COUNT(*) FILTER (WHERE payment_status = 'paid'),
        'paid_reservations_count', COUNT(*) FILTER (WHERE payment_status = 'paid'),
        'pending_payment_count', COUNT(*) FILTER (WHERE payment_status = 'pending_payment'),
        'status_counts', jsonb_build_object(
            'approved', COUNT(*) FILTER (WHERE status = 'approved'),
            'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
            'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
            'completed', COUNT(*) FILTER (WHERE status = 'completed'),
            'no_show', COUNT(*) FILTER (WHERE status = 'no_show'),
            'rescheduled', COUNT(*) FILTER (WHERE status = 'rescheduled'),
            'pending', COUNT(*) FILTER (WHERE status = 'pending')
        ),
        'total_booked_hours', COALESCE(
            SUM(round((extract(epoch from (end_time - start_time)) / 3600.0)::numeric, 2))
            FILTER (WHERE status IN ('approved', 'completed', 'rescheduled')),
            0
        ),
        -- Earnings: count ONLY reservations with payment_status = 'paid'
        'total_cash_collected', COALESCE(
            SUM(total_amount) FILTER (WHERE payment_status = 'paid'),
            0
        )
    )
    INTO v_summary
    FROM public.reservations
    WHERE reservation_date BETWEEN v_start_date AND v_end_date;

    -- 2. Category Breakdown (Student, Timugan resident, Outside Brgy. Timugan)
    WITH categories AS (
        SELECT 'student' AS cat, 'Student' AS label, 150.00 AS default_rate, 1 AS ord
        UNION ALL
        SELECT 'timugan_resident' AS cat, 'Timugan Resident' AS label, 200.00 AS default_rate, 2 AS ord
        UNION ALL
        SELECT 'outside_timugan' AS cat, 'Outside Brgy. Timugan' AS label, 300.00 AS default_rate, 3 AS ord
    ),
    actual_data AS (
        SELECT
            r.rate_category,
            COUNT(*) AS total_count,
            COUNT(*) FILTER (WHERE r.status = 'approved') AS approved_count,
            COUNT(*) FILTER (WHERE r.status = 'completed') AS completed_count,
            COUNT(*) FILTER (WHERE r.status = 'cancelled') AS cancelled_count,
            COUNT(*) FILTER (WHERE r.payment_status = 'paid') AS paid_count,
            COUNT(*) FILTER (WHERE r.payment_status = 'pending_payment') AS pending_payment_count,
            COALESCE(
                SUM(round((extract(epoch from (r.end_time - r.start_time)) / 3600.0)::numeric, 2))
                FILTER (WHERE r.status IN ('approved', 'completed', 'rescheduled')),
                0
            ) AS booked_hours,
            COALESCE(
                SUM(r.total_amount) FILTER (WHERE r.payment_status = 'paid'),
                0
            ) AS cash_collected
        FROM public.reservations r
        WHERE r.reservation_date BETWEEN v_start_date AND v_end_date
        GROUP BY r.rate_category
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'rate_category', c.cat,
            'label', c.label,
            'hourly_rate', c.default_rate,
            'total_reservations', COALESCE(a.total_count, 0),
            'reservation_count', COALESCE(a.total_count, 0),
            'approved_count', COALESCE(a.approved_count, 0),
            'completed_count', COALESCE(a.completed_count, 0),
            'cancelled_count', COALESCE(a.cancelled_count, 0),
            'paid_count', COALESCE(a.paid_count, 0),
            'pending_payment_count', COALESCE(a.pending_payment_count, 0),
            'booked_hours', COALESCE(a.booked_hours, 0),
            'total_hours', COALESCE(a.booked_hours, 0),
            'cash_collected', COALESCE(a.cash_collected, 0),
            'total_cash_collected', COALESCE(a.cash_collected, 0)
        )
        ORDER BY c.ord
    )
    INTO v_category_breakdown
    FROM categories c
    LEFT JOIN actual_data a ON c.cat = a.rate_category;

    -- 3. Sanitized reservation list for the month (no sensitive home details / contact info exposed)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', r.id,
                'reservation_date', r.reservation_date,
                'start_time', r.start_time,
                'end_time', r.end_time,
                'duration_hours', round((extract(epoch from (r.end_time - r.start_time)) / 3600.0)::numeric, 2),
                'activity_type', r.activity_type,
                'applicant_name', r.applicant_name,
                'residency_type', r.residency_type,
                'is_student', r.is_student,
                'rate_category', r.rate_category,
                'hourly_rate', r.hourly_rate,
                'total_amount', r.total_amount,
                'status', r.status,
                'payment_status', r.payment_status,
                'payment_due_at', r.payment_due_at,
                'paid_at', r.paid_at,
                'created_at', r.created_at
            )
            ORDER BY r.reservation_date ASC, r.start_time ASC
        ),
        '[]'::jsonb
    )
    INTO v_reservations
    FROM public.reservations r
    WHERE r.reservation_date BETWEEN v_start_date AND v_end_date;

    v_result := jsonb_build_object(
        'facility_name', 'Timugan Main Covered Court',
        'summary', v_summary,
        'category_breakdown', COALESCE(v_category_breakdown, '[]'::jsonb),
        'reservations', v_reservations
    );

    -- Log report access in audit logs
    INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        details
    ) VALUES (
        auth.uid(),
        'official',
        'monthly_report_viewed',
        'system',
        NULL,
        jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'total_reservations', (v_summary ->> 'total_reservations')::int,
            'total_cash_collected', (v_summary ->> 'total_cash_collected')::numeric
        )
    );

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_monthly_reservation_report(INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_reservation_report(INT, INT) TO authenticated;

COMMIT;
