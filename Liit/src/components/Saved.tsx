import { papers, savedSearches } from '../data/mockData';

interface Props {
  onSelectPaper: (id: string) => void;
}

export default function Saved({ onSelectPaper }: Props) {
  const savedPapers = papers.filter(p => p.saved);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-[17px] font-semibold mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Saved</h1>

        <section className="mb-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
            Saved papers <span style={{ fontFamily: 'var(--font-mono)' }}>({savedPapers.length})</span>
          </h2>
          <div className="space-y-2">
            {savedPapers.map(paper => (
              <div key={paper.id}
                className="flex items-start gap-3 p-3.5 rounded cursor-pointer transition-colors"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)' }}
                onClick={() => onSelectPaper(paper.id)}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-lavender)" className="shrink-0 mt-0.5">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium mb-0.5" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>{paper.title}</div>
                  <div className="text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
                    {paper.authors[0]}{paper.authors.length > 1 ? ` +${paper.authors.length - 1}` : ''} · {paper.journal} · {paper.year}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(107,158,140,0.15)', color: 'var(--color-teal)' }}>{paper.sjrQuartile}</span>
                  <span className="text-[10.5px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{paper.citations.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
            Saved searches <span style={{ fontFamily: 'var(--font-mono)' }}>({savedSearches.length})</span>
          </h2>
          <div className="space-y-2">
            {savedSearches.map(s => (
              <div key={s.id} className="p-3.5 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)' }}>
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="text-[13px] font-medium" style={{ color: 'var(--color-ink)' }}>{s.name}</div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)' }}>{s.count} results</span>
                    <span className="text-[10px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{s.date}</span>
                  </div>
                </div>
                <p className="text-[12px] mb-2" style={{ color: 'var(--color-muted)' }}>{s.description}</p>
                <div className="text-[11px] px-2 py-1 rounded inline-flex" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)' }}>
                  {s.source}: {s.query.substring(0, 60)}{s.query.length > 60 ? '…' : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
