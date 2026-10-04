-- TICORE security hardening: close direct-write authorization gaps and keep
-- public schedule/realtime payloads free of closure notes and resident data.
BEGIN;

-- Rescheduled reservations occupy a slot just like pending and approved ones.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.reservations a
        JOIN public.reservations b ON a.id < b.id
          AND a.facility_name = b.facility_name
          AND a.time_slot && b.time_slot
        WHERE a.status IN ('pending', 'approved', 'rescheduled')
          AND b.status IN ('pending', 'approved', 'rescheduled')
    ) THEN
        RAISE EXCEPTION 'Cannot enable reservation conflict protection: existing active reservations overlap. Resolve the overlaps and rerun this migration.';
    END IF;
END;
$$;

ALTER TABLE public.reservations
    DROP CONSTRAINT IF EXISTS reservations_no_double_booking_excl;
ALTER TABLE public.reservations
    ADD CONSTRAINT reservations_no_double_booking_excl
    EXCLUDE USING gist (
        facility_name WITH =,
        time_slot WITH &&
    ) WHERE (status IN ('pending', 'approved', 'rescheduled'));

-- Keep reservation cancellation and all official status changes behind RPCs.
-- Residents retain only the two columns needed for their direct cancellation
-- update; the row policy and validation trigger still enforce ownership/status.
REVOKE UPDATE ON public.reservations FROM authenticated;
GRANT UPDATE (status, status_reason) ON public.reservations TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_own_reservation(
    p_reservation_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_row public.reservations;
    v_reason TEXT := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;
    IF p_reservation_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Reservation ID is required.';
    END IF;
    IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Validation error: Cancellation reason is too long.';
    END IF;

    UPDATE public.reservations
       SET status = 'cancelled',
           status_reason = coalesce(v_reason, 'Cancelled by applicant')
     WHERE id = p_reservation_id
       AND user_id = v_uid
       AND status IN ('pending', 'approved')
       AND reservation_date >= current_date
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Not found or not authorized to cancel this reservation.';
    END IF;
    RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_own_reservation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_own_reservation(UUID, TEXT) TO authenticated;

-- Sensitive write operations must go through the permission-checking RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.court_closures FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.official_verifications FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;

-- Closure details (reason, creator and internal metadata) are visible to
-- verified officials only. Anonymous/public availability uses the safe RPC.
DROP POLICY IF EXISTS court_closures_select_active_or_official ON public.court_closures;
CREATE POLICY court_closures_select_official_only
    ON public.court_closures
    FOR SELECT TO authenticated
    USING (public.is_active_official());
REVOKE SELECT ON public.court_closures FROM anon;
GRANT SELECT ON public.court_closures TO authenticated;

CREATE OR REPLACE FUNCTION public.lock_court_closure_schedule_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Use the same transaction lock as reservation writes to serialize
    -- reservation-vs-closure races for a given facility and date.
    PERFORM pg_advisory_xact_lock(
        hashtext(coalesce(NEW.facility_name, 'Timugan Main Covered Court') || ':' || NEW.closure_date::text)
    );
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_court_closures_schedule_write_lock ON public.court_closures;
CREATE TRIGGER trg_court_closures_schedule_write_lock
    BEFORE INSERT OR UPDATE ON public.court_closures
    FOR EACH ROW EXECUTE FUNCTION public.lock_court_closure_schedule_write();

-- The availability endpoint must not disclose a free-form internal closure
-- reason to anonymous or resident callers.
CREATE OR REPLACE FUNCTION public.check_court_slot_availability(
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_slot tsrange;
    v_existing_status TEXT;
BEGIN
    IF p_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL
       OR p_date < current_date OR p_end_time <= p_start_time
       OR p_start_time < '06:00:00'::time OR p_end_time > '22:00:00'::time
       OR extract(epoch FROM (p_end_time - p_start_time)) < 3600
       OR extract(epoch FROM (p_end_time - p_start_time)) > 28800 THEN
        RETURN jsonb_build_object('available', false, 'conflict_type', 'invalid_input',
                                  'message', 'Please select a valid date and time within court operating hours.');
    END IF;

    v_slot := tsrange(p_date + p_start_time, p_date + p_end_time, '[)');
    IF EXISTS (
        SELECT 1 FROM public.court_closures c
         WHERE c.is_active AND c.facility_name = 'Timugan Main Covered Court'
           AND c.time_slot && v_slot
    ) THEN
        RETURN jsonb_build_object('available', false, 'conflict_type', 'court_closed',
                                  'message', 'The court is closed during the selected schedule.');
    END IF;

    SELECT r.status INTO v_existing_status
      FROM public.reservations r
     WHERE r.status IN ('pending', 'approved', 'rescheduled')
       AND r.facility_name = 'Timugan Main Covered Court'
       AND r.time_slot && v_slot
     ORDER BY CASE WHEN r.status = 'approved' THEN 1 ELSE 2 END
     LIMIT 1;
    IF v_existing_status IS NOT NULL THEN
        RETURN jsonb_build_object(
            'available', false,
            'conflict_type', CASE WHEN v_existing_status = 'approved' THEN 'slot_reserved' ELSE 'slot_pending' END,
            'message', 'The selected time slot is unavailable. Please choose another schedule.'
        );
    END IF;

    RETURN jsonb_build_object('available', true, 'conflict_type', NULL,
                              'message', 'This time slot is available.');
END;
$$;
REVOKE ALL ON FUNCTION public.check_court_slot_availability(DATE, TIME, TIME) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_court_slot_availability(DATE, TIME, TIME) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.official_deactivate_court_closure(p_closure_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_row public.court_closures;
BEGIN
    IF NOT (
        public.is_privileged_db_context()
        OR (auth.uid() IS NOT NULL AND (
            public.has_official_permission('canManageCourtClosures')
            OR public.has_official_permission('canManageCourt')
        ))
    ) THEN
        RAISE EXCEPTION 'Security violation: You are not authorized to manage court closures.';
    END IF;
    IF p_closure_id IS NULL THEN
        RAISE EXCEPTION 'Validation error: Closure ID is required.';
    END IF;

    UPDATE public.court_closures
       SET is_active = false
     WHERE id = p_closure_id AND is_active = true
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Not found or not authorized to deactivate this closure.';
    END IF;
    RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.official_deactivate_court_closure(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.official_deactivate_court_closure(UUID) TO authenticated;

-- A public schedule contains only date/time, availability state and a generic
-- label. Closure reasons may contain internal information and stay private.
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
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL
       OR p_end_date < p_start_date
       OR p_end_date > p_start_date + 366 THEN
        RAISE EXCEPTION 'Invalid schedule date range.';
    END IF;
    RETURN QUERY
    SELECT r.reservation_date, r.start_time, r.end_time, r.facility_name,
           CASE WHEN r.status = 'approved' THEN 'reserved' ELSE 'pending' END::TEXT,
           CASE WHEN r.status = 'approved' THEN 'Reserved' ELSE 'Application Under Review' END::TEXT
      FROM public.reservations r
     WHERE r.reservation_date BETWEEN p_start_date AND p_end_date
       AND r.status IN ('pending', 'approved', 'rescheduled')
    UNION ALL
    SELECT c.closure_date, c.start_time, c.end_time, c.facility_name,
           'closed'::TEXT, 'Facility Closed'::TEXT
      FROM public.court_closures c
     WHERE c.closure_date BETWEEN p_start_date AND p_end_date
       AND c.is_active = true
    ORDER BY 1, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_court_schedule(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_court_schedule(DATE, DATE) TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.court_schedule_realtime_events FROM anon, authenticated;
GRANT SELECT ON public.court_schedule_realtime_events TO anon, authenticated;

-- Profiles can only be edited through safe self-service columns. Role and
-- permission changes remain in the verification SECURITY DEFINER workflow.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
    full_name, email, mobile_number, residency_type, province,
    city_municipality, barangay, purok_street, house_lot_details
) ON public.profiles TO authenticated;

-- Defense-in-depth: Explicitly revoke DELETE on all core tables from authenticated and anon
REVOKE DELETE ON public.profiles, public.reservations, public.court_closures,
                  public.official_verifications, public.audit_logs,
                  public.court_schedule_realtime_events FROM anon, authenticated, PUBLIC;

-- Defense-in-depth: Ensure contact OTP challenges table is accessible strictly via SECURITY DEFINER RPCs
REVOKE ALL ON public.contact_otp_challenges FROM anon, authenticated, PUBLIC;

-- Defense-in-depth: Explicitly revoke direct SELECT on sensitive administrative/resident tables from unauthenticated anon role
REVOKE SELECT ON public.profiles, public.reservations,
                  public.official_verifications, public.audit_logs FROM anon;

COMMIT;
