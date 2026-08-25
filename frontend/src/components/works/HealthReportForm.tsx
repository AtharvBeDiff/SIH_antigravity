import React, { useState } from 'react';
import { Camera, CheckCircle2, Upload, X } from 'lucide-react';
import { api } from '../../lib/api';

interface HealthReportFormProps {
  workId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function HealthReportForm({ workId, onSuccess, onCancel }: HealthReportFormProps) {
  const [progressPct, setProgressPct] = useState<number>(0);
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Photo evidence is required for a 10-day health report.');
      return;
    }

    try {
      setSubmitting(true);
      setError('');
      
      // In a real app, we would upload the file to Supabase Storage and get a key back.
      // For this demo, we'll simulate an image key.
      const mockImageKey = `health_evidence_${Date.now()}.jpg`;

      await api.healthReports.post({
        work_id: workId,
        progress_pct: progressPct,
        evidence_image_key: mockImageKey,
        remarks: remarks,
        reported_by: 'Field Inspector (Auto)',
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-surface/50 border border-white/5 rounded-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          Submit 10-Day Health Report
        </h3>
        <button onClick={onCancel} className="text-text-muted hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-muted mb-2">
            Current Physical Progress ({progressPct}%)
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={progressPct}
            onChange={(e) => setProgressPct(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
          <div className="flex justify-between text-xs text-text-muted mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-muted mb-2">
            Geotagged Photo Evidence
          </label>
          <div className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center hover:bg-white/5 transition-colors cursor-pointer relative">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            {file ? (
              <div className="flex flex-col items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-8 h-8" />
                <span className="text-sm font-medium">{file.name}</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-muted">
                <Upload className="w-8 h-8 opacity-50" />
                <span className="text-sm">Click or drag photo to upload</span>
                <span className="text-xs opacity-75">JPEG, PNG up to 10MB</span>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-muted mb-2">
            Remarks (Optional)
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full bg-surface border border-white/10 rounded-md p-3 text-white placeholder:text-text-muted/50 focus:outline-none focus:border-emerald-500/50"
            rows={3}
            placeholder="Any issues or blockers?"
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !file}
            className="px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </form>
    </div>
  );
}
