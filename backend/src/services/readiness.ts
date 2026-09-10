/**
 * DRISHTI Proposed Integration Schema — target mapping
 *
 * This is a mapping *plan*, not a certification, and it is *ours*: no official
 * MoSPI basis was located for a fixed e-SAKSHI column list, so nothing here should
 * be presented as an external requirement. It is the set of fields DRISHTI would
 * ask for, with — for each one — where the value lands in our schema and whether
 * anything actually populates it today.
 *
 * No row asserts that a capability works; every row asserts only what the code
 * does, and carries the `evidence` pointer it can be checked against.
 *
 * Verified against `backend/src/routers/ingest.ts` (the only import path).
 * If that file's column handling changes, these rows must change with it.
 */

export type MappingState =
  /** The CSV ingest reads this column today and writes the named target field. */
  | 'INGESTED'
  /** Target field exists in the schema, but no import populates it. */
  | 'NOT_INGESTED'
  /** Not a source-system column at all — a DRISHTI-internal field, listed for clarity.
   *  Also covers a column that *was* in the contract and has been retired: it is
   *  listed so a source system still emitting it can see that nothing reads it. */
  | 'OUT_OF_CONTRACT';

export interface ReadinessItem {
  /** Field name as DRISHTI would request it from the source system. */
  requested_field: string;
  description: string;
  /** Header the CSV ingest looks for, or null when nothing reads a column for this. */
  csv_column: string | null;
  target_field: string | null;
  state: MappingState;
  /** Where this row's `state` can be checked in the source. */
  evidence: string;
  notes: string;
}

const INGEST = 'backend/src/routers/ingest.ts';

export function getReadinessChecklist(): ReadinessItem[] {
  return [
    { requested_field: 'Work ID', description: 'Unique e-SAKSHI work identifier', csv_column: 'work_id', target_field: 'works.esakshi_work_id', state: 'INGESTED', evidence: `${INGEST}:85`, notes: 'Required header. Rows without it are skipped; used as the upsert conflict key.' },
    { requested_field: 'District LGD Code', description: 'Local Government Directory district code', csv_column: 'district_lgd', target_field: 'works.district_id', state: 'INGESTED', evidence: `${INGEST}:89`, notes: 'Resolved against districts.lgd_code. Unmatched codes currently fall back to the first district rather than failing the row.' },
    { requested_field: 'Constituency Code', description: 'Parliamentary constituency code', csv_column: 'constituency_code', target_field: 'works.constituency_id', state: 'INGESTED', evidence: `${INGEST}:96`, notes: 'Resolved against constituencies.lgd_code, with the same first-row fallback caveat.' },
    { requested_field: 'Work Title', description: 'Description of the proposed infrastructure', csv_column: 'work_title', target_field: 'works.title', state: 'INGESTED', evidence: `${INGEST}:118`, notes: 'Required header. Feeds title-similarity duplicate matching.' },
    { requested_field: 'Work Description', description: 'Long-form work description', csv_column: 'work_description', target_field: 'works.description', state: 'INGESTED', evidence: `${INGEST}:119`, notes: 'Optional; defaults to a placeholder when absent.' },
    { requested_field: 'Category', description: 'MPLADS sector category', csv_column: 'category', target_field: 'works.category', state: 'INGESTED', evidence: `${INGEST}:120`, notes: 'Checked against the ineligible-category list by R-011.' },
    { requested_field: 'Sanctioned Amount', description: 'Total approved funding in INR', csv_column: 'sanctioned_amount', target_field: 'works.sanctioned_amount', state: 'INGESTED', evidence: `${INGEST}:110`, notes: 'Denominator for the cost-outlier robust z-score and for R-004/R-013.' },
    { requested_field: 'Released Amount', description: 'Funds disbursed to the implementing agency', csv_column: 'released_amount', target_field: 'works.released_amount', state: 'INGESTED', evidence: `${INGEST}:112`, notes: 'Compared against physical progress by R-002.' },
    { requested_field: 'Expenditure', description: 'Documented expenditure to date', csv_column: 'expenditure', target_field: 'works.expenditure', state: 'INGESTED', evidence: `${INGEST}:111`, notes: 'Checked for overrun against sanction by R-004.' },
    { requested_field: 'Sanction Date', description: 'Date of administrative sanction', csv_column: 'sanction_date', target_field: 'works.sanction_date', state: 'INGESTED', evidence: `${INGEST}:114`, notes: 'Anchor date for delay tracking (one-year scheme limit from sanction).' },
    { requested_field: 'Recommended Date', description: 'Date the MP recommended the work', csv_column: 'recommended_date', target_field: 'works.recommended_date', state: 'INGESTED', evidence: `${INGEST}:154`, notes: 'Falls back to sanction_date, then today, when the column is absent. Anchor for the sanctioning SLA.' },
    { requested_field: 'Completion Date', description: 'Actual physical completion date', csv_column: 'completion_date', target_field: 'works.actual_completion_date', state: 'INGESTED', evidence: `${INGEST}:115`, notes: 'Starts the 90-day Utilisation Certificate grace timer used by R-003.' },
    { requested_field: 'Status', description: 'Administrative and physical lifecycle state', csv_column: 'status', target_field: 'works.status', state: 'INGESTED', evidence: `${INGEST}:109`, notes: 'Taken verbatim; defaults to PROPOSED. Not yet validated against the internal enum.' },
    { requested_field: 'Physical Progress (%)', description: 'Reported physical progress percentage', csv_column: 'physical_progress_pct', target_field: 'works.physical_progress_pct', state: 'INGESTED', evidence: `${INGEST}:116`, notes: 'Self-reported by the agency. Corroboration against field inspection is a separate signal, not this column.' },
    { requested_field: 'Utilisation Certificate', description: 'UC submission indicator', csv_column: 'has_uc', target_field: 'works.has_uc', state: 'INGESTED', evidence: `${INGEST}:122`, notes: 'Parsed as the literal string "true"; any other value reads as false.' },
    { requested_field: 'Implementing Agency', description: 'Executing department or local body', csv_column: 'agency_name', target_field: 'works.agency_id', state: 'INGESTED', evidence: `${INGEST}:102`, notes: 'Matched on agency name. Unmatched names fall back to the first agency rather than failing the row.' },
    { requested_field: 'Location Name', description: 'Site or locality of the asset', csv_column: 'location_name', target_field: 'works.location_name', state: 'INGESTED', evidence: `${INGEST}:148`, notes: 'Optional; defaults to "Main Site".' },
    { requested_field: 'Latitude / Longitude', description: 'GPS coordinates of the asset', csv_column: 'latitude, longitude', target_field: 'works.latitude, works.longitude', state: 'INGESTED', evidence: `${INGEST}:126`, notes: 'Absent coordinates currently default to a Delhi centroid, which will cluster unlocated works together.' },
    { requested_field: 'SCSP / TSP Component', description: 'Special Component Plan allocation flags', csv_column: 'is_scsp, is_tsp', target_field: 'works.is_scsp, works.is_tsp', state: 'INGESTED', evidence: `${INGEST}:123`, notes: 'Feeds the statutory SC/ST allocation check.' },
    { requested_field: 'Payment History', description: 'Stage-wise release history for the work', csv_column: 'payment_history', target_field: 'payments.*', state: 'INGESTED', evidence: `${INGEST}:60`, notes: 'Encoded as STAGE:YYYY-MM-DD:AMOUNT entries separated by "|", one cell per work, parsed by parsePaymentHistory and written by services/payments.ts. Read by R-002, R-012 and R-014, and the source of works.last_payment_date, which R-007 measures a payment stall from. Malformed entries are reported in the ingest response, never skipped. A work whose cell is empty or absent has no payment history at all, which the rules treat as unknown rather than as unpaid.' },
    { requested_field: 'First Installment Amount', description: 'Initial advance release', csv_column: 'first_installment', target_field: null, state: 'OUT_OF_CONTRACT', evidence: `${INGEST}:206`, notes: 'RETIRED from the contract. Two amount columns cannot hold an N-stage history, carry no date (so they cannot express a payment gap), and cannot be reconciled against PFMS, which settles per payment. The ingest no longer writes works.first_installment; it counts rows that still carry a value and reports them as legacy_installment_rows_ignored. Not converted into payment rows — neither column has a date, and a converted row would need one invented, which would corrupt the very stall arithmetic this change exists to fix.' },
    { requested_field: 'Second Installment Amount', description: 'Subsequent instalment release', csv_column: 'second_installment', target_field: null, state: 'OUT_OF_CONTRACT', evidence: `${INGEST}:207`, notes: 'RETIRED from the contract, on the same grounds as the first instalment. Supply payment_history instead.' },
    { requested_field: 'Inspection Status', description: 'Official field verification status', csv_column: null, target_field: 'inspections.overall_status', state: 'NOT_INGESTED', evidence: `${INGEST}:139`, notes: 'The CSV ingest reads no inspection column and writes only the works table. Inspection rows come from the DRISHTI field app, so this cannot be imported from e-SAKSHI today.' },
    { requested_field: 'Photo Hash Key', description: 'Perceptual image hash for the geotagged asset', csv_column: null, target_field: 'works.evidence_image_key', state: 'NOT_INGESTED', evidence: 'backend/src/detectors/photo_reuse.ts:14', notes: 'The column exists in the schema and the photo-reuse detector R-010 reads it, but nothing writes works.evidence_image_key — not the ingest, not the generator — so R-010 cannot fire on current data and stays dormant. P-06 (Evidence Photo Verification) does not populate it: P-06 works on photographs uploaded through /api/photos and covers only byte-exact reuse — an identical file posted against two works, caught deterministically by work_photos.content_sha256 at upload — plus per-photo visual checks (geotag proximity, and a blind reading of category and construction stage). Perceptual near-duplicate reuse — the same asset re-photographed, or a resized copy, which changes the bytes but not the picture — still needs this hash, and it is still unpopulated. No P-06 row is added to this checklist: an uploaded evidence photo is a DRISHTI-internal artefact, not an e-SAKSHI source column, so listing it as a requested source field would be a category error.' },
    { requested_field: 'Audit Signature', description: 'Cryptographic hash chain anchor', csv_column: null, target_field: 'audit_events.this_hash', state: 'OUT_OF_CONTRACT', evidence: 'backend/src/services/audit_chain.ts', notes: 'Not an e-SAKSHI column. This is DRISHTI’s own append-only ledger over actions taken inside DRISHTI; e-SAKSHI neither supplies nor receives it.' },
  ];
}
