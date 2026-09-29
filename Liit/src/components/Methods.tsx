/**Methods index: the per-paper Methods workspace lives at Library →
paper → Methods. This view lists the active project's papers with their
extraction state so a researcher can jump straight into one. Counts come
from stored evidence (read-only); rows keep the Library's order — no
ranking, comparison, or judgment across papers.*/
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ApiPaper } from '../lib/api';
import { Empty, Err, Loading, StatusChip, friendlyError } from '../lib/states';
import { METHOD_CATEGORIES } from './Library';

interface Props {
  projectId: string | null;
  onSelectPaper: (id: string) => void;
}

export default function Methods({ projectId, onSelectPaper }: Props) {
  const [papers, setPapers] = useState<ApiPaper[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) { setPapers([]); setCounts({}); return; }
    setError(null); setPapers(null); setCounts(null);
    let cancelled = false;
    (async () => {
      try {
        const ps = await api.listPapers(projectId);
        if (cancelled) return;
        setPapers(ps);
        const cs = await Promise.all(ps.map(p =>
          api.listEvidence(p.id)
            .then(ev => ev.filter(e => METHOD_CATEGORIES.includes(e.category)).length)
            .catch(() => null)));
        if (cancelled) return;
        setCounts(Object.fromEntries(ps.map((p, i) => [p.id, cs[i]])));
      } catch (e) {
        if (!cancelled) { setError(friendlyError(e, 'Methods')); setPapers([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, tick]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-[17px] font-semibold mb-1" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Methods</h1>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--color-muted)' }}>
          Open a paper to see what the authors actually did — extracted study design, procedures,
          measures, models, statistics, and reported limitations, each with its source location.
          Organized by category; nothing is ranked or compared.
        </p>
        {error ? <Err message={error} onRetry={() => setTick(t => t + 1)} />
          : papers === null ? <Loading text="Loading papers…" />
          : papers.length === 0 ? (
            <Empty
              title={projectId ? 'No papers in this project yet.' : 'No project selected.'}
              hint={projectId ? 'Add a paper from the Library, or search PubMed/arXiv.' : 'Pick a project, then return here.'} />
          ) : (
            <div className="space-y-2">
              {papers.map(p => {
                const n = counts?.[p.id];
                return (
                  <button key={p.id} onClick={() => onSelectPaper(p.id)}
                    className="w-full text-left px-3 py-2.5 rounded transition-colors"
                    style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12.5px] font-medium leading-snug line-clamp-2" style={{ color: 'var(--color-ink)' }}>
                        {p.title || 'Untitled'}
                      </span>
                      <StatusChip status={p.extraction_status} />
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      {counts === null ? '…'
                        : n == null ? '—'
                        : n === 0 ? 'Not extracted'
                        : `${n} method items`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
