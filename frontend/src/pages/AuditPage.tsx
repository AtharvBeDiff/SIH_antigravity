import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader, Card, Button, Spinner } from '../components/ui';
import { CheckCircle2, Copy, History, Key, Lock, RefreshCw, ShieldAlert, ShieldCheck, Unlock, XCircle, Zap } from 'lucide-react';
import type { AuditEvent } from '../types';

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verification, setVerification] = useState<{
    valid: boolean;
    checked: number;
    first_break: any;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tampering, setTampering] = useState(false);

  const loadChain = async () => {
    try {
      setLoading(true);
      const [eventsRes, verifyRes] = await Promise.all([
        api.audit.list({ limit: '50' }),
        api.audit.verify(),
      ]);
      setEvents(eventsRes || []);
      setVerification(verifyRes);
    } catch (err) {
      console.error('Failed to load audit chain:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChain();
  }, []);

  const handleTamper = async (seq: number) => {
    try {
      setTampering(true);
      await fetch('/api/audit/_demo/tamper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq }),
      });
      await loadChain();
    } catch (err) {
      console.error('Tamper failed:', err);
    } finally {
      setTampering(false);
    }
  };

  const handleRestore = async (seq: number) => {
    try {
      setTampering(true);
      await fetch('/api/audit/_demo/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq }),
      });
      await loadChain();
    } catch (err) {
      console.error('Restore failed:', err);
    } finally {
      setTampering(false);
    }
  };

  const isValid = verification?.valid ?? true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tamper-Evident Cryptographic Ledger"
        description="Append-only hash-chained audit log guaranteeing non-repudiation across state mutations."
        action={
          <Button variant="outline" size="sm" onClick={loadChain}>
            <RefreshCw className="w-4 h-4" />
            <span>Re-Verify Ledger</span>
          </Button>
        }
      />

      {/* Live Hash-Chain Status Card */}
      <Card
        className={`p-6 border transition-all duration-300 ${
          isValid
            ? 'border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_30px_rgba(16,185,129,0.1)]'
            : 'border-destructive/40 bg-destructive/10 shadow-[0_0_30px_rgba(239,68,68,0.2)]'
        }`}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                isValid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-destructive/20 text-destructive animate-bounce'
              }`}
            >
              {isValid ? <ShieldCheck className="w-7 h-7" /> : <ShieldAlert className="w-7 h-7" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">
                  {isValid ? 'Hash Chain Verified & Intact' : 'CRITICAL: Cryptographic Chain Broken!'}
                </h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold ${
                    isValid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-destructive/20 text-destructive'
                  }`}
                >
                  {isValid ? 'CHAIN SECURE' : 'INTEGRITY BREACH'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {isValid
                  ? `All ${verification?.checked ?? 0} sequential audit blocks mathematically validated against sha256 links.`
                  : `Tampering detected at block sequence #${verification?.first_break?.seq}. Reason: ${verification?.first_break?.reason}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isValid ? (
              <Button
                variant="danger"
                size="sm"
                disabled={tampering || events.length === 0}
                onClick={() => handleTamper(events[events.length - 1]?.seq || 1)}
              >
                <Unlock className="w-4 h-4" />
                <span>Simulate Malicious Tampering</span>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                disabled={tampering}
                onClick={() => handleRestore(verification?.first_break?.seq || 1)}
              >
                <Lock className="w-4 h-4" />
                <span>Restore Chain Integrity</span>
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Audit Blocks Stream */}
      <Card className="p-0 overflow-hidden space-y-0">
        <div className="p-4 border-b border-slate-200/50 bg-slate-50/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600" />
            <span>Cryptographic Event Blocks (Sequence 1 → Head)</span>
          </h3>
          <span className="text-xs text-slate-500 font-mono">Genesis = 0000000000000000...</span>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-2 text-slate-500">
            <Spinner className="w-8 h-8" />
            <p className="text-sm">Traversing hash ledger...</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 font-mono text-xs">
            {events.map((evt) => {
              const isTamperedBlock = !isValid && verification?.first_break?.seq === evt.seq;
              return (
                <div
                  key={evt.seq}
                  className={`p-5 transition-colors space-y-3 ${
                    isTamperedBlock ? 'bg-destructive/15 border-l-4 border-destructive' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-blue-600/20 text-blue-600 font-bold">
                        SEQ #{evt.seq}
                      </span>
                      <strong className="text-slate-900 text-sm">{evt.action}</strong>
                      <span className="text-slate-500 font-sans text-xs">
                        by <span className="text-slate-900">{evt.actor}</span> on {evt.entity_type}:{evt.entity_id.slice(0, 8)}
                      </span>
                    </div>
                    <span className="text-slate-500 text-[11px]">
                      {new Date(evt.created_at).toLocaleString('en-IN')}
                    </span>
                  </div>

                  {/* Cryptographic Linkage Block */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50/90 border border-white/5 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Previous Hash (H_prev):</span>
                      <span className="text-slate-500 break-all">{evt.prev_hash.slice(0, 24)}...</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Payload Hash (H_data):</span>
                      <span className="text-blue-600 break-all">{evt.payload_hash.slice(0, 24)}...</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">This Block Hash (H_this):</span>
                      <span className="text-emerald-400 font-bold break-all">{evt.this_hash.slice(0, 24)}...</span>
                    </div>
                  </div>

                  {/* Payload Details */}
                  <div className="text-[11px] text-slate-500 font-sans">
                    <span className="font-semibold text-slate-900">Payload:</span>{' '}
                    <code className="text-xs text-slate-500 font-mono">{JSON.stringify(evt.payload)}</code>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
