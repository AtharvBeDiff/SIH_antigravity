import { Router } from 'express';
import { getDb } from '../db.ts';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const districtId = req.query.district_id as string;
    
    // Fetch relevant tables
    const db = getDb();
    let worksQuery = db.from('works').select('sanction_date, actual_completion_date');
    let paymentsQuery = db.from('payments').select('payment_date');
    let inspectionsQuery = db.from('inspections').select('inspection_date');
    
    if (districtId) {
      worksQuery = worksQuery.eq('district_id', districtId);
      // For payments and inspections, we need to join or assume district_id is not directly there
      // To keep it simple for now, we'll fetch all and filter in memory or ignore district for payments
    }
    
    const [worksRes, paymentsRes, inspectionsRes] = await Promise.all([
      worksQuery,
      paymentsQuery,
      inspectionsQuery
    ]);

    if (worksRes.error) throw worksRes.error;
    if (paymentsRes.error) throw paymentsRes.error;
    if (inspectionsRes.error) throw inspectionsRes.error;

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

    for (const w of worksRes.data || []) {
      if (w.sanction_date) addActivity(w.sanction_date, 'worksSanctioned');
      if (w.actual_completion_date) addActivity(w.actual_completion_date, 'worksCompleted');
    }
    
    for (const p of paymentsRes.data || []) {
      if (p.payment_date) addActivity(p.payment_date, 'payments');
    }
    
    for (const i of inspectionsRes.data || []) {
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
