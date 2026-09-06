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
 * The anomaly types the answer key can hold. Mirrors `backend/src/types.ts`; the
 * generator's `GROUND_TRUTH` table is the only writer.
 *
 * Each is named after the condition and paired with the rule expected to catch it.
 * The previous list named eight types nothing wrote and omitted every type that is
 * written.
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
   * Doctrine 3 — no MP-level risk aggregation. Declared to mirror the backend
   * shape, never rendered. Do not put these on a screen, a filter, a chart axis
   * or a sort key. The accountability units in this UI are the agency and the
   * district.
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
  constituency_id: string | null;
  agency_id: string | null;
  /** Doctrine 3 — inert, as on Constituency above. Never rendered. */
  mp_name: string;
  esakshi_work_id: string | null;

  // Description
  title: string;
  description: string | null;
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
  sanction_date: string;
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
 * events but not say what any of them was for. `stage` says what the money was
 * for, `sequence_number` says where it sits in the history.
 */
export interface Payment {
  id: string;
  work_id: string;
  amount: number;
  payment_date: string;
  /** MOBILISATION_ADVANCE | RUNNING_BILL | FINAL_BILL | RETENTION_RELEASE */
  stage: string;
  /** Position in this work's payment history, 1-based. */
  sequence_number: number;
  /** PFMS/SNA settlement reference. Null until reconciled. */
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

export interface AnswerKeyEntry {
  id: string;
  work_id: string;
  anomaly_type: string;
  description: string;
  expected_rule_id: string | null;
}

/**
 * Per-anomaly-type detection metrics. Mirrors `backend/src/types.ts`.
 *
 * There is deliberately no per-type `precision`: a false positive is an alert on a
 * work that was never planted, so it belongs to no planted anomaly type and cannot
 * be attributed to one.
 */
export interface TypeMetrics {
  planted: number;
  detected: number;
  true_positives: number;
  false_negatives: number;
  /** null when nothing of this type was planted. */
  recall: number | null;
}

export interface EvaluationRun {
  id: string;
  run_at: string;
  seed: number;
  total_works: number;
  total_planted: number;
  total_alerts: number;
  /** Rules the answer key has ground truth for. Precision is computed over these only. */
  covered_rule_ids: string[];
  /** Alerts from rules outside `covered_rule_ids` — neither credited nor penalised. */
  unscored_alerts: number;
  /** null when the metric's denominator is zero — i.e. not measurable, not 0. */
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
  overall_status: string;
  items?: InspectionItem[];
  notes: string | null;
  photo_keys?: string[];
  synced: boolean;
  created_at: string;
}

export interface InspectionItem {
  id?: string;
  inspection_id?: string;
  checklist_id: string;
  checked: boolean;
  note?: string | null;
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
   * Mirrors `RuleDefinition` in `backend/src/types.ts`, and the backend serves it
   * straight from `mplads_rules.yaml`. A rule can be enabled, correctly implemented,
   * and still structurally unable to produce an alert because the field it reads has
   * no writer — R-010 compares `works.evidence_image_key` and nothing populates that
   * column.
   *
   * The UI must render this. A CRITICAL anti-fraud rule shown as active and never
   * firing reads as "no photo reuse in this corpus", which is a finding the platform
   * has not made.
   */
  dormant_reason?: string;
}

export type RuleConfig = RuleDefinition;

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

export interface CalibrationSnapshot {
  id: string;
  run_at: string;
  /** null when the corpus is empty. Render as '—', never as a fallback number. */
  corpus_completion_rate: number | null;
  corpus_completion_rate_by_count: number | null;
  /** 0.5071 by value; 0.6188 by count. Two different benchmarks, not one. */
  target_completion_rate: number;
  target_completion_rate_by_count: number;
  deviation_pct: number | null;
  deviation_pct_by_count: number | null;
  reference: {
    period_start: string;
    period_end: string;
    source: string;
  };
  by_category: Record<string, { corpus_pct: number; reference_pct: number | null }>;
  by_state: Record<string, { corpus_pct: number }>;
  /**
   * Attached by `GET /insight/calibration`, not stored on the snapshot row — it is
   * arithmetic over the published constants. Optional because a row read straight
   * from the table does not carry it.
   */
  vintage_adjustment?: VintageAdjustment;
}

/**
 * Completion against sanctioned value whose deadline has passed. Mirrors
 * `VintageAdjustment` in `backend/src/types.ts`.
 *
 * `assumption` and `count_basis_note` are strings the API sends, not comments —
 * render `assumption` wherever `adjusted_rate_by_value` appears. The rate is an
 * estimate resting on uniform accrual across the reference window, and detaching the
 * two turns an estimate into a claim.
 */
export interface VintageAdjustment {
  /** Share of the reference window whose sanctions have reached their deadline. */
  matured_fraction: number;
  matured_sanctioned_cr: number;
  completed_cr: number;
  /** ~0.7866. */
  adjusted_rate_by_value: number;
  /** ~0.5071 — the published headline, for contrast. */
  unadjusted_rate_by_value: number;
  /** ₹ crore past deadline and not recorded complete. ~919. */
  overdue_cr: number;
  deadline_days: number;
  assumption: string;
  /** Why there is no count-basis figure. Do not compute one. */
  count_basis_note: string;
}

export interface DigestSummary {
  id: string;
  district_id: string;
  generated_at: string;
  period_start: string;
  period_end: string;
  html: string;
}

// ─── Public View (whitelist — doctrine #4) ──────────────────

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
  sanction_date: string;
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

export interface MetaResponse {
  schema_version: string;
  demo_mode: boolean;
  is_synthetic: boolean;
  districts: District[];
}

/**
 * Mirrors `DashboardStats` in `backend/src/types.ts` — the response of `GET /dashboard`.
 *
 * This declaration used to disagree with the backend in both directions, which is
 * worse than being merely incomplete: it declared `total_released` and
 * `in_progress_works`, neither of which the router sends, so reading either gave
 * `undefined` typed as `number` — arithmetic on it yields `NaN` and a rendered
 * "NaN%" rather than a type error. And it omitted `works_by_status`,
 * `alerts_by_severity`, `works_by_category` and `trend`, all of which are sent, so a
 * page wanting the status breakdown appeared to have to re-fetch it.
 *
 * Keep the two in sync. `frontend/src/types.ts` is a mirror, not a second opinion.
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
  /** OPEN and BACKLOG alerts only. */
  alerts_by_severity: Record<SeverityLevel, number>;
  works_by_status: Record<WorkStatus, number>;
  works_by_category: Record<string, number>;
  /**
   * Total released to implementing agencies — the sum of `works.released_amount`.
   *
   * `OverviewPage.tsx` rendered "Released to Agencies" as `total_sanctioned * 0.62` in
   * two places while this column sat unread. Use this field; do not reintroduce a
   * ratio.
   */
  total_released: number;
  /** `null` when the corpus has nothing dated to roll up. Never chart null as zero. */
  trend: TrendPoint[] | null;
}

/**
 * One month of corpus activity. Mirrors `TrendPoint` in `backend/src/types.ts`.
 *
 * `released` is bucketed from `payments.payment_date`, not from
 * `works.released_amount` — that column is a running total with no date. There is
 * deliberately **no `expenditure`**: `works.expenditure` is a scalar with no date
 * anywhere in the schema, so no month can be attributed to it. Do not add one back;
 * the previous overview chart plotted an expenditure curve from six literal figures.
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

// ─── Feature-specific types ─────────────────────────────────

export interface HeatmapPoint {
  date: string;
  count: number;
  category?: string;
  worksSanctioned?: number;
  worksCompleted?: number;
  payments?: number;
  inspections?: number;
}

/**
 * SC/ST reservation compliance (R-016), as returned by `GET /api/quota`.
 *
 * Mirrors `backend/src/types.ts`. Replaces a `QuotaStats` shape whose denominator was
 * the portfolio's own sanctioned total; the mandate is a share of the MP's entitlement,
 * so the fields name the entitlement. A percentage is `null` — never 0 — when no
 * entitlement period exists to measure against, and `CompliancePage` renders that as
 * '—' rather than as a number.
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

/** Physical inspection coverage (R-017), as returned by `GET /api/quota/inspection`. */
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

/**
 * Sanction-decision SLA statistics, as returned by `GET /sla/stats`.
 *
 * Mirrors `SLAStats` in `backend/src/types.ts`. The previous shape here declared
 * `stage`, `avg_days` and `target_days` — three fields the endpoint has never
 * sent — alongside `avgDays`, so a page reading `avg_days` would have typechecked
 * and rendered `undefined`.
 *
 * `breached`/`atRisk`/`safe` are works still awaiting a decision. `rejected` and
 * `notTrackable` are works that are not awaiting one: a rejection is a decision
 * (its date is not recorded, so its lag is unknown), and a work with no
 * recommendation date has no clock start.
 */
export interface SLAStats {
  total: number;
  breached: number;
  atRisk: number;
  safe: number;
  rejected: number;
  notTrackable: number;
  /** Null when nothing measurable is pending — render as '—', not as 0. */
  avgDays: number | null;
  measuredCount: number;
  limitDays: number;
  warningDays: number;
}

/**
 * One implementing agency's workload and delivery pacing, as returned by
 * `GET /api/agencies`. Mirrors `AgencyProfile` in
 * `backend/src/services/agency_performance.ts`.
 *
 * Doctrine 3 permits this: the doctrine bars aggregating risk to a named Member of
 * Parliament and says nothing about agencies, which is where execution accountability
 * sits. No field here carries an MP's name.
 *
 * Every `| null` means unmeasured and must render as '—'. `pacing_index` in particular
 * is null whenever the agency has completed no work the expectation model could size,
 * and a null must never be shown as 1.0 or sorted as though it were fastest.
 */
export interface AgencyProfile {
  agency_id: string;
  agency_name: string;
  agency_type: string;
  district_id: string | null;

  works_total: number;
  works_completed: number;
  works_in_progress: number;
  works_not_started: number;
  works_on_hold: number;
  works_cancelled: number;

  sanctioned_inr: number;
  expenditure_inr: number;

  completion_rate_by_count: number | null;
  completion_rate_by_value: number | null;

  /** Descriptive only. Comparing it across agencies compares their work mixes. */
  median_days_to_complete: number | null;

  /**
   * Actual days over expected days on comparable work. 1.0 = the corpus median for
   * this agency's own mix; above 1.0 = slower than peers doing similar work.
   */
  pacing_index: number | null;
  pacing_works_measured: number;
  pacing_works_unmeasured: number;

  /** OPEN and BACKLOG alerts on this agency's works. Not a risk score. */
  open_alerts: number;
}

/** Mirrors `AgencyPerformanceReport` in `backend/src/services/agency_performance.ts`. */
export interface AgencyPerformanceReport {
  agencies: AgencyProfile[];
  agencies_with_works: number;
  agencies_without_works: number;
  /** Works with a null `agency_id` — real works absent from every row. */
  works_unattributed: number;
  expectation_basis_works: number;
  expectation_cells: number;
  corpus_median_days: number | null;
  min_cell_size: number;
  size_bands: { id: string; label: string }[];
  computed_at: string;
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
