import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { AlertCircle, ArrowLeft, Camera, CheckSquare, MapPin, Save, ShieldCheck } from 'lucide-react';
import type { Work } from '../types';

const CHECKLIST_ITEMS = [
  { id: 'chk_1', text: 'Asset physically located at specified GPS coordinates' },
  { id: 'chk_2', text: 'Mandatory MPLADS Citizen Plaque installed on site with MP details' },
  { id: 'chk_3', text: 'Work quality conforms to standard CPWD / state PWD specifications' },
  { id: 'chk_4', text: 'Asset is functional and accessible to the intended public demographic' },
  { id: 'chk_5', text: 'No encroachment or unauthorized commercial usage detected' },
  { id: 'chk_6', text: 'Material specifications verified against sanctioned technical estimate' },
  { id: 'chk_7', text: 'Utilisation Certificate (UC) matches on-site completed scope' },
  { id: 'chk_8', text: 'Geotagged photographic evidence captured and uploaded' },
];

export function InspectionFormPage() {
  const navigate = useNavigate();
  const [works, setWorks] = useState<Work[]>([]);
  const [selectedWorkId, setSelectedWorkId] = useState('');
  const [inspectorName, setInspectorName] = useState('Officer J. Smith');
  const [overallStatus, setOverallStatus] = useState<'SATISFACTORY' | 'DEFECTS_FOUND' | 'WORK_NOT_STARTED' | 'INACCESSIBLE'>('SATISFACTORY');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  // 'acquiring' while the browser position request is in flight; 'acquired' on success;
  // 'failed' if the API is absent or the user denied permission. Submission is blocked
  // until 'acquired' — the inspections table has NOT NULL coordinates and a hardcoded
  // fallback would plant false location data in the record.
  const [gpsState, setGpsState] = useState<'acquiring' | 'acquired' | 'failed'>('acquiring');
  const [notes, setNotes] = useState('');
  // Every box starts unchecked. They used to default to `true` — all eight — so an
  // inspector who opened the form and submitted it filed a complete clean bill of
  // health for a work they had not looked at. The eight items are the substance of a
  // physical inspection; a default of "verified" makes the record say something the
  // inspector never asserted, and R-017's coverage figure would then count that work
  // as inspected.
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/works?page_size=20')
      .then(res => res.json())
      .then(json => {
        const list = json.data || [];
        setWorks(list);
        if (list.length > 0) setSelectedWorkId(list[0].id);
      })
      .catch(console.error);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
          setGpsState('acquired');
        },
        () => setGpsState('failed'),
      );
    } else {
      setGpsState('failed');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkId) return;
    // D11: coordinates are NOT NULL in the schema. Block here rather than let the
    // API reject a well-filled form, and never silently substitute a fallback location.
    if (gpsState !== 'acquired' || lat === null || lng === null) {
      setSubmitError(
        gpsState === 'acquiring'
          ? 'GPS location is still being determined. Wait a moment and try again.'
          : 'GPS location could not be obtained. This inspection cannot be submitted without verified coordinates.',
      );
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        work_id: selectedWorkId,
        inspector_id: 'officer_1',
        inspector_name: inspectorName,
        overall_status: overallStatus,
        latitude: lat,
        longitude: lng,
        notes,
        items: Object.entries(checkedItems).map(([id, checked]) => ({
          checklist_id: id,
          checked,
        })),
      };

      // There is no offline queue. `frontend/src/offline.ts` was planned and never
      // written, and `vite-plugin-pwa` is a dependency that `vite.config.ts` never
      // registers — so there is no service worker either. A failed POST here means
      // the inspection is gone, and the inspector has to be told that rather than
      // being navigated away as though it had been filed.
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `Submission failed (HTTP ${res.status})`);
      }

      navigate('/inspection');
    } catch (err) {
      // Previously `console.error` and then a fall-through to `navigate`, which took
      // the inspector to the list where their inspection was absent. Silent loss of
      // fieldwork.
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Could not reach the server. This inspection has not been saved.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/inspection')}
          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <PageHeader
          title="New Field Inspection Report"
          description="Record geotagged physical asset verification and 8-point compliance checklist."
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Target Work Asset</h3>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500">Select Project Work</label>
            <select
              value={selectedWorkId}
              onChange={e => setSelectedWorkId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-sm text-slate-900 focus:outline-none focus:border-secondary cursor-pointer"
            >
              {works.map(w => (
                <option key={w.id} value={w.id}>
                  {w.title} ({w.category}) - {w.status}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Inspector Name</label>
              <input
                type="text"
                value={inspectorName}
                onChange={e => setInspectorName(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm text-slate-900 focus:outline-none focus:border-secondary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-500">Overall Finding Status</label>
              <select
                value={overallStatus}
                onChange={e => setOverallStatus(e.target.value as any)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm text-slate-900 focus:outline-none focus:border-secondary cursor-pointer"
              >
                <option value="SATISFACTORY">Satisfactory & Conforming</option>
                <option value="DEFECTS_FOUND">Defects / Variances Found</option>
                <option value="WORK_NOT_STARTED">Work Not Yet Started</option>
                <option value="INACCESSIBLE">Site Inaccessible</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <MapPin className={`w-4 h-4 ${gpsState === 'acquired' ? 'text-blue-600' : gpsState === 'failed' ? 'text-rose-500' : 'text-slate-400'}`} />
              <span className="text-slate-500">GPS Coordinates:</span>
              {gpsState === 'acquired' && lat !== null && lng !== null
                ? <strong className="text-slate-900 font-mono">{lat.toFixed(4)}, {lng.toFixed(4)}</strong>
                : <span className="text-slate-400 italic">{gpsState === 'acquiring' ? 'Acquiring…' : 'Unavailable'}</span>
              }
            </div>
            {gpsState === 'acquired'
              ? <span className="text-emerald-600 font-medium">Geotagged</span>
              : gpsState === 'acquiring'
              ? <span className="text-amber-500 font-medium">Acquiring GPS…</span>
              : <span className="text-rose-500 font-medium">GPS failed — cannot submit</span>
            }
          </div>
        </Card>

        {/* 8-Point Checklist */}
        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-blue-600" />
            <span>8-Point Physical Verification Checklist</span>
          </h3>

          <div className="space-y-3 divide-y divide-slate-100">
            {CHECKLIST_ITEMS.map(item => (
              <label
                key={item.id}
                className="pt-3 flex items-start gap-3 text-xs text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={!!checkedItems[item.id]}
                  onChange={e =>
                    setCheckedItems({
                      ...checkedItems,
                      [item.id]: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded border-slate-200 text-blue-600 focus:ring-secondary cursor-pointer"
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* Notes & Submit */}
        <Card className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500">Field Observation Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Enter specific on-site observations, material checks, or contractor feedback..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:border-secondary"
            />
          </div>

          {submitError && (
            <div
              role="alert"
              className="flex gap-3 p-3.5 rounded-lg bg-rose-50 border border-rose-200"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-rose-800">Inspection not saved</p>
                <p className="text-xs text-rose-900">{submitError}</p>
                <p className="text-xs text-rose-700">
                  There is no offline queue — nothing has been stored on this device. Keep this
                  page open and submit again once you have a connection.
                </p>
              </div>
            </div>
          )}

          <Button variant="primary" type="submit" disabled={submitting} className="w-full">
            {submitting ? <Spinner className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{submitting ? 'Submitting & Anchoring to Audit...' : 'Submit & Sign Field Inspection'}</span>
          </Button>
        </Card>
      </form>
    </div>
  );
}
