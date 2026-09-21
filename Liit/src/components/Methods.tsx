import { useState } from 'react';
import { papers } from '../data/mockData';
import type { PaperMethod } from '../data/mockData';

interface Props {
  onSelectPaper: (id: string) => void;
}

type MethodType = PaperMethod['type'] | 'all';

const TYPE_COLORS: Record<PaperMethod['type'], string> = {
  approach: 'var(--color-lavender)',
  architecture: 'var(--color-teal)',
  algorithm: 'var(--color-amber)',
  metric: 'var(--color-muted)',
  dataset: 'var(--color-rose)',
};

export default function Methods({ onSelectPaper }: Props) {
  const [filterType, setFilterType] = useState<MethodType>('all');
  const [filterPaperId, setFilterPaperId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allMethods = papers.flatMap(paper =>
    paper.methods.map(m => ({ ...m, paperId: paper.id, paperTitle: paper.title, paperYear: paper.year, paperAuthors: paper.authors }))
  );

  const filtered = allMethods.filter(m => {
    if (filterType !== 'all' && m.type !== filterType) return false;
    if (filterPaperId !== 'all' && m.paperId !== filterPaperId) return false;
    if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase()) && !m.excerpt.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const groupedByType: Partial<Record<PaperMethod['type'], typeof filtered>> = {};
  filtered.forEach(m => {
    if (!groupedByType[m.type]) groupedByType[m.type] = [];
    groupedByType[m.type]!.push(m);
  });

  const types: PaperMethod['type'][] = ['approach', 'architecture', 'algorithm', 'metric', 'dataset'];
  const presentTypes = types.filter(t => groupedByType[t]?.length);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Filter sidebar */}
      <div className="w-[200px] shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Methods</div>
        </div>

        <div className="p-3 space-y-4 overflow-y-auto flex-1">
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Type</div>
            {(['all', ...types] as MethodType[]).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[12px] transition-colors mb-0.5"
                style={{
                  background: filterType === t ? 'var(--color-lav-dim)' : 'transparent',
                  color: filterType === t ? 'var(--color-lav-light)' : 'var(--color-sub)',
                }}>
                <div className="flex items-center gap-2">
                  {t !== 'all' && <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[t as PaperMethod['type']] }} />}
                  <span>{t === 'all' ? 'All types' : t}</span>
                </div>
                <span className="text-[10px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                  {t === 'all' ? allMethods.length : allMethods.filter(m => m.type === t).length}
                </span>
              </button>
            ))}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Paper</div>
            <button onClick={() => setFilterPaperId('all')}
              className="w-full text-left px-2 py-1.5 rounded text-[11.5px] mb-0.5 transition-colors"
              style={{ background: filterPaperId === 'all' ? 'var(--color-lav-dim)' : 'transparent', color: filterPaperId === 'all' ? 'var(--color-lav-light)' : 'var(--color-sub)' }}>
              All papers
            </button>
            {papers.map(p => (
              <button key={p.id} onClick={() => setFilterPaperId(p.id)}
                className="w-full text-left px-2 py-1.5 rounded text-[11px] leading-snug mb-0.5 transition-colors"
                style={{ background: filterPaperId === p.id ? 'var(--color-lav-dim)' : 'transparent', color: filterPaperId === p.id ? 'var(--color-lav-light)' : 'var(--color-muted)' }}>
                {p.title.split(':')[0].substring(0, 28)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Methods list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="flex items-center gap-1.5 flex-1 rounded px-2.5 py-1.5" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Search methods…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[12px] border-0 outline-none"
              style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
          </div>
          <span className="text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
            <span style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>{filtered.length}</span> methods
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 p-3 rounded text-[12px]" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}>
            Excerpts and comparisons are extracted from paper text. Authors' stated advantages are quoted, not evaluated.
          </div>

          {(filterType === 'all' ? presentTypes : [filterType as PaperMethod['type']]).map(type => (
            <div key={type} className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                  {type}
                </h3>
                <div className="flex-1 h-px" style={{ background: 'var(--color-edge)' }} />
              </div>

              <div className="space-y-3">
                {(groupedByType[type] ?? []).map((m, i) => {
                  const uid = `${m.paperId}-${m.name}`;
                  const isExpanded = expandedId === uid;
                  return (
                    <div key={uid} className="rounded overflow-hidden" style={{ border: '1px solid var(--color-edge)' }}>
                      <button className="w-full flex items-start justify-between p-3.5 text-left gap-3 transition-colors"
                        style={{ background: isExpanded ? 'var(--color-panel)' : 'var(--color-surface)' }}
                        onClick={() => setExpandedId(isExpanded ? null : uid)}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--color-surface)'; }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-[13px]" style={{ color: 'var(--color-ink)' }}>{m.name}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                            <button className="hover:underline" onClick={e => { e.stopPropagation(); onSelectPaper(m.paperId); }}
                              style={{ color: 'var(--color-lavender)' }}>
                              {m.paperTitle.split(':')[0].split(' ').slice(0, 4).join(' ')}…
                            </button>
                            <span>·</span>
                            <span>{m.paperAuthors[0]} et al. {m.paperYear}</span>
                            <span>·</span>
                            <span style={{ fontFamily: 'var(--font-mono)' }}>{m.location}</span>
                          </div>
                        </div>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          style={{ color: 'var(--color-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginTop: 2 }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-3.5 pb-3.5 pt-0" style={{ background: 'var(--color-panel)' }}>
                          <blockquote className="text-[12.5px] italic mb-3 pl-3 py-1" style={{ borderLeft: '2px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-serif)' }}>
                            "{m.excerpt}"
                          </blockquote>

                          {(m.comparedTo || m.advantage) && (
                            <div className="grid grid-cols-2 gap-3">
                              {m.comparedTo && (
                                <div className="p-2.5 rounded text-[11.5px]" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
                                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Compared to (per authors)</div>
                                  <div style={{ color: 'var(--color-sub)' }}>{m.comparedTo}</div>
                                </div>
                              )}
                              {m.advantage && (
                                <div className="p-2.5 rounded text-[11.5px]" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
                                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Authors state</div>
                                  <div style={{ color: 'var(--color-sub)' }}>{m.advantage}</div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
