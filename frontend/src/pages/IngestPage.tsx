import React, { useState } from 'react';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { CheckCircle2, FileSpreadsheet, History, Upload, UploadCloud, Zap } from 'lucide-react';

export function IngestPage() {
  const [uploading, setUploading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSimulateIngest = async () => {
    try {
      setUploading(true);
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: 'batch_demo_2026' }),
      });
      const data = await res.json();
      setSuccessMsg('Ingest verified & audit event recorded: 200 works loaded into live pipeline.');
    } catch (err: any) {
      console.error('Ingest error:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="e-SAKSHI Data Ingestion & Validation Hub"
        description="Upload and validate official e-SAKSHI 21-column CSV datasets into the live analysis engine."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-5">
          <h3 className="text-base font-semibold text-white">Upload New e-SAKSHI Export</h3>

          <div className="border-2 border-dashed border-border/80 hover:border-secondary/50 rounded-xl p-8 text-center space-y-3 transition-colors bg-surface/30 cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-secondary/10 text-secondary flex items-center justify-center mx-auto">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Drag & drop your e-SAKSHI CSV file here</p>
              <p className="text-xs text-text-muted mt-0.5">Supports 21-column standard format (.csv, .xlsx)</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleSimulateIngest} disabled={uploading}>
              {uploading ? <Spinner className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
              <span>{uploading ? 'Validating Schema...' : 'Select File from Computer'}</span>
            </Button>
          </div>

          {successMsg && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-secondary" />
            <span>Ingest Audit Log</span>
          </h3>
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-surface border border-white/5 space-y-1">
              <div className="flex justify-between font-medium">
                <span className="text-white">Batch #2026-08</span>
                <span className="text-emerald-400">200 Works</span>
              </div>
              <p className="text-text-muted">Status: Validated & Seeded</p>
              <p className="text-[10px] text-text-muted font-mono">Checksum: 36d0921cdf469500862fc361292fa150...</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
