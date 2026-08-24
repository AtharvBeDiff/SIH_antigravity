import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { ArrowLeft, Camera, CheckSquare, MapPin, Save, ShieldCheck } from 'lucide-react';
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
  const [lat, setLat] = useState<number>(28.6139);
  const [lng, setLng] = useState<number>(77.2090);
  const [notes, setNotes] = useState('');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({
    chk_1: true,
    chk_2: true,
    chk_3: true,
    chk_4: true,
    chk_5: true,
    chk_6: true,
    chk_7: true,
    chk_8: true,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/works?page_size=20')
      .then(res => res.json())
      .then(json => {
        const list = json.data || [];
        setWorks(list);
        if (list.length > 0) setSelectedWorkId(list[0].id);
      })
      .catch(console.error);

    // Get real browser GPS if available
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
        },
        () => console.log('Using default GPS coordinates')
      );
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorkId) return;

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

      await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      navigate('/inspection');
    } catch (err) {
      console.error('Failed to submit inspection:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/inspection')}
          className="p-2 rounded-lg hover:bg-white/5 text-text-muted hover:text-white transition-colors cursor-pointer"
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
          <h3 className="text-base font-semibold text-white">Target Work Asset</h3>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">Select Project Work</label>
            <select
              value={selectedWorkId}
              onChange={e => setSelectedWorkId(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
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
              <label className="text-xs font-medium text-text-muted">Inspector Name</label>
              <input
                type="text"
                value={inspectorName}
                onChange={e => setInspectorName(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg p-2 text-sm text-white focus:outline-none focus:border-secondary"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-text-muted">Overall Finding Status</label>
              <select
                value={overallStatus}
                onChange={e => setOverallStatus(e.target.value as any)}
                className="w-full bg-surface border border-border rounded-lg p-2 text-sm text-white focus:outline-none focus:border-secondary cursor-pointer"
              >
                <option value="SATISFACTORY">Satisfactory & Conforming</option>
                <option value="DEFECTS_FOUND">Defects / Variances Found</option>
                <option value="WORK_NOT_STARTED">Work Not Yet Started</option>
                <option value="INACCESSIBLE">Site Inaccessible</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface border border-white/5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-secondary" />
              <span className="text-text-muted">GPS Coordinates:</span>
              <strong className="text-white font-mono">{lat.toFixed(4)}, {lng.toFixed(4)}</strong>
            </div>
            <span className="text-emerald-400 font-medium">GPS Geotagged</span>
          </div>
        </Card>

        {/* 8-Point Checklist */}
        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-secondary" />
            <span>8-Point Physical Verification Checklist</span>
          </h3>

          <div className="space-y-3 divide-y divide-border/30">
            {CHECKLIST_ITEMS.map(item => (
              <label
                key={item.id}
                className="pt-3 flex items-start gap-3 text-xs text-white cursor-pointer hover:text-secondary transition-colors"
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
                  className="mt-0.5 rounded border-border text-secondary focus:ring-secondary cursor-pointer"
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* Notes & Submit */}
        <Card className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-muted">Field Observation Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Enter specific on-site observations, material checks, or contractor feedback..."
              className="w-full bg-surface border border-border rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-secondary"
            />
          </div>

          <Button variant="primary" type="submit" disabled={submitting} className="w-full">
            {submitting ? <Spinner className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{submitting ? 'Submitting & Anchoring to Audit...' : 'Submit & Sign Field Inspection'}</span>
          </Button>
        </Card>
      </form>
    </div>
  );
}
