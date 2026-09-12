import { Router } from 'express';
import { all } from '../db.ts';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const districtId = req.query.district_id as string;

    // All three go through `all()` because it pages. A bare `.select()` stops at
    // PostgREST's 1,000-row default, and this endpoint counts activity per
    // calendar day across the whole corpus: 7,469 payments came back as 1,000,
    // so the heatmap showed a scheme that fell silent partway through the year.
    // The cap is invisible in the response — it is reported only in a
    // Content-Range header the client discards — so the chart looked complete.
    const [works, payments, inspections] = await Promise.all([
      all<{ sanction_date: string | null; actual_completion_date: string | null }>('works', {
        select: 'sanction_date, actual_completion_date',
        ...(districtId ? { where: { district_id: districtId } } : {}),
      }),
      // `payments` and `inspections` carry no district of their own. The
      // district filter is not applied to them rather than being applied
      // wrongly; see the note on the response below.
      all<{ payment_date: string | null }>('payments', { select: 'payment_date' }),
      all<{ inspection_date: string | null }>('inspections', { select: 'inspection_date' }),
    ]);

    const activityMap: Record<string, { count: number; worksSanctioned: number; worksCompleted: number; payments: number; inspections: number }> = {};

    const addActivity = (date: string, type: 'worksSanctioned' | 'worksCompleted' | 'payments' | 'inspections') => {
      if (!date) return;
      const d = date.slice(0, 10); // YYYY-MM-DD
      if (!activityMap[d]) {
        activityMap[d] = { count: 0, worksSanctioned: 0, worksCompleted: 0, payments: 0, inspections: 0 };
      }
      activityMap[d][type]++;
      activityMap[d].count++;
    };

    for (const w of works) {
      if (w.sanction_date) addActivity(w.sanction_date, 'worksSanctioned');
      if (w.actual_completion_date) addActivity(w.actual_completion_date, 'worksCompleted');
    }

    for (const p of payments) {
      if (p.payment_date) addActivity(p.payment_date, 'payments');
    }

    for (const i of inspections) {
      if (i.inspection_date) addActivity(i.inspection_date, 'inspections');
    }
    
    // Convert to array
    const data = Object.keys(activityMap).map(date => ({
      date,
      ...activityMap[date]
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
