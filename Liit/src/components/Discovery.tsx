/**Searches: real PubMed/arXiv retrieval + explicit import.

Results never enter the project until the researcher clicks Import.
No ranking, no recommendations — retrieval order is preserved.*/
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SearchHistoryItem, SearchResponse, SearchResultItem } from '../lib/api';
import { Empty, Err, Loading, friendlyError } from '../lib/states';

interface Props {
  projectId: string | null;
  onPaperImported: (paperId: string) => void;
  onOpenPaper: (paperId: string) => void;
}

type Source = 'pubmed' | 'arxiv';
type ImportState = 'idle' | 'importing' | 'imported' | 'failed';

interface ImportInfo {
  state: ImportState;
  paperId?: string;
  warnings?: string[];
  error?: string;
}

function ResultCard({ result, info, onImport, onOpen }: {
  result: SearchResultItem; info: ImportInfo; onImport: () => void; onOpen: (paperId: string) => void;
}) {
  const idLabel = result.pmid ? `PMID ${result.pmid}`
    : result.arxiv_id ? `arXiv:${result.arxiv_id}`
    : result.doi ? `DOI ${result.doi}` : result.external_id;
  return (
    <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--color-edge)' }}>
      <h3 className="text-[13.5px] font-medium leading-snug mb-1" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
        {result.title || 'Untitled'}
      </h3>
      <div className="text-[11.5px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
        {(result.authors.slice(0, 3).join(', ') || 'Authors not available')}
        {result.authors.length > 3 ? ` +${result.authors.length - 3}` : ''}
        {' · '}{result.journal || 'Source not available'} · {result.year ?? 'Year not available'}
      </div>
      <div className="text-[11px] mb-2 font-mono" style={{ color: 'var(--color-muted)' }}>{idLabel}</div>
      {result.abstract && (
        <p className="text-[12.5px] leading-relaxed mb-3 line-clamp-2" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>
          {result.abstract}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {info.state === 'imported' ? (
          <>
            <span className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'rgba(107,158,140,0.1)', color: 'var(--color-teal)', border: '1px solid rgba(107,158,140,0.2)' }}>
              ✓ In library
            </span>
            {info.paperId && (
              <button onClick={() => onOpen(info.paperId!)}
                className="text-[11px] px-2.5 py-1 rounded transition-colors"
                style={{ color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
                Open paper →
              </button>
            )}
          </>
        ) : (
          <button onClick={onImport} disabled={info.state === 'importing'}
            className="text-[11px] px-2.5 py-1 rounded transition-colors"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)', opacity: info.state === 'importing' ? 0.6 : 1 }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            {info.state === 'importing' ? 'Importing…' : '+ Import'}
          </button>
        )}
        {info.state === 'failed' && info.error && (
          <span className="text-[11px]" style={{ color: 'var(--color-rose)' }}>{info.error}</span>
        )}
      </div>
      {info.state === 'imported' && (info.warnings?.length ?? 0) > 0 && (
        <div className="text-[10.5px] mt-1.5" style={{ color: 'var(--color-amber)' }}>
          {info.warnings!.slice(0, 3).map((w, i) => <div key={i}>· {String(w).slice(0, 160)}</div>)}
        </div>
      )}
    </div>
  );
}

export default function Discovery({ projectId, onPaperImported, onOpenPaper }: Props) {
  const [source, setSource] = useState<Source>('pubmed');
  const [query, setQuery] = useState('');
  const [maxResults, setMaxResults] = useState(10);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [imports, setImports] = useState<Record<string, ImportInfo>>({});

  const loadHistory = useCallback(() => {
    if (!projectId) { setHistory([]); return; }
    api.searchHistory(projectId)
      .then(h => { setHistory(h); setHistoryError(null); })
      .catch(e => { setHistoryError(friendlyError(e, 'Search history')); setHistory([]); });
  }, [projectId]);

  useEffect(loadHistory, [loadHistory]);

  if (!projectId) {
    return <Empty title="No project selected" hint="Create or select a project to search literature." />;
  }

  const run = async (q?: string) => {
    const queryText = (q ?? query).trim();
    if (!queryText || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const fn = source === 'pubmed' ? api.searchPubmed : api.searchArxiv;
      const res = await fn(projectId, { query: queryText, max_results: maxResults });
      setResponse(res);
      setImports({});
      loadHistory();
    } catch (e) {
      setSearchError(friendlyError(e, `${source === 'pubmed' ? 'PubMed' : 'arXiv'} search`));
    } finally {
      setSearching(false);
    }
  };

  const doImport = async (result: SearchResultItem) => {
    if (!projectId || !response) return;
    setImports(prev => ({ ...prev, [result.external_id]: { state: 'importing' } }));
    try {
      const out = await api.importResult({ project_id: projectId, search_id: response.search_id, external_id: result.external_id });
      setImports(prev => ({
        ...prev,
        [result.external_id]: { state: 'imported', paperId: out.paper_id, warnings: out.warnings },
      }));
      onPaperImported(out.paper_id);
    } catch (e) {
      setImports(prev => ({
        ...prev,
        [result.external_id]: { state: 'failed', error: friendlyError(e, 'Import') },
      }));
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-[300px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <h2 className="text-[13px] font-semibold mb-3" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Search literature</h2>
          <div className="flex gap-1 mb-3">
            {(['pubmed', 'arxiv'] as Source[]).map(s => (
              <button key={s} onClick={() => setSource(s)}
                className="flex-1 text-[11px] px-2.5 py-1.5 rounded transition-colors"
                style={{
                  background: source === s ? 'var(--color-lav-dim)' : 'var(--color-bg)',
                  color: source === s ? 'var(--color-lav-light)' : 'var(--color-muted)',
                  border: `1px solid ${source === s ? 'var(--color-lavender)' : 'var(--color-edge)'}`,
                }}>
                {s === 'pubmed' ? 'PubMed' : 'arXiv'}
              </button>
            ))}
          </div>
          <textarea value={query} onChange={e => setQuery(e.target.value)} rows={3}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
            placeholder={source === 'pubmed' ? 'e.g. hippocampal place cells remapping' : 'e.g. hippocampal place cells'}
            className="w-full rounded px-2.5 py-2 text-[11.5px] resize-none outline-none mb-2"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-ink)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }} />
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Max results</span>
            <input type="number" min={1} max={50} value={maxResults} onChange={e => setMaxResults(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
              className="w-16 rounded px-1.5 py-1 text-center outline-none text-[11px]"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }} />
          </div>
          <button onClick={() => run()} disabled={searching || !query.trim()}
            className="w-full py-2 rounded text-[12px] font-medium transition-colors"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-lavender)', opacity: searching || !query.trim() ? 0.6 : 1 }}>
            {searching ? 'Searching…' : 'Run search'}
          </button>
          <div className="text-[10.5px] mt-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
            Retrieval only. Results never enter the project until you import them. No relevance ranking.
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Search history</div>
          {history === null ? <Loading text="Loading history…" /> : historyError ? (
            <div className="text-[11px]" style={{ color: 'var(--color-rose)' }}>{historyError}</div>
          ) : history.length === 0 ? (
            <div className="text-[11.5px]" style={{ color: 'var(--color-muted)' }}>No searches yet.</div>
          ) : (
            <div className="space-y-1.5">
              {history.slice().reverse().map(h => (
                <button key={h.id} onClick={() => { setQuery(h.query); setSource(h.source === 'arxiv' ? 'arxiv' : 'pubmed'); run(h.query); }}
                  className="w-full text-left px-2.5 py-2 rounded transition-colors"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
                  <div className="text-[11.5px] truncate" style={{ color: 'var(--color-sub)' }}>{h.query}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    {h.source} · {h.result_count} results · {h.status}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          {searching ? (
            <span className="text-[12.5px] animate-pulse" style={{ color: 'var(--color-muted)' }}>Searching {source === 'pubmed' ? 'PubMed' : 'arXiv'}…</span>
          ) : response ? (
            <span className="text-[12.5px]" style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-mono)' }}>{response.result_count}</span>
              {' '}results for “<span style={{ color: 'var(--color-sub)' }}>{response.query}</span>” · {response.source}
            </span>
          ) : (
            <span className="text-[12.5px]" style={{ color: 'var(--color-muted)' }}>Run a search to see results.</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {searchError ? <Err message={searchError} onRetry={() => run()} /> : response && response.results.length === 0 ? (
            <Empty title="No results" hint="Try a broader query or the other source." />
          ) : response?.results.map(r => (
            <ResultCard key={r.external_id} result={r}
              info={imports[r.external_id] ?? { state: 'idle' }}
              onImport={() => doImport(r)}
              onOpen={onOpenPaper} />
          ))}
        </div>
      </div>
    </div>
  );
}
