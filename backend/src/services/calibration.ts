/**
 * Calibration Service
 *
 * Compares synthetic dataset aggregates against the real published
 * MPLADS completion benchmark of 19.24% by value.
 */

import { all, insert } from '../db.ts';
import { newId, nowIso } from '../util.ts';
import type { Work, CalibrationSnapshot } from '../types.ts';

const TARGET_COMPLETION_RATE = 0.1924; // 19.24% by value

export async function computeCalibration(): Promise<CalibrationSnapshot> {
  const works = await all<Work>('works');

  const totalSanctioned = works.reduce((sum, w) => sum + (w.sanctioned_amount ?? 0), 0);
  const completedSanctioned = works
    .filter(w => w.status === 'COMPLETED')
    .reduce((sum, w) => sum + (w.sanctioned_amount ?? 0), 0);

  const corpusRate = totalSanctioned > 0 ? completedSanctioned / totalSanctioned : TARGET_COMPLETION_RATE;
  const deviationPct = Math.abs(corpusRate - TARGET_COMPLETION_RATE) / TARGET_COMPLETION_RATE * 100;

  // Breakdown by category
  const byCategory: Record<string, { total_works: number; completed_works: number; completion_rate: number }> = {};
  for (const w of works) {
    const cat = w.category ?? 'OTHER';
    const entry = byCategory[cat] ?? { total_works: 0, completed_works: 0, completion_rate: 0 };
    entry.total_works++;
    if (w.status === 'COMPLETED') entry.completed_works++;
    byCategory[cat] = entry;
  }
  for (const cat of Object.keys(byCategory)) {
    const e = byCategory[cat]!;
    e.completion_rate = e.total_works > 0 ? e.completed_works / e.total_works : 0;
  }

  const snapshot: CalibrationSnapshot = {
    id: newId(),
    run_at: nowIso(),
    corpus_completion_rate: corpusRate,
    target_completion_rate: TARGET_COMPLETION_RATE,
    deviation_pct: deviationPct,
    by_category: byCategory,
    by_state: {},
  };

  try {
    await insert('calibration_snapshots', snapshot as unknown as Record<string, unknown>);
  } catch (err: any) {
    console.warn('Could not persist calibration_snapshot:', err.message);
  }

  return snapshot;
}
