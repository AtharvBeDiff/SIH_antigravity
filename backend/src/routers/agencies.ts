/**
 * Agencies Router — GET /agencies
 *
 * Doctrine #3 permits agency-level attribution and bars MP-level attribution. This
 * router serves the former and no part of it touches the latter: `mp_name` is not
 * selected, not aggregated and not returned.
 *
 * `AgenciesPage.tsx` previously made no API calls at all. The arithmetic lives in
 * `services/agency_performance.ts`, where the reasoning for the pacing index — and
 * for what is deliberately not computed — is recorded.
 */

import { Router } from 'express';
import { qstr } from '../http.ts';
import { computeAgencyPerformance } from '../services/agency_performance.ts';

const router = Router();

/**
 * GET /agencies — per-agency workload, delivery pacing and open-alert counts.
 *
 * Optional `district_id` scopes both the agency list and the works counted. Note that
 * the pacing expectation is rebuilt from the scoped corpus when a district is given,
 * so a district-scoped index compares agencies against that district's own medians,
 * not the national ones — which is the right comparison for a district officer and a
 * different number from the unscoped one.
 */
router.get('/', async (req, res) => {
  const districtId = qstr(req, 'district_id');
  const data = await computeAgencyPerformance(districtId ?? undefined);
  res.json({ data });
});

export default router;
