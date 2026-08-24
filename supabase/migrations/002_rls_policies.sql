-- MPLADS Platform — Row Level Security Policies
-- Service role bypasses RLS; these policies are for anon/user access.

-- Enable RLS on all tables
ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE constituencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE works ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_probation ENABLE ROW LEVEL SECURITY;
ALTER TABLE digest_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;

-- Drop old policies to allow idempotent execution
DROP POLICY IF EXISTS "anon_read_districts" ON districts;
DROP POLICY IF EXISTS "anon_read_constituencies" ON constituencies;
DROP POLICY IF EXISTS "anon_read_works_public_fields" ON works;
DROP POLICY IF EXISTS "anon_read_meta" ON meta;
DROP POLICY IF EXISTS "anon_read_calibration" ON calibration_snapshots;

DROP POLICY IF EXISTS "auth_read_all_districts" ON districts;
DROP POLICY IF EXISTS "auth_read_all_constituencies" ON constituencies;
DROP POLICY IF EXISTS "auth_read_all_agencies" ON agencies;
DROP POLICY IF EXISTS "auth_read_all_works" ON works;
DROP POLICY IF EXISTS "auth_read_all_payments" ON payments;
DROP POLICY IF EXISTS "auth_read_all_documents" ON documents;
DROP POLICY IF EXISTS "auth_read_all_alerts" ON alerts;
DROP POLICY IF EXISTS "auth_read_all_audit" ON audit_events;
DROP POLICY IF EXISTS "auth_read_all_answer_key" ON answer_key;
DROP POLICY IF EXISTS "auth_read_all_evaluation" ON evaluation_runs;
DROP POLICY IF EXISTS "auth_read_all_inspections" ON inspections;
DROP POLICY IF EXISTS "auth_read_all_inspection_items" ON inspection_items;
DROP POLICY IF EXISTS "auth_read_all_review_actions" ON review_actions;
DROP POLICY IF EXISTS "auth_read_all_rule_probation" ON rule_probation;
DROP POLICY IF EXISTS "auth_read_all_digests" ON digest_history;
DROP POLICY IF EXISTS "auth_read_all_calibration" ON calibration_snapshots;
DROP POLICY IF EXISTS "auth_read_all_meta" ON meta;
DROP POLICY IF EXISTS "auth_read_field_sync" ON field_sync_queue;
DROP POLICY IF EXISTS "auth_insert_inspections" ON inspections;
DROP POLICY IF EXISTS "auth_insert_inspection_items" ON inspection_items;

-- Public (anon) can only read safe tables
CREATE POLICY "anon_read_districts" ON districts
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_constituencies" ON constituencies
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_works_public_fields" ON works
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_meta" ON meta
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_calibration" ON calibration_snapshots
  FOR SELECT TO anon USING (true);

-- Authenticated users can read everything
CREATE POLICY "auth_read_all_districts" ON districts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_constituencies" ON constituencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_agencies" ON agencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_works" ON works
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_payments" ON payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_documents" ON documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_alerts" ON alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_audit" ON audit_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_answer_key" ON answer_key
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_evaluation" ON evaluation_runs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspections" ON inspections
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_inspection_items" ON inspection_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_review_actions" ON review_actions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_rule_probation" ON rule_probation
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_digests" ON digest_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_calibration" ON calibration_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_all_meta" ON meta
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read_field_sync" ON field_sync_queue
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert inspections (field PWA)
CREATE POLICY "auth_insert_inspections" ON inspections
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth_insert_inspection_items" ON inspection_items
  FOR INSERT TO authenticated WITH CHECK (true);
