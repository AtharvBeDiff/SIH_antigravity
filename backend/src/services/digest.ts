/**
 * Digest Service
 *
 * Generates self-contained HTML digest (inline styles, tables, no JS — email-safe).
 * Summarizes alerts, completion rates, expenditure, and flag counts.
 */

import { all, get, insert } from '../db.ts';
import { fmtINR, newId, nowIso } from '../util.ts';
import type { District, Work, Alert, DigestSummary } from '../types.ts';

export async function generateDistrictDigest(
  districtId: string,
  periodStart: string,
  periodEnd: string,
): Promise<DigestSummary> {
  const district = await get<District>('districts', { id: districtId });
  const districtName = district?.name ?? 'District';

  const works = await all<Work>('works', { where: { district_id: districtId } });
  const alerts = await all<Alert>('alerts');

  // Filter alerts for this district
  const districtWorkIds = new Set(works.map(w => w.id));
  const districtAlerts = alerts.filter(a => districtWorkIds.has(a.work_id));

  const totalWorks = works.length;
  const completedWorks = works.filter(w => w.status === 'COMPLETED').length;
  const inProgressWorks = works.filter(w => w.status === 'IN_PROGRESS').length;
  const totalSanctioned = works.reduce((sum, w) => sum + (w.sanctioned_amount ?? 0), 0);
  const totalExpenditure = works.reduce((sum, w) => sum + (w.expenditure ?? 0), 0);

  const criticalAlerts = districtAlerts.filter(a => a.severity === 'CRITICAL');
  const highAlerts = districtAlerts.filter(a => a.severity === 'HIGH');
  const mediumAlerts = districtAlerts.filter(a => a.severity === 'MEDIUM');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MPLADS Weekly Digest - ${districtName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 24px; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0;">
    <tr>
      <td style="padding: 24px; background: #0f172a; color: #ffffff;">
        <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">MPLADS Executive Digest</h1>
        <p style="margin: 0; font-size: 14px; color: #94a3b8;">${districtName} &bull; ${periodStart} to ${periodEnd}</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px;">
        <h2 style="font-size: 16px; margin: 0 0 16px 0; color: #0f172a;">Executive Summary</h2>
        <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
          <tr>
            <td width="33%" style="padding: 12px; background: #f8fafc; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0;">
              <div style="font-size: 12px; color: #64748b; font-weight: 600;">TOTAL WORKS</div>
              <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px;">${totalWorks}</div>
            </td>
            <td width="4%"></td>
            <td width="30%" style="padding: 12px; background: #f8fafc; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0;">
              <div style="font-size: 12px; color: #64748b; font-weight: 600;">COMPLETED</div>
              <div style="font-size: 20px; font-weight: 700; color: #10b981; margin-top: 4px;">${completedWorks}</div>
            </td>
            <td width="4%"></td>
            <td width="33%" style="padding: 12px; background: #f8fafc; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0;">
              <div style="font-size: 12px; color: #64748b; font-weight: 600;">EXPENDITURE</div>
              <div style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px;">${fmtINR(totalExpenditure)}</div>
            </td>
          </tr>
        </table>

        <h2 style="font-size: 16px; margin: 0 0 12px 0; color: #0f172a;">Integrity & Risk Watchlist</h2>
        <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse: collapse; font-size: 13px; margin-bottom: 24px;">
          <tr style="background: #f1f5f9; text-align: left;">
            <th style="border-bottom: 2px solid #cbd5e1; padding: 8px;">Severity</th>
            <th style="border-bottom: 2px solid #cbd5e1; padding: 8px;">Active Alerts</th>
            <th style="border-bottom: 2px solid #cbd5e1; padding: 8px;">Status</th>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;"><strong style="color: #ef4444;">CRITICAL</strong></td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">${criticalAlerts.length}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">Immediate Officer Review Required</td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;"><strong style="color: #f59e0b;">HIGH</strong></td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">${highAlerts.length}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">Prioritized in Queue</td>
          </tr>
          <tr>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;"><strong style="color: #3b82f6;">MEDIUM</strong></td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">${mediumAlerts.length}</td>
            <td style="border-bottom: 1px solid #e2e8f0; padding: 8px;">Routine Review</td>
          </tr>
        </table>

        <div style="font-size: 12px; color: #64748b; line-height: 1.5; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          This digest was auto-generated by the MPLADS Insight & Integrity Platform. All decisions and audits are recorded on the tamper-evident ledger.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const id = newId();
  const digestRecord: DigestSummary = {
    id,
    district_id: districtId,
    generated_at: nowIso(),
    period_start: periodStart,
    period_end: periodEnd,
    html,
  };

  await insert('digest_history', digestRecord as unknown as Record<string, unknown>);
  return digestRecord;
}
