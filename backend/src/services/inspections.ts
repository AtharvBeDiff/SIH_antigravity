/**
 * Inspections Service
 *
 * Field inspection management and offline sync queue processing.
 */

import { get, all, insert, insertMany } from '../db.ts';
import { newId, nowIso } from '../util.ts';
import { appendAudit } from './audit_chain.ts';
import type { Inspection, InspectionItem } from '../types.ts';

export interface CreateInspectionInput {
  work_id: string;
  inspector_id: string;
  inspector_name: string;
  inspection_date?: string;
  latitude: number;
  longitude: number;
  overall_status: 'SATISFACTORY' | 'DEFECTS_FOUND' | 'WORK_NOT_STARTED' | 'INACCESSIBLE';
  notes?: string;
  photo_keys?: string[];
  items?: Array<{
    checklist_id: string;
    checked: boolean;
    note?: string;
  }>;
}

export async function createInspection(
  input: CreateInspectionInput,
  actor: string,
): Promise<{ inspection: Inspection; items: InspectionItem[] }> {
  const id = newId();
  const inspection: Inspection = {
    id,
    work_id: input.work_id,
    inspector_id: input.inspector_id,
    inspector_name: input.inspector_name,
    inspection_date: input.inspection_date ?? nowIso().slice(0, 10),
    latitude: input.latitude,
    longitude: input.longitude,
    overall_status: input.overall_status,
    notes: input.notes ?? null,
    photo_keys: input.photo_keys ?? [],
    synced: true,
    created_at: nowIso(),
  };

  await insert('inspections', inspection as unknown as Record<string, unknown>);

  const items: InspectionItem[] = [];
  if (input.items && input.items.length > 0) {
    const itemRows = input.items.map(it => ({
      id: newId(),
      inspection_id: id,
      checklist_id: it.checklist_id,
      checked: it.checked,
      note: it.note ?? null,
    }));
    await insertMany('inspection_items', itemRows);
    items.push(...(itemRows as InspectionItem[]));
  }

  await appendAudit(actor, 'INSPECTION_RECORDED', 'inspection', id, {
    work_id: input.work_id,
    overall_status: input.overall_status,
    items_count: items.length,
  });

  return { inspection, items };
}

export async function getInspectionDetail(id: string): Promise<{ inspection: Inspection; items: InspectionItem[] } | null> {
  const inspection = await get<Inspection>('inspections', { id });
  if (!inspection) return null;

  const items = await all<InspectionItem>('inspection_items', {
    where: { inspection_id: id },
  });

  return { inspection, items };
}
