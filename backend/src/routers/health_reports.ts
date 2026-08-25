import { Router } from 'express';
import { getDb } from '../db.ts';
import { newId } from '../util.ts';
import { ApiError } from '../types.ts';

const router = Router();

// GET /api/health_reports - List reports
router.get('/', async (req, res, next) => {
  try {
    const db = getDb();
    let query = db.from('health_reports').select('*').order('report_date', { ascending: false });

    const workId = req.query.work_id as string;
    if (workId) {
      query = query.eq('work_id', workId);
    }
    
    // limit for safety if no work_id is provided
    if (!workId) {
        query = query.limit(100);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ data: data || [] });
  } catch (error) {
    next(error);
  }
});

// POST /api/health_reports - Submit a 10-day report
router.post('/', async (req, res, next) => {
  try {
    const { work_id, reported_by, progress_pct, evidence_image_key, remarks } = req.body;

    if (!work_id || progress_pct === undefined || !evidence_image_key) {
      throw new ApiError(400, 'work_id, progress_pct, and evidence_image_key are required for health reports');
    }

    const db = getDb();
    
    // 1. Insert the report
    const report = {
      id: newId(),
      work_id,
      reported_by: reported_by || 'Field Inspector',
      report_date: new Date().toISOString().split('T')[0],
      progress_pct,
      evidence_image_key,
      remarks,
    };

    const { error: insertError } = await db.from('health_reports').insert(report);
    if (insertError) throw insertError;

    // 2. Update the work's physical_progress_pct
    const { error: updateError } = await db
      .from('works')
      .update({ physical_progress_pct: progress_pct, updated_at: new Date().toISOString() })
      .eq('id', work_id);

    if (updateError) throw updateError;

    res.status(201).json({ message: 'Health report submitted successfully', data: report });
  } catch (error) {
    next(error);
  }
});

export default router;
