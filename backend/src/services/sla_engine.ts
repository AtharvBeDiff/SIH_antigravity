import { getDb } from '../db.ts';
import type { Work, Alert } from '../types.ts';
import { newId } from '../util.ts';

const SLA_LIMIT_DAYS = 45;
const SLA_WARNING_DAYS = 35;

/**
 * Evaluates SLA compliance for all 'PROPOSED' works.
 * Flags works that are nearing or have breached the 45-day SLA for sanctioning.
 */
export async function evaluateProposalSLAs(): Promise<Partial<Alert>[]> {
  const db = getDb();
  const { data: proposedWorks, error } = await db
    .from('works')
    .select('*')
    .is('sanction_date', null);

  if (error || !proposedWorks) {
    throw new Error(`Failed to fetch proposed works for SLA evaluation: ${error?.message}`);
  }

  const alerts: Partial<Alert>[] = [];
  const now = new Date();

  for (const work of proposedWorks as Work[]) {
    if (!work.recommended_date) continue; // Cannot track SLA without a recommendation date

    const recDate = new Date(work.recommended_date);
    const diffTime = Math.abs(now.getTime() - recDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > SLA_LIMIT_DAYS) {
      alerts.push({
        id: newId(),
        work_id: work.id,
        rule_id: 'RULE_MPLADS_006_SLA_BREACH',
        origin_id: 'sla_engine',
        severity: 'CRITICAL',
        severity_rank: 1,
        status: 'OPEN',
        in_budget: true,
        reason_code: 'SLA_BREACHED',
        evidence_text: `Work has been waiting for sanction for ${diffDays} days, exceeding the ${SLA_LIMIT_DAYS} day SLA.`,
        created_at: now.toISOString(),
      });
    } else if (diffDays > SLA_WARNING_DAYS) {
      alerts.push({
        id: newId(),
        work_id: work.id,
        rule_id: 'RULE_MPLADS_005_SLA_RISK',
        origin_id: 'sla_engine',
        severity: 'HIGH',
        severity_rank: 2,
        status: 'OPEN',
        in_budget: true,
        reason_code: 'SLA_AT_RISK',
        evidence_text: `Work has been waiting for sanction for ${diffDays} days. It is at risk of breaching the ${SLA_LIMIT_DAYS} day SLA.`,
        created_at: now.toISOString(),
      });
    }
  }

  // Persist alerts
  if (alerts.length > 0) {
    const { error: insertError } = await db
      .from('alerts')
      .upsert(alerts as any[], { onConflict: 'work_id,origin_id' });
    
    if (insertError) {
      console.error('Failed to save SLA alerts:', insertError);
    }
  }

  return alerts;
}
