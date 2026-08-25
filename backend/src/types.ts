/**
 * MPLADS Insight & Integrity Platform — Canonical Types
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

export const PLANTED_ANOMALY_TYPES = [
  'COST_OUTLIER',
  'DELAYED_BEYOND_SCHEME',
  'STALLED_NO_PROGRESS',
  'DUPLICATE_WORK',
  'PHOTO_REUSE',
  'MONEY_AHEAD_OF_PROGRESS',
  'MISSING_UC',
  'INELIGIBLE_CATEGORY',
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

export interface Payment {
  id: string;
  work_id: string;
  amount: number;
  payment_date: string;
  installment_number: number;
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

export interface EvaluationRun {
  id: string;
  run_at: string;
  seed: number;
  total_works: number;
  total_planted: number;
  total_alerts: number;
  precision: number;
  recall: number;
  f1: number;
  per_type: Record<PlantedAnomalyType, {
    planted: number;
    detected: number;
    false_positives: number;
    precision: number;
    recall: number;
  }>;
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

export interface DashboardStats {
  total_works: number;
  completed_works: number;
  completion_rate_by_count: number;
  total_sanctioned: number;
  total_expenditure: number;
  completion_rate_by_value: number;
  open_alerts: number;
  backlog_alerts: number;
  alerts_by_severity: Record<SeverityLevel, number>;
  works_by_status: Record<WorkStatus, number>;
  works_by_category: Record<string, number>;
  trend: TrendPoint[];
}

export interface SLAStats {
  total: number;
  breached: number;
  atRisk: number;
  safe: number;
  avgDays: number;
}

export interface QuotaStats {
  totalSanctioned: number;
  scspSanctioned: number;
  tspSanctioned: number;
  scspPercentage: number;
  tspPercentage: number;
  scspTarget: number;
  tspTarget: number;
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

export interface TrendPoint {
  month: string;   // YYYY-MM
  completed: number;
  sanctioned: number;
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
  corpus_completion_rate: number;
  target_completion_rate: number;
  deviation_pct: number;
  by_category: Record<string, {
    corpus_pct: number;
    reference_pct: number | null;
  }>;
  by_state: Record<string, {
    corpus_pct: number;
  }>;
}

export interface ReadinessItem {
  column: string;
  description: string;
  mapped: boolean;
  source_field: string | null;
  notes: string;
}

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
