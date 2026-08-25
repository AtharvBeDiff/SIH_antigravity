/**
 * MPLADS Platform — Express 5 Server
 *
 * Mounts all 13 routers in contract order.
 * Express 5 auto-forwards async rejections to error middleware —
 * do NOT wrap handlers in try/catch to build responses.
 * Throw ApiError instead.
 */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { ApiError } from './http.ts';

// ─── Routers ─────────────────────────────────────────────────

import auditRouter from './routers/audit.ts';
import metaRouter from './routers/meta.ts';
import ingestRouter from './routers/ingest.ts';
import rulesRouter from './routers/rules.ts';
import analyzeRouter from './routers/analyze.ts';
import worksRouter from './routers/works.ts';
import alertsRouter from './routers/alerts.ts';
import reviewRouter from './routers/review.ts';
import inspectionRouter from './routers/inspection.ts';
import dashboardRouter from './routers/dashboard.ts';
import digestRouter from './routers/digest.ts';
import insightRouter from './routers/insight.ts';
import publicRouter from './routers/public.ts';
import slaRouter from './routers/sla.ts';
import quotaRouter from './routers/quota.ts';
import heatmapRouter from './routers/heatmap.ts';
import healthReportsRouter from './routers/health_reports.ts';

// ─── App setup ───────────────────────────────────────────────

const app = express();

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
const DEMO_MODE = process.env['DEMO_MODE'] === 'true';

// Flexible CORS for Railway + Vercel + Local dev
app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (
      origin.startsWith('http://localhost') ||
      origin.startsWith('https://localhost') ||
      origin.endsWith('.vercel.app') ||
      (process.env['FRONTEND_URL'] && origin === process.env['FRONTEND_URL'])
    ) {
      return callback(null, true);
    }
    // Permissive fallback for demo
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', demo_mode: DEMO_MODE, timestamp: new Date().toISOString() });
});

// ─── Mount routers (contract order) ─────────────────────────

app.use('/api/meta', metaRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/works', worksRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/review', reviewRouter);
app.use('/api/inspections', inspectionRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/digest', digestRouter);
app.use('/api/audit', auditRouter);
app.use('/api/insight', insightRouter);
app.use('/api/public', publicRouter);
app.use('/api/sla', slaRouter);
app.use('/api/quota', quotaRouter);
app.use('/api/heatmap', heatmapRouter);
app.use('/api/health_reports', healthReportsRouter);

// ─── Error middleware ────────────────────────────────────────
// Express 5 auto-forwards async rejections here.

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[SERVER ERROR]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
});

// ─── Start ───────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DRISHTI] Server running on :${PORT}`);
  console.log(`[DRISHTI] DEMO_MODE=${DEMO_MODE}`);
  console.log(`[DRISHTI] Supabase URL: ${process.env['SUPABASE_URL']?.slice(0, 30)}...`);
});

export default app;
