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
  /** Nullable on rows created before migration 013 added the column. */
  content_type: string | null;
  size_bytes: number | null;
  /** sha256 of the stored bytes. Duplicates are reported, never blocked. */
  content_sha256: string | null;
}

// ─── Document AI (P-04) ──────────────────────────────────────
//
// Mirrors `backend/src/services/documents.ts`. Two things about these shapes are load-bearing
// and easy to erode:
//
// Every extracted field is nullable, and null means "not read", never zero and never "absent
// from the document". Rendering a null as 0 or as an empty amount would turn a failed reading
// into a factual claim about a certificate.
//
// A finding's `check_id` is `D-0xx`, not `R-0xx`. These are document-versus-record
// comparisons — arithmetic over an extracted field and a portal field — not catalogued rules.
// They raise no alerts, do not enter the per-district alert budget, and are not scored
// against the evaluation answer key. The UI must not present them in a way that implies the
// measured precision of the rule engine covers them.

/** What `GET /api/documents/status` answers. Check before rendering an upload control. */
export interface DocumentAiStatus {
  available: boolean;
  /** Present when `available` is false. Show it; do not render a generic error. */
  reason: string | null;
  model: string | null;
  /** The honest capability label, e.g. "Tier 1 — multimodal extraction…". Render verbatim. */
  tier: string;
  /** The kinds this platform can read. A `type` outside this list gets no extraction. */
  document_kinds: readonly string[];
  accepted_mime_types: readonly string[];
  /** The model's inline ceiling. `max_upload_bytes` is the storage bucket's. */
  max_bytes: number;
  max_upload_bytes: number;
}

export interface DocumentCheck {
  id: string;
  description: string;
}

/** One model reading of one file. Append-only: a re-extraction supersedes, never overwrites. */
export interface DocumentExtraction {
  id: string;
  document_id: string;
  work_id: string;
  doc_kind: string;
  model: string;
  latency_ms: number | null;
  certified_amount: number | null;
  certificate_date: string | null;
  sanction_reference: string | null;
  work_reference: string | null;
  agency_named: string | null;
  signatory_name: string | null;
  signatory_designation: string | null;
  period_from: string | null;
  period_to: string | null;
  /**
   * Countable completeness, in place of a confidence score. A model's self-reported
   * confidence has no calibration on this corpus; "5 of 6 fields read" is checkable.
   */
  fields_found: number;
  fields_expected: number;
  /**
   * The D-checks that could actually run against this reading. A fact about the comparison;
   * `fields_found` is a fact about the model, and the two are not interchangeable —
   * `sanction_reference`, `work_reference` and `signatory_name` all count toward
   * `fields_found` but no D-check reads any of them. Gate "was anything compared?" on this.
   *
   * `[]` is a measured result: nothing could be compared. `null` means the extraction
   * predates migration 016, so nothing was recorded — never that nothing ran.
   *
   * Optional, not merely nullable, and that is deliberate. `db.ts` selects '*', which cannot
   * return a column the database does not have, so wherever migration 016 is unapplied the key
   * is absent from the row and this is `undefined`. Declaring it non-optional let a strict
   * `!== null` guard typecheck and then throw on `.length` at render. Narrow with
   * `Array.isArray()`.
   */
  checks_run?: string[] | null;
  raw_transcript: string | null;
  superseded_at: string | null;
  extracted_by: string;
  extracted_at: string;
}

export interface DocumentFinding {
  id: string;
  extraction_id: string;
  work_id: string;
  /** `D-001` … `D-008`. Resolve the description via `api.documents.checks()`. */
  check_id: string;
  severity: SeverityLevel;
  detail: string;
  /** Both sides as printed strings, so the officer can see what was compared. */
  document_value: string | null;
  portal_value: string | null;
  deviation_pct: number | null;
  /**
   * `SUPERSEDED` is set by the backend when a re-read replaces the extraction a finding belongs
   * to (`documents.ts`), and is reachable on the current extraction through the non-transactional
   * rollback path. It belongs in the union so the compiler forces every status-reading surface to
   * handle it — a binary accepted/dismissed ternary would otherwise print it as a dismissal
   * attributed to an officer who never touched it. Matches `PhotoFinding` below.
   */
  status: 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'SUPERSEDED';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * A document with its current extraction and that extraction's findings — the row shape
 * `GET /api/documents?work_id=…` returns. Flattened, matching the backend.
 */
export interface DocumentBundle extends Document {
  /** Null until someone runs extraction. Not a failure state. */
  extraction: DocumentExtraction | null;
  /**
   * Findings belong to an extraction, so a superseded reading's findings are absent here.
   * Empty therefore means either "nothing found" or "nothing extracted yet" — read
   * `extraction` to tell which.
   */
  findings: DocumentFinding[];
  /** Null when `type` names no kind this platform can read. Extraction will refuse. */
  readable_kind: string | null;
}

// ─── Photo AI (P-06) ─────────────────────────────────────────
//
// Mirrors `backend/src/services/photos.ts` and migration 014 — the photo counterpart of the
// Document AI shapes above, and the same two properties are load-bearing:
//
// EXIF coordinates are nullable, and null means the image carried no geotag — NEVER 0. (0, 0)
// is a real point in the ocean; rendering it as a location would invent one. A blind reading's
// asset_category / construction_stage / integrity_concern are likewise nullable, and null means
// the model could not tell — never a default.
//
// A finding's `check_id` is `V-0xx` (visual evidence), not `R-0xx` and not `D-0xx`. These are
// photo-versus-record comparisons: V-001 is deterministic geotag trigonometry, V-002/003/004
// compare a model's blind reading against the record. They raise no alerts, do not enter the
// per-district alert budget, and are not scored against the evaluation answer key.

/** A site photograph on a work, with the deterministic facts read from its bytes at upload. */
export interface WorkPhoto {
  id: string;
  work_id: string;
  caption: string | null;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  /** sha256 of the stored bytes. Byte-identical reuse across works is reported, never blocked. */
  content_sha256: string;
  /** Decimal degrees, or null when the image carried no geotag. Never 0 for "absent". */
  exif_latitude: number | null;
  exif_longitude: number | null;
  /** EXIF capture time (when the shutter fired), or null if the tag was absent. */
  exif_taken_at: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

/** What `GET /api/photos/status` answers. Check before rendering an upload/analyse control. */
export interface PhotoAiStatus {
  available: boolean;
  /** Present when `available` is false. Show it verbatim. */
  reason: string | null;
  model: string;
  /** Honest capability label. The reading is Tier 1; the geotag check alongside it is deterministic. */
  tier: string;
  /** The categories a blind reading may return (the 15 WORK_CATEGORIES). */
  asset_categories: readonly string[];
  /** NOT_STARTED | FOUNDATION | IN_PROGRESS | COMPLETED. */
  construction_stages: readonly string[];
  /** NONE | POSSIBLE | LIKELY — though a stored concern is only ever POSSIBLE or LIKELY. */
  integrity_levels: readonly string[];
  accepted_mime_types: readonly string[];
  /** The model's inline-read ceiling. `max_upload_bytes` is the storage bucket's. */
  max_bytes: number;
  max_upload_bytes: number;
}

export interface PhotoCheck {
  id: string;
  description: string;
}

/**
 * One vision reading of one photo. Append-only: a re-analysis supersedes, never overwrites.
 * Every observed field is nullable, and null means "the model could not tell", never a default.
 */
export interface PhotoAnalysis {
  id: string;
  photo_id: string;
  work_id: string;
  model: string;
  latency_ms: number | null;
  /** One of `asset_categories`, or null. Read blind — the model is never told the claim. */
  asset_category: string | null;
  asset_description: string | null;
  construction_stage: string | null;
  /** null | POSSIBLE | LIKELY. A literal NONE from the model is folded to null server-side. */
  integrity_concern: string | null;
  integrity_note: string | null;
  /** Countable completeness in place of a confidence score. */
  fields_found: number;
  fields_expected: number;
  /**
   * The V-checks that could actually run against this reading. A fact about the comparison;
   * `fields_found` is a fact about the model, and the two are not interchangeable —
   * `asset_description` counts toward `fields_found` but no check reads it, and V-001
   * compares the EXIF geotag with no reading at all. Gate "was anything compared?" on this.
   *
   * `[]` is a measured result: nothing could be compared. `null` means the analysis predates
   * migration 016, so nothing was recorded — never that nothing ran.
   *
   * Optional, not merely nullable, and that is deliberate. `db.ts` selects '*', which cannot
   * return a column the database does not have, so wherever migration 016 is unapplied the key
   * is absent from the row and this is `undefined`. Declaring it non-optional let a strict
   * `!== null` guard typecheck and then throw on `.length` at render. Narrow with
   * `Array.isArray()`.
   */
  checks_run?: string[] | null;
  raw_response: string | null;
  superseded_at: string | null;
  analyzed_by: string;
  analyzed_at: string;
}

export interface PhotoFinding {
  id: string;
  analysis_id: string;
  work_id: string;
  photo_id: string;
  /** `V-001` … `V-004`. Resolve the description via `api.photos.checks()`. */
  check_id: string;
  severity: SeverityLevel;
  detail: string;
  /** Both sides as printed strings. observed = the photo/model; portal = the record. */
  observed_value: string | null;
  portal_value: string | null;
  /** Only V-001 carries a magnitude — the photo-to-work distance in METRES. Null otherwise. */
  deviation: number | null;
  status: 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'SUPERSEDED';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * A photo with its current analysis and that analysis's findings — the row shape
 * `GET /api/photos?work_id=…` returns. A superseded reading's findings are absent, so an empty
 * `findings` with a non-null `analysis` means "nothing found", not "not read".
 */
export interface PhotoBundle extends WorkPhoto {
  analysis: PhotoAnalysis | null;
  findings: PhotoFinding[];
}

// ─── Inspection evidence vs the work record (P-10) ───────────
//
// Mirrors `backend/src/services/inspection_reconcile.ts` and `inspection_compare.ts`. An
// inspector visits a site, records a GPS fix, a verdict and a date; the photo pipeline leaves
// geotagged, timestamped images. These types carry the comparison of those field facts against
// the work as the record has it.
//
// Same standing as D-0xx and V-0xx above, and worth restating because it is the easiest thing to
// erode: an I-finding raises no alert, does not enter the per-district alert budget, carries no
// verification_status, and is not scored against the evaluation answer key. It is a worklist for
// a human, not a verdict about a work.
//
// Unlike its two siblings there is no upload and no model — every check is a distance, a date
// subtraction or an equality over values already on record.

/** `I-001` … `I-004`, with the one-line statement of what each looks for. */
export interface InspectionCheck {
  id: string;
  description: string;
}

/** What `GET /api/inspections/status` answers. */
export interface InspectionEvidenceStatus {
  /**
   * Unconditionally true, unlike the photo and document counterparts: this feature calls no
   * model and needs no credential, so there is no configuration in which it cannot run. Read
   * anyway, so the panel's pre-render check is uniform across all three features.
   */
  available: boolean;
  reason: string | null;
  tier: string;
  checks: InspectionCheck[];
}

/**
 * One comparison run of one inspection. Append-only: re-comparing supersedes, never overwrites,
 * because the previous run is the evidence for what an officer saw when they accepted a finding.
 */
export interface InspectionComparison {
  id: string;
  inspection_id: string;
  work_id: string;
  /**
   * The photographic corpus this run had. Three counts, not one: "no photos" and "photos, none
   * geotagged" fail different checks, and an officer reading a clean result deserves to know
   * which. Never inferred back out of `checks_run`.
   */
  photos_on_record: number;
  photos_with_geotag: number;
  photos_with_timestamp: number;
  /**
   * The I-checks that were able to run. This — not the photo counts — is what "was anything
   * compared?" must be gated on: I-002 compares the inspector's verdict against the work status
   * and runs with no photographs at all.
   *
   * `[]` is a measured result: nothing could be compared. `null` means nothing was recorded —
   * never that nothing ran. `compareInspection` always writes this, so a NULL means the row was
   * written by something else: a backfill, a data repair, a hand-written insert.
   *
   * Optional, not merely nullable, for the same reason as `PhotoAnalysis.checks_run`, and
   * narrowed the same way. `Array.isArray()` covers both the SQL NULL the column permits and the
   * `undefined` that `db.ts`'s `select('*')` yields for an absent column; a strict `!== null`
   * typechecks and then throws on `.length` at render. One idiom across all three panels.
   */
  checks_run?: string[] | null;
  superseded_at: string | null;
  compared_by: string;
  compared_at: string;
}

export interface InspectionFinding {
  id: string;
  comparison_id: string;
  inspection_id: string;
  work_id: string;
  /** The photograph I-001 keyed on, so the officer can open it. Null for the other checks. */
  photo_id: string | null;
  /** `I-001` … `I-004`. Resolve the description via `api.inspections.checks()`. */
  check_id: string;
  severity: SeverityLevel;
  detail: string;
  /** What the inspector recorded. */
  observed_value: string | null;
  /**
   * The value compared against, and the column it came from. Deliberately not `agency_value`:
   * no column records who entered a work's status, so attributing the record side to an author
   * would be a fabrication. Render the column name, never a person.
   */
  record_value: string | null;
  record_source: string | null;
  deviation: number | null;
  /**
   * `METRES` or `DAYS`. Read the unit off the row — do not infer it from `check_id`. Two of the
   * four checks measure a distance and one measures a lag in days; a panel that guesses renders
   * "40 days" as "40 metres" the first time a check id moves.
   */
  deviation_unit: string | null;
  status: 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'SUPERSEDED';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/**
 * An inspection with its current comparison and that comparison's findings — the row shape
 * `GET /api/inspections/for-work/:workId` returns.
 *
 * A `null` comparison means nobody has run the comparison yet. It does **not** mean the
 * inspection is clean, and the panel must render the two differently.
 */
export interface InspectionEvidenceBundle extends Inspection {
  comparison: InspectionComparison | null;
  findings: InspectionFinding[];
}

// ─── Semantic duplicate check (P-03) ─────────────────────────
//
// Mirrors `backend/src/services/work_embeddings.ts`. An on-demand action, not a stored feature:
// it ranks a work's same-district peers by cosine similarity of their descriptive-text
// embeddings and returns the matches inline. Nothing is persisted as a finding, there is no
// worklist and no catalogue — unlike Document AI (D-0xx) and Photo AI (V-0xx) above.
//
// Three properties are load-bearing and easy to erode:
//
// It raises NO alerts. It writes nothing to `alerts`, touches no district alert budget, and is
// not scored against the evaluation answer key. It complements the deterministic R-009 detector
// (which matches shared title tokens) by catching duplicates whose wording differs — and where
// R-009 *also* flagged a pair, `also_flagged_by_r009` says so, so the two signals agree visibly
// rather than competing. The UI must not present a candidate as a rule alert.
//
// `distance_m` and `amount_diff_pct` are nullable, and null means "could not be computed", never
// zero. A null `distance_m` means one of the two works has no geotag — (0, 0) is a real point in
// the ocean, and 0 metres means the two sit at the same coordinates. A null `amount_diff_pct`
// means an amount could not be read; 0 means the two sanctioned amounts are identical, which is
// itself a duplicate signal. Rendering either null as 0 would fabricate a fact.
//
// No field carries an MP's name (Doctrine 3); a candidate is a work, a category and a location.

/** What `GET /api/works/duplicate-check/status` answers. Check before rendering the run control. */
export interface DuplicateCheckCapability {
  available: boolean;
  /**
   * Present (non-null) exactly when `available` is false. Show it verbatim: it names the
   * credential to set and reassures that the deterministic R-009 detector is unaffected.
   */
  reason: string | null;
  model: string;
  /** The pinned output dimensionality, or null when the model's default is used. */
  dims: number | null;
  /** The default cosine threshold a peer must clear to be returned (0.8). */
  default_threshold: number;
  /** Honest capability label; it states the check raises no alerts. Render verbatim. */
  tier: string;
}

/** One ranked peer in a duplicate-check result. Mirrors `DuplicateCandidate`. */
export interface DuplicateCandidate {
  work_id: string;
  title: string;
  category: string;
  location_name: string;
  /** Cosine similarity of the two works' text embeddings, 0..1, already rounded for display. */
  similarity: number;
  /**
   * Metres between the two works, or null when either lacks a geotag. Never 0 for a missing
   * coordinate — (0, 0) is a real point in the Gulf of Guinea. A real 0 means the same point.
   */
  distance_m: number | null;
  /**
   * Relative gap between sanctioned amounts as a percentage, or null when either amount is
   * missing/unreadable. 0 is a real value — the two amounts are identical — distinct from null.
   */
  amount_diff_pct: number | null;
  /** True when the deterministic R-009 detector already flagged this exact pair. */
  also_flagged_by_r009: boolean;
}

/** What `POST /api/works/:id/duplicate-check` returns. Mirrors `DuplicateCheckResult`. */
export interface DuplicateCheckResult {
  work_id: string;
  model: string;
  dims: number;
  /** The threshold actually applied, after clamping the request to 0..1. */
  threshold: number;
  /**
   * How many same-district peers had a dimension-compatible vector and were actually scored —
   * the honest denominator. `compared` 0 means nothing was comparable to check against, distinct
   * from `compared` > 0 with no candidates, which means "checked, nothing similar".
   */
  compared: number;
  candidates: DuplicateCandidate[];
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
