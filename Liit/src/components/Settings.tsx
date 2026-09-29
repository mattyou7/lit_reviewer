/**Settings: backend connection status (real). No fake toggles.*/
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Err, Loading } from '../lib/states';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';

export default function Settings() {
  const [health, setHealth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setHealth(null);
    api.health()
      .then(h => setHealth(h.status))
      .catch(() => setError(`Cannot reach the LiiT backend at ${API_BASE}. Start it, then retry.`));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 max-w-xl">
        <h1 className="text-[17px] font-semibold mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Settings</h1>
        <div className="p-4 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Backend connection</div>
          <div className="text-[12px] mb-2 font-mono" style={{ color: 'var(--color-sub)' }}>{API_BASE}</div>
          {error ? <Err message={error} onRetry={load} /> : health === null ? <Loading text="Checking backend…" /> : (
            <div className="text-[12px]" style={{ color: 'var(--color-teal)' }}>● Backend reachable (status: {health})</div>
          )}
          <div className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            LiiT is local-first. Papers stay on this machine; only search queries go to PubMed / arXiv.
            Set VITE_API_BASE to point at a different backend.
          </div>
        </div>
      </div>
    </div>
  );
}
