import { useState } from 'react';
import { papers } from '../data/mockData';

interface Props {
  onSelectPaper: (id: string) => void;
}

type Source = 'semantic' | 'pubmed' | 'arxiv' | 'citation';

const MOCK_RESULTS = [
  { id: 'r_1', title: 'Improving Language Understanding by Generative Pre-Training', authors: ['Radford, A.', 'Narasimhan, K.', 'Salimans, T.', 'Sutskever, I.'], year: 2018, journal: 'OpenAI Blog', citations: 12890, openAccess: true, sjr: 'NA', discoveredBy: 'citation', provenance: 'Cited by BERT (Devlin et al. 2018)', abstract: 'We demonstrate that large gains on NLP tasks can be realized by generative pre-training of a language model on a diverse corpus of unlabeled text, followed by discriminative fine-tuning.' },
  { id: 'r_2', title: 'Improving Abstractive Summarization with Evidence-Based Explanations', authors: ['Côté, M-A.', 'Bouchard, G.', 'et al.'], year: 2021, journal: 'ACL 2021', citations: 234, openAccess: true, sjr: 'Q1', discoveredBy: 'semantic', provenance: 'Semantic similarity to BERT (0.72)', abstract: 'We explore how explanations of model decisions can be used as additional supervision for abstractive summarization.' },
  { id: 'r_3', title: 'Hierarchical Neural Story Generation', authors: ['Fan, A.', 'Lewis, M.', 'Dauphin, Y.'], year: 2018, journal: 'ACL 2018', citations: 1432, openAccess: true, sjr: 'Q1', discoveredBy: 'semantic', provenance: 'Semantic similarity to GPT-3 (0.68)', abstract: 'We explore hierarchical story generation where a model first generates a premise, and then generates a story conditioned on that premise.' },
  { id: 'r_4', title: 'Scaling Laws for Neural Language Models', authors: ['Kaplan, J.', 'McCandlish, S.', 'Henighan, T.'], year: 2020, journal: 'arXiv preprint', citations: 5234, openAccess: true, sjr: 'NA', discoveredBy: 'pubmed', provenance: 'PubMed: "scaling laws neural models"', abstract: 'We study empirical scaling laws for language model performance on the cross-entropy loss. The loss scales as a power-law with model size, dataset size, and the amount of compute used for training.' },
  { id: 'r_5', title: 'Score-Based Generative Modeling through Stochastic Differential Equations', authors: ['Song, Y.', 'Sohl-Dickstein, J.', 'Kingma, D.P.'], year: 2021, journal: 'ICLR 2021', citations: 4821, openAccess: true, sjr: 'Q1', discoveredBy: 'citation', provenance: 'Cited by DDPM (Ho et al. 2020)', abstract: 'We present a framework for score-based generative modeling through stochastic differential equations (SDEs).' },
  { id: 'r_6', title: 'Constitutional AI: Harmlessness from AI Feedback', authors: ['Bai, Y.', 'Jones, A.', 'Ndousse, K.'], year: 2022, journal: 'Anthropic Research', citations: 2143, openAccess: true, sjr: 'NA', discoveredBy: 'semantic', provenance: 'Semantic similarity to InstructGPT (0.81)', abstract: 'We introduce a method for training a harmless AI assistant using a set of principles. The method uses self-critique and revision to improve model outputs.' },
];

const PROVENANCE_TREE = [
  { id: 'p1', label: 'Attention Is All You Need (seed)', level: 0, type: 'seed' },
  { id: 'p2', label: 'BERT (cited-by)', level: 1, type: 'citation', parent: 'p1' },
  { id: 'r_1', label: "GPT (BERT reference)", level: 2, type: 'citation', parent: 'p2' },
  { id: 'p3', label: 'GPT-3 (semantic sim.)', level: 1, type: 'semantic', parent: 'p1' },
  { id: 'r_4', label: 'Scaling Laws (GPT-3 ref.)', level: 2, type: 'citation', parent: 'p3' },
  { id: 'r_6', label: 'Constitutional AI (semantic)', level: 2, type: 'semantic', parent: 'p3' },
];

const TYPE_COLORS: Record<string, string> = {
  seed: 'var(--color-lavender)',
  citation: 'var(--color-teal)',
  semantic: 'var(--color-amber)',
  pubmed: 'var(--color-muted)',
};

export default function Discovery({ onSelectPaper }: Props) {
  const [activeSource, setActiveSource] = useState<Source>('semantic');
  const [query, setQuery] = useState('');
  const [pubmedQuery, setPubmedQuery] = useState('transformer attention mechanism[Title/Abstract] AND (2017:2024[pdat])');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [searchMode, setSearchMode] = useState<'query' | 'expand'>('query');
  const [seedPaperId, setSeedPaperId] = useState('p1');
  const [expandDepth, setExpandDepth] = useState(2);
  const [results] = useState(MOCK_RESULTS);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const sources: { id: Source; label: string }[] = [
    { id: 'semantic', label: 'Semantic Scholar' },
    { id: 'pubmed', label: 'PubMed' },
    { id: 'arxiv', label: 'arXiv' },
    { id: 'citation', label: 'Citation traversal' },
  ];

  const inLibraryIds = new Set(papers.map(p => p.id));

  const filteredResults = results.filter(r => {
    if (activeSource !== 'semantic' && r.discoveredBy !== activeSource) return false;
    if (query && !r.title.toLowerCase().includes(query.toLowerCase()) && !r.authors.some(a => a.toLowerCase().includes(query.toLowerCase()))) return false;
    return true;
  });

  return (
    <div className="flex h-full overflow-hidden">
      {/* Search panel */}
      <div className="w-[320px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <h2 className="text-[13px] font-semibold mb-3" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Discovery</h2>

          {/* Source tabs */}
          <div className="flex flex-wrap gap-1 mb-3">
            {sources.map(s => (
              <button key={s.id} onClick={() => setActiveSource(s.id)}
                className="text-[11px] px-2.5 py-1 rounded transition-colors"
                style={{
                  background: activeSource === s.id ? 'var(--color-lav-dim)' : 'var(--color-bg)',
                  color: activeSource === s.id ? 'var(--color-lav-light)' : 'var(--color-muted)',
                  border: `1px solid ${activeSource === s.id ? 'var(--color-lavender)' : 'var(--color-edge)'}`,
                }}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Mode toggle */}
          <div className="flex rounded mb-3 overflow-hidden" style={{ border: '1px solid var(--color-edge)' }}>
            {[{ id: 'query', label: 'Query' }, { id: 'expand', label: 'Expand from paper' }].map(m => (
              <button key={m.id} onClick={() => setSearchMode(m.id as 'query' | 'expand')}
                className="flex-1 text-[11px] py-1.5 transition-colors"
                style={{
                  background: searchMode === m.id ? 'var(--color-panel)' : 'transparent',
                  color: searchMode === m.id ? 'var(--color-lav-light)' : 'var(--color-muted)',
                }}>
                {m.label}
              </button>
            ))}
          </div>

          {searchMode === 'query' && (
            <>
              {activeSource === 'pubmed' ? (
                <div className="mb-2">
                  <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--color-muted)' }}>PubMed query</label>
                  <textarea value={pubmedQuery} onChange={e => setPubmedQuery(e.target.value)} rows={3}
                    className="w-full rounded px-2.5 py-2 text-[11.5px] resize-none outline-none"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-ink)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }} />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded px-2.5 py-1.5 mb-2" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  <input type="text" placeholder={`Search ${activeSource === 'semantic' ? 'Semantic Scholar' : 'arXiv'}…`} value={query} onChange={e => setQuery(e.target.value)}
                    className="flex-1 bg-transparent text-[12px] border-0 outline-none"
                    style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
                </div>
              )}

              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] mb-2 flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d={showAdvanced ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
                </svg>
                Advanced filters
              </button>

              {showAdvanced && (
                <div className="space-y-2 mb-2 p-2.5 rounded" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
                  {[
                    { label: 'Date range', value: '2017–2024' },
                    { label: 'SJR Quartile', value: 'Q1, Q2' },
                    { label: 'Open Access', value: 'Yes' },
                    { label: 'Publication type', value: 'Conference, Journal' },
                  ].map(f => (
                    <div key={f.label} className="flex items-center justify-between text-[11px]">
                      <span style={{ color: 'var(--color-muted)' }}>{f.label}</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-panel)', color: 'var(--color-sub)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {searchMode === 'expand' && (
            <div className="space-y-2 mb-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--color-muted)' }}>Seed paper</label>
                <select value={seedPaperId} onChange={e => setSeedPaperId(e.target.value)}
                  className="w-full rounded px-2.5 py-1.5 text-[11.5px] outline-none"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-ink)' }}>
                  {papers.map(p => (
                    <option key={p.id} value={p.id}>{p.title.substring(0, 40)}…</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--color-muted)' }}>Expansion depth</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={1} max={4} value={expandDepth} onChange={e => setExpandDepth(Number(e.target.value))} className="flex-1" style={{ accentColor: 'var(--color-lavender)' }} />
                  <span className="text-[11px] w-4" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>{expandDepth}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {['cites', 'cited-by', 'semantic', 'co-authors'].map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          <button className="w-full py-2 rounded text-[12px] font-medium transition-colors"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-lavender)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(160,142,207,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-lav-dim)')}>
            Run Search
          </button>
        </div>

        {/* Provenance tree */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Discovery provenance</div>
          <div className="space-y-1">
            {PROVENANCE_TREE.map(node => (
              <div key={node.id} className="flex items-start gap-2 text-[11.5px]"
                style={{ paddingLeft: node.level * 16 }}>
                <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: TYPE_COLORS[node.type] }} />
                <span style={{ color: node.level === 0 ? 'var(--color-ink)' : 'var(--color-sub)' }}>
                  {node.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="text-[12.5px]" style={{ color: 'var(--color-muted)' }}>
            <span style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-mono)' }}>{filteredResults.length}</span> results
            {query && <span className="ml-1">for "<span style={{ color: 'var(--color-sub)' }}>{query}</span>"</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
            <span>Sort: Relevance</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredResults.map(result => {
            const isInLibrary = inLibraryIds.has(result.id) || addedIds.has(result.id);
            return (
              <div key={result.id} className="px-5 py-4 border-b transition-colors"
                style={{ borderColor: 'var(--color-edge)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h3 className="text-[13.5px] font-medium leading-snug" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                    {result.title}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    {result.openAccess && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded badge-oa">OA</span>
                    )}
                    {result.sjr !== 'NA' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded badge-q1">{result.sjr}</span>
                    )}
                  </div>
                </div>

                <div className="text-[11.5px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
                  {result.authors.slice(0, 3).join(', ')}{result.authors.length > 3 ? ` +${result.authors.length - 3}` : ''} · {result.journal} · {result.year} ·
                  <span className="ml-1" style={{ fontFamily: 'var(--font-mono)' }}>{result.citations.toLocaleString()} cit.</span>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[result.discoveredBy] }} />
                  <span className="text-[11px] italic" style={{ color: 'var(--color-muted)' }}>{result.provenance}</span>
                </div>

                <p className="text-[12.5px] leading-relaxed mb-3 line-clamp-2" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>
                  {result.abstract}
                </p>

                <div className="flex items-center gap-2">
                  {isInLibrary ? (
                    <span className="text-[11px] px-2.5 py-1 rounded" style={{ background: 'rgba(107,158,140,0.1)', color: 'var(--color-teal)', border: '1px solid rgba(107,158,140,0.2)' }}>
                      ✓ In library
                    </span>
                  ) : (
                    <button onClick={() => setAddedIds(prev => new Set([...prev, result.id]))}
                      className="text-[11px] px-2.5 py-1 rounded transition-colors"
                      style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
                      + Add to library
                    </button>
                  )}
                  <button className="text-[11px] px-2.5 py-1 rounded transition-colors"
                    style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-sub)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                    Find similar
                  </button>
                  <button className="text-[11px] px-2.5 py-1 rounded transition-colors"
                    style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-sub)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                    Expand references
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
