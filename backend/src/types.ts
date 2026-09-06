/**
 * DRISHTI — MPLADS Insight & Integrity Platform (Canonical Types)
 *
 * THE source of truth for every shape in the system.
 * Read this before declaring any type. Do NOT duplicate or shadow.
 *
 * Convention: Node 24 type-stripping — no enum, no namespace,
 * no parameter properties, no decorators.
 * Money: rupees as number. Dates: YYYY-MM-DD. Timestamps: ISO-8601 Z.
 */

// ─── Severity ────────────────────────────────────────────────

/**
 * Lower rank = higher severity. Used for queue ordering:
 * severity_rank ASC puts CRITICAL first.
 */
export const SEVERITY_RANK = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
} as const;

export type SeverityLevel = keyof typeof SEVERITY_RANK;

// ─── Work Status ─────────────────────────────────────────────

export const WORK_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'ON_HOLD',
] as const;

export type WorkStatus = (typeof WORK_STATUSES)[number];

// ─── Work Categories (from MPLADS Guidelines) ───────────────

export const WORK_CATEGORIES = [
  'DRINKING_WATER',
  'EDUCATION',
  'ELECTRICITY',
  'HEALTH',
  'SANITATION',
  'ROADS_BRIDGES',
  'COMMUNITY_INFRASTRUCTURE',
  'SPORTS_RECREATION',
  'DISABILITY_WELFARE',
  'RELIGIOUS_HERITAGE',
  'SHELTER',
  'IRRIGATION',
  'TECHNOLOGY',
  'ENVIRONMENT',
  'OTHER',
] as const;

export type WorkCategory = (typeof WORK_CATEGORIES)[number];

export const ELIGIBLE_CATEGORIES: WorkCategory[] = [
  'DRINKING_WATER', 'EDUCATION', 'ELECTRICITY', 'HEALTH',
  'SANITATION', 'ROADS_BRIDGES', 'COMMUNITY_INFRASTRUCTURE',
  'SPORTS_RECREATION', 'DISABILITY_WELFARE', 'SHELTER',
  'IRRIGATION', 'TECHNOLOGY', 'ENVIRONMENT',
];

export const INELIGIBLE_CATEGORIES: WorkCategory[] = [
  'RELIGIOUS_HERITAGE',
];

// ─── Planted Anomaly Types (for answer key / evaluation) ────

/**
 * The anomaly types the answer key can hold — one per entry in `GROUND_TRUTH` in
 * `data-gen/generate.ts`, which is the only writer.
 *
 * These are named after the *condition*, and each is paired with the rule expected
 * to catch it. The previous list named eight aspirational types (`COST_OUTLIER`,
 * `PHOTO_REUSE`, `INELIGIBLE_CATEGORY`, …) that nothing ever wrote, while every
 * value the generator does write was absent — so `AnswerKey.anomaly_type` was
 * typed as a union excluding all of its own data. Two of those eight are now in
 * `UNCOVERED_RULES`: their ground truth is either emergent (a cost outlier is
 * defined against its category's distribution, not against one work) or needs
 * artifacts the generator does not produce (photo hashes). `MISSING_HEALTH_REPORT`
 * used to be in that second group and no longer is: the generator emits a reporting
 * history now, so R-019's recall is measurable rather than assumed.
 */
export const PLANTED_ANOMALY_TYPES = [
  'MISSING_UC',                    // R-003
  'COST_OVERRUN',                  // R-004
  'ZERO_EXPENDITURE_IN_PROGRESS',  // R-005
  'COMPLETED_LOW_PROGRESS',        // R-008
  'INELIGIBLE_CATEGORY',           // R-011
  'STAGE_PAYMENT_STALLED',         // R-012
  'RELEASE_OVERRUN',               // R-013
  'NO_PAYMENT_SINCE_SANCTION',     // R-014
  'ON_HOLD_TOO_LONG',              // R-015
  'MISSING_HEALTH_REPORT',         // R-019
  'SANCTION_SLA_BREACHED',         // R-020
] as const;

export type PlantedAnomalyType = (typeof PLANTED_ANOMALY_TYPES)[number];

// ─── Verification Status (honesty contract) ─────────────────

export const VERIFICATION_STATUSES = [
  'VERIFIED',              // arithmetic / scheme design — known correct
  'NEEDS_VERIFICATION',    // threshold believed right, not yet checked against official guidelines
  'PLATFORM_POLICY',       // an operational threshold we chose
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

// ─── Alert ───────────────────────────────────────────────────

export const ALERT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'DISMISSED',
  'ESCALATED',
  'AUTO_RESOLVED',
  'BACKLOG',
] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const DISMISS_REASON_CODES = [
  'FALSE_POSITIVE',
  'ALREADY_ADDRESSED',
  'DATA_QUALITY_ISSUE',
  'EXPECTED_PATTERN',
  'APPROVED_EXCEPTION',
  'DUPLICATE_ALERT',
  'OUT_OF_SCOPE',
  'INSUFFICIENT_EVIDENCE',
] as const;

export type DismissReasonCode = (typeof DISMISS_REASON_CODES)[number];

// ─── Inspection Checklist ────────────────────────────────────

export const INSPECTION_CHECKLIST = [
  { id: 'SITE_VISITED', label: 'Site physically visited', required: true },
  { id: 'WORK_IN_PROGRESS', label: 'Work is visibly in progress', required: false },
  { id: 'MATERIALS_PRESENT', label: 'Construction materials on site', required: false },
  { id: 'SIGNBOARD_PRESENT', label: 'MPLADS signboard displayed', required: true },
  { id: 'MATCHES_DESCRIPTION', label: 'Work matches sanctioned description', required: true },
  { id: 'QUALITY_ACCEPTABLE', label: 'Quality of work is acceptable', required: true },
  { id: 'COMMUNITY_AWARE', label: 'Local community is aware of the work', required: false },
  { id: 'UC_AVAILABLE', label: 'Utilisation certificate available', required: false },
  { id: 'PHOTOS_TAKEN', label: 'Site photos captured', required: true },
  { id: 'GPS_RECORDED', label: 'GPS coordinates recorded', required: true },
] as const;

export type ChecklistItemId = (typeof INSPECTION_CHECKLIST)[number]['id'];

// ─── Domain Models ───────────────────────────────────────────

export interface District {
  id: string;
  name: string;
  state: string;
  code: string;
}

export interface Constituency {
  id: string;
  district_id: string;
  name: string;
  /**
   * Doctrine 3 — no MP-level risk aggregation. These two columns exist in the
   * schema but nothing populates them and nothing may display, group, filter or
   * rank by them. The scheme is named after MPs; the oversight is not aimed at
   * them. Accountability units here are the agency and the district.
   */
  mp_name: string;
  mp_party: string;
}

export interface Agency {
  id: string;
  district_id: string;
  name: string;
  type: string;
}

export interface Work {
  id: string;
  district_id: string;
  constituency_id: string;
  agency_id: string;
  /** Doctrine 3 — inert, as on Constituency above. Nothing writes it, nothing reads it. */
  mp_name: string;
  esakshi_work_id: string | null;

  // Description
  title: string;
  description: string;
  category: WorkCategory;
  sub_category: string | null;

  // Location
  location_name: string;
  latitude: number | null;
  longitude: number | null;
  ward: string | null;

  // Financials (rupees as number)
  sanctioned_amount: number;
  released_amount: number;
  expenditure: number;
  first_installment: number | null;
  second_installment: number | null;

  // Dates (YYYY-MM-DD)
  sanction_date: string | null;
  recommended_date: string | null;
  completion_target_date: string | null;
  actual_completion_date: string | null;
  last_payment_date: string | null;

  // Status
  status: WorkStatus;
  physical_progress_pct: number;

  // Metadata
  has_uc: boolean;
  uc_date: string | null;
  phase: number;
  is_scsp: boolean;   // SC Sub-Plan
  is_tsp: boolean;    // Tribal Sub-Plan
  evidence_image_key: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * One stage payment against a work.
 *
 * `installment_number` is gone: an integer defaulting to 1 could order these
 * events but not say what any of them was for, and every rule that reads a
 * payment needs to know. `stage` says what the money was for, `sequence_number`
 * says where it sits in the history. See `services/fund_flow.ts` for the stage
 * vocabulary and migration 008 for the reshape.
 */
export interface Payment {
  id: string;
  work_id: string;
  amount: number;
  payment_date: string;
  /** One of `PAYMENT_STAGES`; enforced by a CHECK constraint in the database. */
  stage: string;
  /** Position in this work's payment history, 1-based. */
  sequence_number: number;
  /** PFMS/SNA settlement reference, one per payment. Null until reconciled. */
  pfms_reference: string | null;
  purpose: string | null;
  created_at: string;
}

export interface Document {
  id: string;
  work_id: string;
  type: string;
  filename: string;
  storage_key: string;
  uploaded_at: string;
}

export interface Alert {
  id: string;
  work_id: string;
  rule_id: string;
  origin_id: string;          // stableId for UNIQUE(work_id, origin_id)
  severity: SeverityLevel;
  severity_rank: number;
  status: AlertStatus;
  reason_code: string;
  evidence_text: string;
  confidence: number | null;  // 0.0–1.0, only for detectors
  in_budget: boolean;         // false = BACKLOG

  // Officer decisions (preserved across re-analysis)
  reviewed_by: string | null;
  reviewed_at: string | null;
  dismiss_reason: DismissReasonCode | null;
  dismiss_note: string | null;

  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  seq: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  prev_hash: string;
  this_hash: string;
  created_at: string;
}

export interface AnswerKey {
  id: string;
  work_id: string;
  anomaly_type: PlantedAnomalyType;
  description: string;
  expected_rule_id: string | null;
}

/**
 * Per-anomaly-type detection metrics.
 *
 * There is deliberately no per-type `precision` field. Precision needs false
 * positives, and a false positive is an alert on a work that was never planted —
 * such an alert belongs to no planted anomaly type, so it cannot be attributed to
 * one. Per-type precision is therefore not measurable from this data, and a
 * per-type figure computed as `tp / tp` would be 1.0 by construction.
 */
export interface TypeMetrics {
  planted: number;
  detected: number;
  true_positives: number;
  false_negatives: number;
  /** null when nothing of this type was planted (0/0 is undefined, not 1.0). */
  recall: number | null;
}

export interface EvaluationRun {
  id: string;
  run_at: string;
  seed: number;
  total_works: number;
  total_planted: number;
  total_alerts: number;
  /**
   * Rules the answer key has ground truth for. Precision and recall are computed
   * over these only — an alert from any other rule is counted in
   * `unscored_alerts` rather than scored as a false positive, because the answer
   * key has nothing to say about whether it was correct.
   */
  covered_rule_ids: string[];
  /** Alerts from rules outside `covered_rule_ids`, neither credited nor penalised. */
  unscored_alerts: number;
  /**
   * null when the metric's denominator is zero — i.e. the answer key is empty, or
   * no alerts fired. An unmeasurable metric is reported as unmeasured, never as a
   * placeholder constant.
   */
  precision_val: number | null;
  recall_val: number | null;
  f1_val: number | null;
  per_type: Record<string, TypeMetrics>;
}

export interface Inspection {
  id: string;
  work_id: string;
  inspector_id: string;
  inspector_name: string;
  inspection_date: string;
  latitude: number;
  longitude: number;
  overall_status: 'PASS' | 'FAIL' | 'PARTIAL';
  items: InspectionItem[];
  notes: string | null;
  photo_keys: string[];
  synced: boolean;
  created_at: string;
}

export interface InspectionItem {
  checklist_id: ChecklistItemId;
  checked: boolean;
  note: string | null;
}

export interface ReviewAction {
  id: string;
  alert_id: string;
  action: AlertStatus;
  actor: string;
  reason_code: DismissReasonCode | null;
  note: string | null;
  created_at: string;
}

export interface RuleProbation {
  rule_id: string;
  total_reviews: number;
  dismissals: number;
  actionable_rate: number;
  suspended: boolean;
  suspended_at: string | null;
  reinstated_at: string | null;
}

// ─── Rule Definition (loaded from YAML) ─────────────────────

export interface RuleDefinition {
  id: string;
  name: string;
  description: string;
  severity: SeverityLevel;
  category: string;
  verification_status: VerificationStatus;
  params: Record<string, number | string | boolean>;
  evidence_template: string;
  applies_to_status: WorkStatus[] | null;
  enabled: boolean;
  /**
   * Why this rule cannot fire on current data, or absent when it can.
   *
   * A third state that `enabled` alone cannot express. A rule may be enabled,
   * correctly implemented, and still structurally unable to produce an alert
   * because the field it reads has no writer — R-010 compares
   * `works.evidence_image_key` across works and nothing populates that column, so
   * its detector loops over an empty array on every run.
   *
   * `enabled: false` would be the wrong way to say this: it means an operator turned
   * the rule off and can turn it back on, and it excludes the rule from the catalogue
   * count. Silence would be worse — a CRITICAL anti-fraud rule listed as active and
   * never firing reads as "no photo reuse found in this corpus", which is a finding
   * the platform has not made and cannot make.
   *
   * Set this when the *data path* is missing, not when a rule merely happens to
   * match nothing today.
   */
  dormant_reason?: string;
}

export interface RulesConfig {
  rules: RuleDefinition[];
  probation: {
    threshold: number;       // 0.40
    min_reviews: number;     // 25
  };
  alert_budget: {
    max_per_district: number;  // 10
  };
}

// ─── Public View (whitelist — doctrine #4) ──────────────────

/**
 * PublicWork is built by EXPLICITLY naming safe fields.
 * Never delete keys off a Work. If you add a field to Work,
 * it stays internal unless you explicitly add it here.
 */
export interface PublicWork {
  id: string;
  title: string;
  description: string;
  category: WorkCategory;
  location_name: string;
  status: WorkStatus;
  physical_progress_pct: number;
  sanctioned_amount: number;
  expenditure: number;
  sanction_date: string | null;
  actual_completion_date: string | null;
  district_name: string;
  constituency_name: string;
}

// ─── API Envelopes ───────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    page_size?: number;
    has_more?: boolean;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PagingParams {
  page: number;
  page_size: number;
}

// ─── Dashboard / Digest types ────────────────────────────────

/**
 * Aggregates for `GET /dashboard`, computed live from `works` and `alerts`.
 *
 * `completion_rate_by_count` and `completion_rate_by_value` are the corpus's own
 * ratios, not the published benchmarks — `/calibration` is where the two are
 * compared. Both are `0` on an empty corpus rather than `null`, which is the one
 * fabricated-zero left in this shape; a caller charting a gauge against 50.71%
 * should check `total_works` before believing a 0%.
 */
export interface DashboardStats {
  total_works: number;
  completed_works: number;
  completion_rate_by_count: number;
  total_sanctioned: number;
  total_expenditure: number;
  completion_rate_by_value: number;
  open_alerts: number;
  backlog_alerts: number;
  /** OPEN and BACKLOG alerts only. Reviewed and dismissed alerts are excluded. */
  alerts_by_severity: Record<SeverityLevel, number>;
  works_by_status: Record<WorkStatus, number>;
  works_by_category: Record<string, number>;
  /**
   * Total released to implementing agencies, in rupees — the sum of
   * `works.released_amount`.
   *
   * Added because `OverviewPage.tsx` rendered "Released to Agencies" as
   * `total_sanctioned * 0.62`, in two places. The column exists, the generator writes
   * it as the sum of the work's payment rows, and the CSV ingest reads it — so a
   * constant was standing in for a figure that was already in the database.
   */
  total_released: number;
  /**
   * Monthly series, or `null` when the corpus is empty.
   *
   * `TrendPoint[]` with `[]` for "not computed" was the original shape, and an empty
   * array is indistinguishable from a corpus with no activity in any month; it then
   * spent a while as a permanent `null` with a note that computing it needed a monthly
   * rollup. It is now computed — see `GET /dashboard` — and is `null` only when there
   * is genuinely nothing to roll up.
   */
  trend: TrendPoint[] | null;
}

/**
 * Sanction-decision SLA statistics, as returned by `GET /sla/stats`.
 *
 * The counts partition the works with no sanction date on record. `breached`,
 * `atRisk` and `safe` are the works still awaiting a decision; the other two are
 * works that are not awaiting one and must not be read as compliant or as
 * findings:
 *
 * - `rejected` — a decision was taken, but there is no `rejection_date` column, so
 *   whether it landed inside the limit is unknown. Not a breach.
 * - `notTrackable` — no usable recommendation date, so the clock has no start
 *   (Doctrine 6).
 *
 * `avgDays` is `null`, never `0`, when nothing measurable is pending.
 */
export interface SLAStats {
  total: number;
  breached: number;
  atRisk: number;
  safe: number;
  rejected: number;
  notTrackable: number;
  /** Mean days pending, over `measuredCount` works. Null when that is zero. */
  avgDays: number | null;
  /** Works the mean is computed over — not `total`. */
  measuredCount: number;
  /** Echoed from the rule catalogue so the UI states the thresholds it used. */
  limitDays: number;
  warningDays: number;
}

/**
 * SC/ST reservation compliance (R-016), as returned by `GET /quota`.
 *
 * This replaces a `QuotaStats` shape whose denominator was `totalSanctioned` — the
 * portfolio measured against itself, which is not the guideline's test. The mandate is
 * a share of the *entitlement*, so the fields name the entitlement explicitly. See
 * `services/compliance.ts`, which is the only producer.
 *
 * A percentage is `null`, never 0, when there is no entitlement period to measure
 * against: 0% reads as "nothing was reserved", which is a finding, where the truth is
 * that no finding is available.
 */
export interface ReservationCompliance {
  scsp_recommended_inr: number;
  tsp_recommended_inr: number;
  /** Distinct constituency × financial-year pairs found in the corpus. */
  entitlement_periods: number;
  /** `entitlement_periods` × ₹5 Cr — the denominator. */
  entitlement_inr: number;
  scsp_pct: number | null;
  tsp_pct: number | null;
  scsp_target_pct: number;
  tsp_target_pct: number;
  scsp_meets_target: boolean | null;
  tsp_meets_target: boolean | null;
  works_counted: number;
  /** Excluded for want of a recommendation date, so the percentages understate. */
  works_missing_recommended_date: number;
  financial_years: string[];
  constituencies_counted: number;
  computed_at: string;
}

/** Physical inspection coverage (R-017), as returned by `GET /quota/inspection`. */
export interface InspectionCoverage {
  /** The population: works in progress, not completed assets. */
  works_under_implementation: number;
  works_inspected: number;
  coverage_pct: number | null;
  target_pct: number;
  meets_target: boolean | null;
  window_start: string;
  window_end: string;
  /** Real field effort against works outside the population this mandate measures. */
  inspections_outside_population: number;
  computed_at: string;
}

export interface HeatmapPoint {
  date: string;
  count: number;
  worksSanctioned: number;
  worksCompleted: number;
  payments: number;
  inspections: number;
}

export interface HealthReport {
  id: string;
  work_id: string;
  reported_by: string;
  report_date: string;
  progress_pct: number;
  evidence_image_key?: string;
  remarks?: string;
  created_at: string;
}

/**
 * One month of corpus activity, as returned in `DashboardStats.trend`.
 *
 * Each field is keyed off a column that actually carries a date:
 *
 * - `sanctioned` — `works.sanctioned_amount` bucketed by `works.sanction_date`
 * - `completed` — works bucketed by `works.actual_completion_date`
 * - `released` — `payments.amount` bucketed by `payments.payment_date`, which is why
 *   this comes from the payment rows and not from `works.released_amount`: that column
 *   is a running total with no date, so it cannot be attributed to a month
 * - `alerts_opened` — `alerts.created_at`
 * - `alerts_resolved` — `alerts.reviewed_at`, i.e. alerts an officer has acted on
 *
 * **There is deliberately no `expenditure`.** `works.expenditure` is a scalar with no
 * associated date anywhere in the schema, so no month can be attributed to it. The
 * overview chart previously plotted a six-month expenditure curve from literal
 * figures; the honest version plots the two series that have dates and says the third
 * is not available.
 */
export interface TrendPoint {
  /** `YYYY-MM`. */
  month: string;
  completed: number;
  sanctioned: number;
  released: number;
  alerts_opened: number;
  alerts_resolved: number;
}

export interface DigestSummary {
  id: string;
  district_id: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  html: string;
}

// ─── Calibration & Readiness ─────────────────────────────────

export interface CalibrationSnapshot {
  id: string;
  run_at: string;
  /**
   * Completion by value. null when the corpus is empty — 0/0 is unmeasured, and an
   * empty database must not render as calibrated.
   */
  corpus_completion_rate: number | null;
  /** Completion by count. Differs from by-value by ~11 points in the real data. */
  corpus_completion_rate_by_count: number | null;
  /** 0.5071 — see REFERENCE_AGGREGATES in services/calibration.ts. */
  target_completion_rate: number;
  /** 0.6188 — the by-count benchmark. Not interchangeable with the above. */
  target_completion_rate_by_count: number;
  deviation_pct: number | null;
  deviation_pct_by_count: number | null;
  /** Provenance of the benchmark, so a reader never has to trust a bare number. */
  reference: {
    period_start: string;
    period_end: string;
    source: string;
  };
  by_category: Record<string, {
    corpus_pct: number;
    /** null scheme-wide: the published aggregates carry no category split. */
    reference_pct: number | null;
  }>;
  by_state: Record<string, {
    corpus_pct: number;
  }>;
  /**
   * The vintage-adjusted reading of the published figures. Attached by
   * `GET /insight/calibration`, not stored on the row — it is arithmetic over
   * constants, so `calibration_snapshots` has no columns for it.
   *
   * Optional for exactly that reason: a snapshot read straight from the table does
   * not carry it. `computeCalibration` must not set it, or the insert fails on
   * unknown columns.
   */
  vintage_adjustment?: VintageAdjustment;
}

/**
 * Completion measured against sanctioned value whose deadline has passed.
 *
 * Mirrors `VintageAdjustment` in `services/calibration.ts`, which is the authority.
 * The published 50.71% divides completions by *all* value sanctioned in the window,
 * including works sanctioned weeks before it closed whose one-year deadline had not
 * arrived — so part of what it measures is the shape of the sanction curve. Against
 * matured value only the rate is ~78.66% and ~₹919 Cr is genuinely overdue.
 *
 * `assumption` and `count_basis_note` are payload fields, not documentation: the
 * uniform-accrual assumption is load-bearing and the count basis saturates near 96%,
 * and a client rendering the rate without either would overstate what it knows.
 */
export interface VintageAdjustment {
  matured_fraction: number;
  matured_sanctioned_cr: number;
  completed_cr: number;
  adjusted_rate_by_value: number;
  unadjusted_rate_by_value: number;
  overdue_cr: number;
  deadline_days: number;
  assumption: string;
  count_basis_note: string;
}

// ReadinessItem lives in `services/readiness.ts` alongside the mapping it describes,
// so the shape and the rows cannot drift apart.

// ─── Meta ────────────────────────────────────────────────────

export interface MetaResponse {
  schema_version: string;
  demo_mode: boolean;
  is_synthetic: boolean;
  districts: District[];
  total_works: number;
  last_ingest: string | null;
  server_time: string;
}
