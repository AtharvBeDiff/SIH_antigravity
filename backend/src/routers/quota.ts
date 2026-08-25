import { Router } from 'express';
import { getDb } from '../db.ts';
import type { ApiError } from '../types.ts';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const districtId = req.query.district_id as string;
    
    let query = getDb()
      .from('works')
      .select('sanctioned_amount, is_scsp, is_tsp, status');
      
    if (districtId) {
      query = query.eq('district_id', districtId);
    }
    
    // In real life we only care about works that are sanctioned (not rejected/proposed)
    // but here we can just sum everything that has a sanctioned_amount > 0.
    // To match SLA logic, maybe we include everything not cancelled.
    query = query.neq('status', 'CANCELLED');

    const { data: works, error } = await query;

    if (error) throw error;
    
    let totalSanctioned = 0;
    let scspSanctioned = 0;
    let tspSanctioned = 0;
    
    for (const work of works || []) {
      const amt = Number(work.sanctioned_amount || 0);
      totalSanctioned += amt;
      if (work.is_scsp) {
        scspSanctioned += amt;
      }
      if (work.is_tsp) {
        tspSanctioned += amt;
      }
    }
    
    const scspPercentage = totalSanctioned > 0 ? (scspSanctioned / totalSanctioned) * 100 : 0;
    const tspPercentage = totalSanctioned > 0 ? (tspSanctioned / totalSanctioned) * 100 : 0;
    
    res.json({
      data: {
        totalSanctioned,
        scspSanctioned,
        tspSanctioned,
        scspPercentage,
        tspPercentage,
        scspTarget: 15.0, // 15%
        tspTarget: 7.5, // 7.5%
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
