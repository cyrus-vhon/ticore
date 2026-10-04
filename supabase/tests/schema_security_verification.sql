-- ============================================================================
-- TICORE Database Schema & Security Verification Test Suite
-- File: supabase/tests/schema_security_verification.sql
-- Purpose: Verifies tables, foreign keys, constraints, double-booking
--          exclusion rules, role escalation protection, and RLS policies.
-- ============================================================================

BEGIN;

-- 1. Verify all 5 core tables exist with Row Level Security enabled and forced
DO $$
DECLARE
    v_table TEXT;
    v_relrowsecurity BOOLEAN;
    v_relforcerowsecurity BOOLEAN;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'profiles',
        'reservations',
        'court_closures',
        'official_verifications',
        'audit_logs',
        'contact_otp_challenges',
        'court_schedule_realtime_events'
    ]
    LOOP
        SELECT c.relrowsecurity, c.relforcerowsecurity
        INTO v_relrowsecurity, v_relforcerowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = v_table;

        IF v_relrowsecurity IS DISTINCT FROM true OR v_relforcerowsecurity IS DISTINCT FROM true THEN
            RAISE EXCEPTION 'Verification failed: RLS not enabled/forced on public.%', v_table;
        END IF;
    END LOOP;
END;
$$;

-- 2. Verify Foreign Keys, Check Constraints, and Exclusion Constraints exist
DO $$
DECLARE
    v_constraint_definition TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'reservations_no_double_booking_excl'
    ) THEN
        RAISE EXCEPTION 'Verification failed: reservations_no_double_booking_excl constraint missing.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'court_closures_no_overlap_excl'
    ) THEN
        RAISE EXCEPTION 'Verification failed: court_closures_no_overlap_excl constraint missing.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profiles_official_requires_verification'
    ) THEN
        RAISE EXCEPTION 'Verification failed: profiles_official_requires_verification constraint missing.';
    END IF;

    SELECT pg_get_constraintdef(oid)
      INTO v_constraint_definition
      FROM pg_constraint
     WHERE conname = 'reservations_no_double_booking_excl';
    IF v_constraint_definition NOT ILIKE '%pending%approved%rescheduled%' THEN
        RAISE EXCEPTION 'Verification failed: active reservation exclusion must include pending, approved, and rescheduled states.';
    END IF;
END;
$$;

-- 3. Verify direct table privileges cannot bypass sensitive database workflows
DO $$
BEGIN
    IF has_table_privilege('authenticated', 'public.reservations', 'UPDATE') THEN
        RAISE EXCEPTION 'Verification failed: authenticated users retain table-wide reservation UPDATE.';
    END IF;
    IF NOT has_column_privilege('authenticated', 'public.reservations', 'status', 'UPDATE')
       OR NOT has_column_privilege('authenticated', 'public.reservations', 'status_reason', 'UPDATE') THEN
        RAISE EXCEPTION 'Verification failed: resident cancellation column grants are missing.';
    END IF;
    IF has_table_privilege('authenticated', 'public.court_closures', 'INSERT')
       OR has_table_privilege('authenticated', 'public.court_closures', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.court_closures', 'DELETE')
       OR has_table_privilege('authenticated', 'public.official_verifications', 'INSERT')
       OR has_table_privilege('authenticated', 'public.official_verifications', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.official_verifications', 'DELETE')
       OR has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
       OR has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.audit_logs', 'DELETE') THEN
        RAISE EXCEPTION 'Verification failed: sensitive writes remain directly available to authenticated clients.';
    END IF;
    IF has_table_privilege('anon', 'public.court_closures', 'SELECT') THEN
        RAISE EXCEPTION 'Verification failed: anonymous users can query private court closure details.';
    END IF;
    IF NOT has_function_privilege('authenticated', 'public.cancel_own_reservation(uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.official_deactivate_court_closure(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Verification failed: protected reservation/closure RPC grants are missing.';
    END IF;
END;
$$;

-- 4. Verify public schedule and realtime surfaces do not select or publish
--    resident details or internal closure reasons.
DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef('public.get_public_court_schedule(date,date)'::regprocedure)
      INTO v_definition;
    IF v_definition ILIKE '%c.reason%' OR v_definition ILIKE '%applicant_name%'
       OR v_definition ILIKE '%applicant_mobile%' OR v_definition ILIKE '%admin_notes%' THEN
        RAISE EXCEPTION 'Verification failed: public schedule RPC references private data.';
    END IF;
    SELECT pg_get_functiondef('public.check_court_slot_availability(date,time,time)'::regprocedure)
      INTO v_definition;
    IF v_definition ILIKE '%c.reason%' OR v_definition ILIKE '%applicant_name%'
       OR v_definition ILIKE '%applicant_mobile%' OR v_definition ILIKE '%admin_notes%' THEN
        RAISE EXCEPTION 'Verification failed: public availability RPC references private data.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'court_schedule_realtime_events'
          AND has_table_privilege('anon', c.oid, 'SELECT')
    ) THEN
        RAISE EXCEPTION 'Verification failed: public safe schedule realtime ticker is unavailable.';
    END IF;
END;
$$;

ROLLBACK;
