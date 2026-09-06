/**
 * Compliance Statistics Router — R-016 SC/ST reservation, R-017 inspection coverage.
 *
 * Doctrine #3: these are compliance statistics, not risk. Nothing here is ranked, and
 * nothing here is attributed to a named Member of Parliament.
 *
 * Mounted at `/api/quota` for backward compatibility with the existing client. The
 * previous handler computed SC/ST share as a fraction of the district's own
 * sanctioned total — a ratio of the portfolio to itself, which is not the guideline's
 * test. The arithmetic now lives in `services/compliance.ts`.
 */

import { Router } from 'express';
import { qstr } from '../http.ts';
import {
  computeInspectionCoverage,
  computeReservationCompliance,
} from '../services/compliance.ts';

const router = Router();

/** GET /quota — SC/ST reservation compliance (R-016). */
router.get('/', async (req, res) => {
  const districtId = qstr(req, 'district_id');
  const data = await computeReservationCompliance(districtId ?? undefined);
  res.json({ data });
});

/** GET /quota/inspection — physical inspection coverage (R-017). */
router.get('/inspection', async (req, res) => {
  const districtId = qstr(req, 'district_id');
  const data = await computeInspectionCoverage(districtId ?? undefined);
  res.json({ data });
});

export default router;
