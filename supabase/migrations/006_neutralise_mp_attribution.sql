-- 006 — Neutralise stored MP attribution (Doctrine 3)
--
-- Doctrine 3 bars MP-level risk aggregation. The generator, the ingest router and
-- both seed files no longer write a named Member of Parliament or a party label,
-- but a database seeded before that change still holds four named MPs with party
-- affiliations on `constituencies`, and 'Hon. Member of Parliament' on every row
-- of `works`. Re-running 004 does not clear them: its INSERTs carry
-- ON CONFLICT (id) DO NOTHING, so existing rows are left exactly as they were.
--
-- This resets both columns to their schema defaults. The columns themselves stay:
-- 001_initial_schema.sql created them, that file is applied history and is never
-- edited, and dropping a column on a live database is irreversible. Inert columns
-- carrying a default are the reversible remedy; a DROP is not.
--
-- Idempotent, and safe to run against a database that was never seeded.

UPDATE constituencies
   SET mp_name  = DEFAULT,
       mp_party = DEFAULT
 WHERE mp_name  IS DISTINCT FROM 'Hon. Member of Parliament'
    OR mp_party IS DISTINCT FROM 'Independent';

UPDATE works
   SET mp_name = DEFAULT
 WHERE mp_name IS DISTINCT FROM 'Hon. Member of Parliament';

-- Guard: fail loudly rather than silently leaving an attribution behind. If a
-- later writer reintroduces one of these columns, this migration is the last
-- place that would have caught it, so it should not pass quietly.
DO $$
DECLARE
  leftover INTEGER;
BEGIN
  SELECT count(*) INTO leftover
    FROM constituencies
   WHERE mp_name  <> 'Hon. Member of Parliament'
      OR mp_party <> 'Independent';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Doctrine 3: % constituency row(s) still carry MP attribution', leftover;
  END IF;

  SELECT count(*) INTO leftover
    FROM works
   WHERE mp_name <> 'Hon. Member of Parliament';
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Doctrine 3: % works row(s) still carry MP attribution', leftover;
  END IF;
END $$;

COMMENT ON COLUMN constituencies.mp_name  IS 'Doctrine 3: inert. No writer, no reader, no aggregation.';
COMMENT ON COLUMN constituencies.mp_party IS 'Doctrine 3: inert. No writer, no reader, no aggregation.';
COMMENT ON COLUMN works.mp_name           IS 'Doctrine 3: inert. No writer, no reader, no aggregation.';
