/**
 * Readiness Service
 *
 * Tracks the 21-column e-SAKSHI data contract integration checklist.
 */

export interface ReadinessItem {
  column: string;
  description: string;
  mapped: boolean;
  source_field: string;
  notes: string;
  status: 'READY' | 'MAPPED' | 'IN_PROGRESS';
}

export function getReadinessChecklist(): ReadinessItem[] {
  return [
    { column: 'Work ID', description: 'Unique e-SAKSHI work identifier', mapped: true, source_field: 'esakshi_work_id', notes: 'Maps directly to esakshi_work_id with unique constraint', status: 'READY' },
    { column: 'District LGD Code', description: 'Local Government Directory district code', mapped: true, source_field: 'districts.lgd_code', notes: 'Foreign key lookup to districts table', status: 'READY' },
    { column: 'Constituency Code', description: 'Assembly/Parliamentary constituency code', mapped: true, source_field: 'constituencies.lgd_code', notes: 'Mapped via constituency reference', status: 'READY' },
    { column: 'Work Title', description: 'Standard description of proposed infrastructure', mapped: true, source_field: 'title', notes: 'Used for NLP and duplicate text matching', status: 'READY' },
    { column: 'Category', description: 'MPLADS sector category', mapped: true, source_field: 'category', notes: 'Validated against eligibility whitelist', status: 'READY' },
    { column: 'Sanctioned Amount', description: 'Total approved funding in INR', mapped: true, source_field: 'sanctioned_amount', notes: 'Used for cost outlier robust z-score calculation', status: 'READY' },
    { column: 'Released Amount', description: 'Total funds disbursed to implementing agency', mapped: true, source_field: 'released_amount', notes: 'Compared against progress percentage for release pacing', status: 'READY' },
    { column: 'Expenditure', description: 'Total documented expenditure to date', mapped: true, source_field: 'expenditure', notes: 'Checked for cost overruns against sanction', status: 'READY' },
    { column: 'Sanction Date', description: 'Date of administrative sanction', mapped: true, source_field: 'sanction_date', notes: 'Anchor date for delay tracking (24-month limit)', status: 'READY' },
    { column: 'Completion Date', description: 'Actual physical completion date', mapped: true, source_field: 'actual_completion_date', notes: 'Triggers 90-day Utilisation Certificate grace timer', status: 'READY' },
    { column: 'Status', description: 'Current administrative & physical lifecycle state', mapped: true, source_field: 'status', notes: 'Enum: NOT_STARTED, IN_PROGRESS, COMPLETED, ON_HOLD, CANCELLED', status: 'READY' },
    { column: 'Physical Progress (%)', description: 'Verified physical progress percentage', mapped: true, source_field: 'physical_progress_pct', notes: 'Corroborated with field inspection reports and photos', status: 'READY' },
    { column: 'Utilisation Certificate', description: 'UC submission indicator', mapped: true, source_field: 'has_uc', notes: 'Mandatory compliance checkpoint for completed works', status: 'READY' },
    { column: 'Implementing Agency', description: 'Executing department or local body', mapped: true, source_field: 'agencies.name', notes: 'Agency performance tracking and workload analysis', status: 'READY' },
    { column: 'Latitude / Longitude', description: 'GPS coordinates of project asset', mapped: true, source_field: 'latitude, longitude', notes: 'Enables spatial clustering and geo-proximity duplicate matching', status: 'READY' },
    { column: 'SCSP / TSP Component', description: 'Special Component Plan allocation flags', mapped: true, source_field: 'is_scsp, is_tsp', notes: 'Monitored for 15% SC / 7.5% ST statutory compliance', status: 'READY' },
    { column: 'First Installment Amount', description: 'Initial mobilization advance', mapped: true, source_field: 'first_installment', notes: 'Monitored for prompt release after sanction', status: 'READY' },
    { column: 'Second Installment Amount', description: 'Subsequent installment release', mapped: true, source_field: 'second_installment', notes: 'Verified against >50% milestone progress', status: 'READY' },
    { column: 'Inspection Status', description: 'Official field verification status', mapped: true, source_field: 'inspections.overall_status', notes: 'Integrated with offline PWA inspection sync', status: 'READY' },
    { column: 'Photo Hash Key', description: 'Perceptual image hash for geotagged asset', mapped: true, source_field: 'evidence_image_key', notes: 'Cross-work perceptual hash comparison (Hamming distance)', status: 'READY' },
    { column: 'Audit Signature', description: 'Cryptographic hash chain anchor', mapped: true, source_field: 'audit_events.this_hash', notes: 'Guarantees append-only immutable ledger transparency', status: 'READY' },
  ];
}
