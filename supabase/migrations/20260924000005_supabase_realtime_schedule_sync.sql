-- ============================================================================
-- TICORE (Timugan Court Reservation System)
-- Migration: 20260924000005_supabase_realtime_schedule_sync.sql
-- Purpose: Configures Supabase Realtime (postgres_changes publication) and
--          a privacy-preserving public schedule change signal table
--          (public.court_schedule_realtime_events) so public & resident
--          calendars receive instant availability updates without exposing
--          private reservation rows or PII.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PRIVACY-SAFE PUBLIC SCHEDULE REALTIME SIGNAL TABLE (ZERO PII)
-- ----------------------------------------------------------------------------
-- Contains ONLY facility_name, affected_date, change_kind, and updated_at.
-- Never stores applicant_name, applicant_mobile, address, purpose, or admin_notes.
CREATE TABLE IF NOT EXISTS public.court_schedule_realtime_events (
    facility_name TEXT NOT NULL DEFAULT 'Timugan Main Covered Court' CHECK (
        facility_name = 'Timugan Main Covered Court'
    ),
    affected_date DATE NOT NULL,
    change_kind TEXT NOT NULL CHECK (
        change_kind IN ('reservation_schedule_changed', 'court_closure_changed')
    ),
    event_version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_name, affected_date)
);

COMMENT ON TABLE public.court_schedule_realtime_events IS 'Zero-PII public schedule change ticker for Supabase Realtime calendar synchronization.';

ALTER TABLE public.court_schedule_realtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_schedule_realtime_events FORCE ROW LEVEL SECURITY;

-- Public and authenticated users may read ONLY the non-PII date/version ticker
DROP POLICY IF EXISTS court_schedule_realtime_events_select_all ON public.court_schedule_realtime_events;
CREATE POLICY court_schedule_realtime_events_select_all
    ON public.court_schedule_realtime_events
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Direct client writes are prohibited; only SECURITY DEFINER triggers update this table.

-- ----------------------------------------------------------------------------
-- 2. AUTOMATIC TRIGGERS TO EMIT SCHEDULE AVAILABILITY SIGNALS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_court_schedule_realtime_signal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_date_new DATE;
    v_date_old DATE;
    v_kind TEXT;
BEGIN
    IF TG_TABLE_NAME = 'reservations' THEN
        v_kind := 'reservation_schedule_changed';
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_date_new := NEW.reservation_date;
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_date_old := OLD.reservation_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'court_closures' THEN
        v_kind := 'court_closure_changed';
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_date_new := NEW.closure_date;
        END IF;
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_date_old := OLD.closure_date;
        END IF;
    END IF;

    IF v_date_new IS NOT NULL THEN
        INSERT INTO public.court_schedule_realtime_events (
            facility_name,
            affected_date,
            change_kind,
            event_version,
            updated_at
        ) VALUES (
            'Timugan Main Covered Court',
            v_date_new,
            v_kind,
            1,
            now()
        )
        ON CONFLICT (facility_name, affected_date) DO UPDATE
        SET change_kind = EXCLUDED.change_kind,
            event_version = public.court_schedule_realtime_events.event_version + 1,
            updated_at = now();
    END IF;

    IF v_date_old IS NOT NULL AND v_date_old IS DISTINCT FROM v_date_new THEN
        INSERT INTO public.court_schedule_realtime_events (
            facility_name,
            affected_date,
            change_kind,
            event_version,
            updated_at
        ) VALUES (
            'Timugan Main Covered Court',
            v_date_old,
            v_kind,
            1,
            now()
        )
        ON CONFLICT (facility_name, affected_date) DO UPDATE
        SET change_kind = EXCLUDED.change_kind,
            event_version = public.court_schedule_realtime_events.event_version + 1,
            updated_at = now();
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_emit_realtime_signal ON public.reservations;
CREATE TRIGGER trg_reservations_emit_realtime_signal
    AFTER INSERT OR UPDATE OR DELETE ON public.reservations
    FOR EACH ROW EXECUTE FUNCTION public.emit_court_schedule_realtime_signal();

DROP TRIGGER IF EXISTS trg_court_closures_emit_realtime_signal ON public.court_closures;
CREATE TRIGGER trg_court_closures_emit_realtime_signal
    AFTER INSERT OR UPDATE OR DELETE ON public.court_closures
    FOR EACH ROW EXECUTE FUNCTION public.emit_court_schedule_realtime_signal();

-- ----------------------------------------------------------------------------
-- 3. CONFIGURE REPLICA IDENTITY & SUPABASE_REALTIME PUBLICATION
-- Note: reservations and court_closures contain a GENERATED ALWAYS AS (tsrange)
-- column (time_slot), which requires REPLICA IDENTITY DEFAULT (primary key) in
-- PostgreSQL 15+ logical replication publications so UPDATE/DELETE succeed.
-- ----------------------------------------------------------------------------
ALTER TABLE public.reservations REPLICA IDENTITY DEFAULT;
ALTER TABLE public.court_closures REPLICA IDENTITY DEFAULT;
ALTER TABLE public.court_schedule_realtime_events REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.court_closures;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.court_schedule_realtime_events;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

COMMIT;
