/**
 * Public View Service (Doctrine #4: Whitelist Only)
 *
 * Public responses must strictly only contain approved whitelisted fields.
 * NEVER spread raw work objects or delete unwanted fields.
 * Explicitly map properties one by one.
 */

import type { PublicWork, Work } from '../types.ts';

export function toPublicWork(
  work: Partial<Work>,
  districtName = 'District',
  constituencyName = 'Constituency',
): PublicWork {
  return {
    id: work.id ?? '',
    title: work.title ?? '',
    description: work.description ?? '',
    category: (work.category as any) ?? 'OTHER',
    location_name: work.location_name ?? '',
    status: (work.status as any) ?? 'NOT_STARTED',
    physical_progress_pct: work.physical_progress_pct ?? 0,
    sanctioned_amount: work.sanctioned_amount ?? 0,
    expenditure: work.expenditure ?? 0,
    sanction_date: work.sanction_date ?? '',
    actual_completion_date: work.actual_completion_date ?? null,
    district_name: districtName,
    constituency_name: constituencyName,
  };
}
