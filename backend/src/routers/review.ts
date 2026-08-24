/**
 * Review Router — GET /review/stats, POST /review
 */

import { Router } from 'express';
import { getDb, count } from '../db.ts';

const router = Router();

/** GET /review/stats — review action statistics */
router.get('/stats', async (_req, res) => {
  const db = getDb();
  const { data, error } = await db
    .from('review_actions')
    .select('action');
  if (error) throw new Error(`review stats: ${error.message}`);

  const stats: Record<string, number> = {};
  for (const row of (data ?? [])) {
    const action = row.action as string;
    stats[action] = (stats[action] ?? 0) + 1;
  }

  const totalReviews = await count('review_actions');

  res.json({
    data: {
      total_reviews: totalReviews,
      by_action: stats,
    },
  });
});

export default router;
