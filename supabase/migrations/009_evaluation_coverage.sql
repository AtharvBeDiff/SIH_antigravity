-- DRISHTI — record what an evaluation run actually scored
--
-- The answer key covers the rules `data-gen` can determine ground truth for.
-- Emergent findings (R-001's per-category cost outliers, R-009's duplicate
-- detection) and rules needing artifacts the generator does not produce (photo
-- hashes, health reports) are outside it.
--
-- Precision is therefore computed over the covered rules only. Without these two
-- columns a stored run does not record which rules that was, so a precision figure
-- read back later cannot be told apart from one computed over the whole catalogue —
-- and the difference is large: the uncovered rules produce most of the alerts.

ALTER TABLE evaluation_runs
  ADD COLUMN IF NOT EXISTS covered_rule_ids JSONB NOT NULL DEFAULT '[]';

ALTER TABLE evaluation_runs
  ADD COLUMN IF NOT EXISTS unscored_alerts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN evaluation_runs.covered_rule_ids IS
  'Rule IDs the answer key had ground truth for. precision_val/recall_val/f1_val are computed over these only.';

COMMENT ON COLUMN evaluation_runs.unscored_alerts IS
  'Alerts from rules outside covered_rule_ids. Neither credited as true positives nor penalised as false positives — the answer key cannot judge them.';
