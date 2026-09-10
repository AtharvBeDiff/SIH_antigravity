/**
 * Document reconciliation — where the certificate and the portal record disagree.
 *
 * The second half of P-04, and the half that produces the finding. `document_ai.ts` reads
 * fields off a page; this file compares them against the work as e-SAKSHI has it and
 * returns **only the disagreements**. A document that agrees with the record produces an
 * empty array, and that is the intended common case: the officer's queue should contain
 * the six certificates worth looking at, not all four hundred.
 *
 * ## Not a model, and not a rule either
 *
 * Every check below is subtraction, date ordering, or string comparison. No model is
 * consulted — a model asked "do these disagree?" would answer confidently and
 * unauditably, whereas `|8.2L − 11.6L| / 11.6L = 29%` can be recomputed by anyone reading
 * the finding. This is why the UI labels extraction Tier 1 and the comparison plainly as
 * arithmetic: they carry different kinds of trust and collapsing them would overclaim one
 * and underclaim the other.
 *
 * They are also **not** catalogued rules. `check_id` values are `D-0xx`, not `R-0xx`, and
 * that prefix is load-bearing: these produce no `alerts` rows, do not enter the
 * per-district alert budget, carry no `verification_status`, and are never scored against
 * `answer_key`. A finding here is a discrepancy between two documents about the same work.
 * A rule is a claim about the scheme's requirements. Mixing them would corrupt
 * `/evaluation` and would put uncalibrated findings into a triage queue whose precision is
 * measured.
 *
 * ## A null input skips its check — it never becomes a finding
 *
 * This is the discipline the whole feature rests on. If `certified_amount` is null because
 * the scan was poor, the amount check does not run. It emphatically does not compare null
 * against `works.expenditure` and report a total shortfall. Every check states its own
 * precondition and returns nothing when the precondition is unmet, so an unreadable
 * document produces zero findings rather than a page of fabricated ones.
 *
 * ## Tolerances exist because exactness would produce noise, not findings
 *
 * A UC rounded to the nearest hundred rupees is not a discrepancy. `AMOUNT_TOLERANCE_PCT`
 * and `DATE_TOLERANCE_DAYS` are the bands inside which two figures are treated as the same
 * figure. They are set to be forgiving on purpose: a check that fires on every rounding
 * difference gets switched off, and a check that is switched off finds nothing at all.
 */

import type { Work } from '../types.ts';
import { daysBetween, fmtINR, roundTo, tokenSetRatio } from '../util.ts';
import type { DocumentKind, ExtractedFields } from './document_ai.ts';

/**
 * The checks, by id. `D-` for document, deliberately distinct from the `R-` catalogue.
 *
 * Each entry is the one-line statement of what disagreement it looks for, used in the UI so
 * a finding can be explained without reading this file.
 */
export const CHECK_IDS = {
  'D-001': 'Certified amount differs from the expenditure recorded on the portal',
  'D-002': 'Certified amount exceeds the sanctioned amount',
  'D-003': 'Certificate is dated before the work was completed',
  'D-004': 'Certificate is dated before the work was sanctioned',
  'D-005': 'Agency named on the document is not the agency on the portal record',
  'D-006': 'Certified amount exceeds the funds released for this work',
  'D-007': 'Utilisation certificate on file for a work the portal marks as having none',
  'D-008': 'Certificate period ends before it begins',
} as const;

export type CheckId = keyof typeof CHECK_IDS;

/**
 * Amount agreement band, as a fraction.
 *
 * 1%. A UC written to the nearest rupee against a portal figure carried as a float will
 * differ in the last decimal place; a UC that rounds ₹8,20,000 to ₹8.2 L differs by nothing
 * meaningful. Below this, the two figures are the same figure. Above it, the difference is
 * large enough that somebody chose it.
 */
const AMOUNT_TOLERANCE_PCT = 0.01;

/**
 * Date agreement band, in days.
 *
 * 7. A certificate signed the week the work completed, dated by hand, transcribed off a
 * scan — none of that is a discrepancy. A certificate dated *months* before completion is
 * the finding: it certifies work that had not finished.
 */
const DATE_TOLERANCE_DAYS = 7;

/**
 * Agency-name agreement threshold, 0–1.
 *
 * 0.55 on `tokenSetRatio`. Deliberately low, and this is the check to be most suspicious
 * of. Government agency names are written half a dozen ways for the same body — "PWD",
 * "Public Works Department", "Executive Engineer, PWD Division II" — and a strict threshold
 * would report every one of them as a mismatch. The threshold is set so the check fires
 * only on names with essentially nothing in common, and the finding is severity LOW
 * accordingly: it is a prompt to look, not an accusation. See the note on D-005.
 */
const AGENCY_SIMILARITY_FLOOR = 0.55;

/** Severity vocabulary, matching `alerts` so the officer reads one scale. */
export type FindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Finding {
  check_id: CheckId;
  severity: FindingSeverity;
  detail: string;
  document_value: string | null;
  portal_value: string | null;
  /** Only for checks with a tolerance band. Null where the comparison is exact. */
  deviation_pct: number | null;
}

/**
 * Compare one reading against one work.
 *
 * Returns the disagreements, most severe first. An empty array means the document and the
 * record agree on everything that could be checked — which is different from "nothing was
 * checked", and the caller reports `checks_run` alongside so the two are distinguishable.
 * A UC with every field null yields zero findings *and* zero checks run, and presenting that
 * as a clean bill of health would be the single most misleading thing this feature could do.
 */
export function reconcile(
  work: Work,
  kind: DocumentKind,
  fields: ExtractedFields,
): { findings: Finding[]; checks_run: CheckId[] } {
  const findings: Finding[] = [];
  const run: CheckId[] = [];

  // ── D-001 · certified amount vs portal expenditure ────────────────────────
  //
  // The central check of the feature. The certificate says how much was spent; the portal
  // says how much was spent; a gap between them means one of the two is wrong and the
  // officer needs to know which. Runs only when the document states an amount and the
  // portal carries a non-zero expenditure — comparing against a zero expenditure would
  // report every certificate for a work whose spend has not been keyed in yet, which is a
  // data-entry backlog, not an integrity finding.
  if (fields.certified_amount !== null && work.expenditure > 0) {
    run.push('D-001');
    const diff = Math.abs(fields.certified_amount - work.expenditure);
    const pct = diff / work.expenditure;
    if (pct > AMOUNT_TOLERANCE_PCT) {
      const higher = fields.certified_amount > work.expenditure;
      findings.push({
        check_id: 'D-001',
        // Over-certification is the more serious direction: a certificate claiming more
        // than the portal recorded as spent is the shape of a diverted payment, whereas
        // under-certification is more often an unposted bill.
        severity: higher ? 'HIGH' : 'MEDIUM',
        detail:
          `The certificate certifies ${fmtINR(fields.certified_amount)} while the portal ` +
          `records expenditure of ${fmtINR(work.expenditure)} — a difference of ` +
          `${fmtINR(diff)} (${roundTo(pct * 100, 1)}%). ` +
          (higher
            ? 'The document claims more was spent than the record shows.'
            : 'The record shows more was spent than the document certifies.'),
        document_value: fmtINR(fields.certified_amount),
        portal_value: fmtINR(work.expenditure),
        deviation_pct: roundTo(pct * 100, 2),
      });
    }
  }

  // ── D-002 · certified amount vs sanctioned amount ─────────────────────────
  //
  // A certificate cannot certify more than was ever sanctioned. Unlike D-001 this is not a
  // disagreement between two estimates of the same thing — it is a ceiling, so the
  // tolerance applies only to rounding and anything beyond it is a substantive breach.
  if (fields.certified_amount !== null && work.sanctioned_amount > 0) {
    run.push('D-002');
    const excess = fields.certified_amount - work.sanctioned_amount;
    if (excess > work.sanctioned_amount * AMOUNT_TOLERANCE_PCT) {
      findings.push({
        check_id: 'D-002',
        severity: 'CRITICAL',
        detail:
          `The certificate certifies ${fmtINR(fields.certified_amount)} against a ` +
          `sanctioned amount of ${fmtINR(work.sanctioned_amount)} — ${fmtINR(excess)} ` +
          'more than was ever sanctioned for this work.',
        document_value: fmtINR(fields.certified_amount),
        portal_value: fmtINR(work.sanctioned_amount),
        deviation_pct: roundTo((excess / work.sanctioned_amount) * 100, 2),
      });
    }
  }

  // ── D-006 · certified amount vs funds released ────────────────────────────
  //
  // Distinct from D-002 and worth its own check: sanction is authorisation, release is
  // money that actually moved. A certificate for more than was released certifies spending
  // of funds the work never received. Kept separate so the officer sees which ceiling was
  // breached rather than one merged finding that obscures it.
  if (fields.certified_amount !== null && work.released_amount > 0) {
    run.push('D-006');
    const excess = fields.certified_amount - work.released_amount;
    if (excess > work.released_amount * AMOUNT_TOLERANCE_PCT) {
      findings.push({
        check_id: 'D-006',
        severity: 'HIGH',
        detail:
          `The certificate certifies ${fmtINR(fields.certified_amount)} while ` +
          `${fmtINR(work.released_amount)} has been released to this work — ` +
          `${fmtINR(excess)} more than the work has received.`,
        document_value: fmtINR(fields.certified_amount),
        portal_value: fmtINR(work.released_amount),
        deviation_pct: roundTo((excess / work.released_amount) * 100, 2),
      });
    }
  }

  // ── D-003 · certificate date vs actual completion ─────────────────────────
  //
  // A utilisation or completion certificate dated before the work finished certifies work
  // that had not been done. Only meaningful for the two certificate kinds — a running bill
  // predating completion is exactly what a running bill is, and firing this on bills would
  // flag every correctly-issued interim payment in the corpus.
  if (
    (kind === 'UTILISATION_CERTIFICATE' || kind === 'COMPLETION_CERTIFICATE') &&
    fields.certificate_date !== null &&
    work.actual_completion_date !== null
  ) {
    run.push('D-003');
    const gap = daysBetween(fields.certificate_date, work.actual_completion_date);
    if (gap > DATE_TOLERANCE_DAYS) {
      findings.push({
        check_id: 'D-003',
        severity: 'HIGH',
        detail:
          `The certificate is dated ${fields.certificate_date}, ${gap} days before the ` +
          `work's recorded completion on ${work.actual_completion_date}. A certificate ` +
          'issued before completion certifies work that had not been finished.',
        document_value: fields.certificate_date,
        portal_value: work.actual_completion_date,
        deviation_pct: null,
      });
    }
  }

  // ── D-004 · certificate date vs sanction date ─────────────────────────────
  //
  // Applies to every document kind: nothing about a work can be certified or billed before
  // the work was sanctioned. A hit here usually means the wrong document is attached to the
  // work, which is why the detail says so — the officer's first move is to check the
  // attachment, not to open an investigation.
  if (fields.certificate_date !== null && work.sanction_date !== null) {
    run.push('D-004');
    const gap = daysBetween(fields.certificate_date, work.sanction_date);
    if (gap > DATE_TOLERANCE_DAYS) {
      findings.push({
        check_id: 'D-004',
        severity: 'HIGH',
        detail:
          `The document is dated ${fields.certificate_date}, ${gap} days before this work ` +
          `was sanctioned on ${work.sanction_date}. The usual cause is a document ` +
          'attached to the wrong work.',
        document_value: fields.certificate_date,
        portal_value: work.sanction_date,
        deviation_pct: null,
      });
    }
  }

  // ── D-008 · internally inconsistent period ────────────────────────────────
  //
  // Both dates come from the same document, so this compares the document against itself
  // and needs no portal data. Usually a transcription artefact rather than a real
  // inconsistency, hence LOW — but it is the signal that the other dates on this reading
  // deserve less weight, which is worth surfacing rather than swallowing.
  if (fields.period_from !== null && fields.period_to !== null) {
    run.push('D-008');
    const span = daysBetween(fields.period_from, fields.period_to);
    if (span < 0) {
      findings.push({
        check_id: 'D-008',
        severity: 'LOW',
        detail:
          `The document's stated period runs from ${fields.period_from} to ` +
          `${fields.period_to}, which ends before it begins. This is most likely a ` +
          'transcription error, and it means the other dates read off this document ' +
          'deserve a second look.',
        document_value: `${fields.period_from} → ${fields.period_to}`,
        portal_value: null,
        deviation_pct: null,
      });
    }
  }

  // ── D-007 · a UC exists that the portal says does not ─────────────────────
  //
  // Compares the fact of the document against `works.has_uc`, the boolean that was the
  // entire data model for this before P-04. The finding is a record-keeping gap, not
  // misconduct: the certificate is in hand, so the portal flag is simply stale. Its value
  // is that it is *fixable* — and that R-003, which fires on `!has_uc`, is raising an alert
  // about a work whose UC is sitting right here.
  if (kind === 'UTILISATION_CERTIFICATE' && fields.certificate_date !== null && !work.has_uc) {
    run.push('D-007');
    findings.push({
      check_id: 'D-007',
      severity: 'MEDIUM',
      detail:
        `A utilisation certificate dated ${fields.certificate_date} is attached to this ` +
        'work, but the portal record has no UC on file. R-003 will be raising a ' +
        'missing-UC alert against a work whose certificate is in hand — the record needs ' +
        'updating, not the work investigating.',
      document_value: fields.certificate_date,
      portal_value: 'has_uc = false',
      deviation_pct: null,
    });
  }

  // ── D-005 · agency named vs agency on record ──────────────────────────────
  //
  // The weakest check here, and labelled accordingly. `tokenSetRatio` is purely lexical, so
  // it cannot tell that "Executive Engineer, PWD Division II" and "Public Works Department"
  // are the same body — which is why the floor is low and the severity is LOW. It exists
  // because a certificate naming an entirely unrelated agency is a real and serious signal,
  // and it is worth a soft check to catch that at the cost of occasional noise the officer
  // can dismiss in one click.
  //
  // `work.agency_id` is an id, not a name, so the caller resolves the name and passes it in
  // via `agencyName`. When it cannot, the check does not run — and because that argument
  // does not exist on this function, D-005 lives in `reconcileWithAgency` below rather than
  // here, where it could only ever have been silently skipped.

  const order: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { findings, checks_run: run };
}

/**
 * {@link reconcile} plus the agency-name check, which needs a name the `works` row does not
 * carry — it holds `agency_id`.
 *
 * A separate function rather than an optional parameter on `reconcile`, so that a caller
 * that has not resolved the agency cannot accidentally pass `undefined` and have D-005
 * silently never run. Here the absence is explicit: no name, no call.
 */
export function reconcileWithAgency(
  work: Work,
  kind: DocumentKind,
  fields: ExtractedFields,
  agencyName: string | null,
): { findings: Finding[]; checks_run: CheckId[] } {
  const base = reconcile(work, kind, fields);

  if (fields.agency_named !== null && agencyName !== null && agencyName.trim() !== '') {
    base.checks_run.push('D-005');
    const similarity = tokenSetRatio(fields.agency_named, agencyName);
    if (similarity < AGENCY_SIMILARITY_FLOOR) {
      base.findings.push({
        check_id: 'D-005',
        severity: 'LOW',
        detail:
          `The document names "${fields.agency_named}" while the portal records the ` +
          `implementing agency as "${agencyName}". Government bodies are written many ` +
          'ways for the same office, so this comparison is lexical and often noise — but ' +
          'a document naming an unrelated agency is worth one look.',
        document_value: fields.agency_named,
        portal_value: agencyName,
        deviation_pct: roundTo(similarity * 100, 1),
      });
    }
  }

  const order: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  base.findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return base;
}
