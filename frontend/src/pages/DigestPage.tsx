import React, { useEffect, useState } from 'react';
import { useAppState } from '../state';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { Download, FileText, Printer, Sparkles } from 'lucide-react';

export function DigestPage() {
  const { selectedDistrict, districts } = useAppState();
  const [digestHtml, setDigestHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const generateDigest = async () => {
    const districtId = selectedDistrict || (districts[0]?.id ?? '1');
    try {
      setLoading(true);
      const res = await fetch('/api/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ district_id: districtId }),
      });
      const data = await res.json();
      if (data.data?.id) {
        const htmlRes = await fetch(`/api/digest/${data.data.id}`);
        const html = await htmlRes.text();
        setDigestHtml(html);
      }
    } catch (err) {
      console.error('Failed to generate digest:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateDigest();
  }, [selectedDistrict]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive District Digest"
        description="Self-contained, email-safe HTML summary generated for District Magistrates and Nodal Officers."
        action={
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="w-4 h-4" />
              <span>Print / Export PDF</span>
            </Button>
            <Button variant="primary" size="sm" onClick={generateDigest} disabled={loading}>
              <Sparkles className="w-4 h-4" />
              <span>{loading ? 'Compiling...' : 'Regenerate Digest'}</span>
            </Button>
          </div>
        }
      />

      <Card className="p-0 overflow-hidden bg-white text-slate-900 border-none shadow-2xl">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-2 text-slate-400">
            <Spinner className="w-8 h-8" />
            <p className="text-sm">Synthesizing digest report...</p>
          </div>
        ) : digestHtml ? (
          <div
            className="p-6 md:p-12 overflow-x-auto flex justify-center"
            dangerouslySetInnerHTML={{ __html: digestHtml }}
          />
        ) : (
          <div className="py-16 text-center text-slate-400">Click generate to compile digest.</div>
        )}
      </Card>
    </div>
  );
}
