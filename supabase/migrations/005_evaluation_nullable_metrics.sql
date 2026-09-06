-- MPLADS Platform — Evaluation metrics may be unmeasured
--
-- precision_val / recall_val / f1_val are ratios. When their denominator is zero
-- (an empty answer_key, or no alerts) the metric is undefined, and the evaluation
-- service reports NULL rather than substituting a plausible constant. The columns
-- must be able to hold that value.

ALTER TABLE evaluation_runs ALTER COLUMN precision_val DROP NOT NULL;
ALTER TABLE evaluation_runs ALTER COLUMN recall_val    DROP NOT NULL;
ALTER TABLE evaluation_runs ALTER COLUMN f1_val        DROP NOT NULL;
