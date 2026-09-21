import { useState } from 'react';
import { papers, collections } from '../data/mockData';
import type { Paper } from '../data/mockData';

interface Props {
  selectedPaperId: string | null;
  onSelectPaper: (id: string) => void;
}

type Tab = 'overview' | 'fulltext' | 'methods' | 'references' | 'code' | 'learn';

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono ${className}`}>
      {children}
    </span>
  );
}

function PaperFullText({ paper }: { paper: Paper }) {
  const lines = paper.fullTextSample.split('\n');
  return (
    <div className="text-[13.5px] leading-relaxed selectable-text" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <h4 key={i} className="font-semibold mt-5 mb-2 text-sm" style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-sans)' }}>
              {line.slice(2, -2)}
            </h4>
          );
        }
        if (line.trim().startsWith('    ') || line.trim().startsWith('\t')) {
          return (
            <pre key={i} className="my-2 px-3 py-2 rounded text-[12px] overflow-x-auto" style={{ fontFamily: 'var(--font-mono)', background: 'rgba(160,142,207,0.06)', border: '1px solid var(--color-edge)', color: 'var(--color-lav-light)' }}>
              {line.trim()}
            </pre>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-3" />;
        return <p key={i} className="mb-0">{line}</p>;
      })}
    </div>
  );
}

function LearnPanel({ paper }: { paper: Paper }) {
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [explanation, setExplanation] = useState<{ text: string; query: string } | null>(null);
  const [explanationType, setExplanationType] = useState<string>('');

  const handleMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setSelection(null); return; }
    const text = sel.toString().trim();
    if (text.length < 4) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const container = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSelection({ text, x: rect.left - container.left + rect.width / 2, y: rect.top - container.top - 6 });
  };

  const explain = (type: string) => {
    if (!selection) return;
    setExplanationType(type);
    const t = selection.text;
    let resp = '';
    if (t.includes('softmax') || t.includes('QK') || t.includes('√d')) {
      resp = 'This is the scaled dot-product attention formula. Q (queries), K (keys), and V (values) are linear projections of the input. The dot product QKᵀ measures pairwise similarity between queries and keys. Dividing by √d_k prevents the magnitudes from growing large in high dimensions, which would push softmax into saturation (near-zero gradients). The softmax converts similarity scores to a probability distribution, which weights the values V in a convex combination.';
    } else if (t.includes('MultiHead') || t.includes('Concat(head')) {
      resp = 'Multi-head attention runs h independent attention functions in parallel, each in a lower-dimensional subspace (d_model/h). The outputs are concatenated and projected back to d_model. This allows each head to specialize in different types of relationships — some heads attend to syntactic dependencies, others to semantic similarity, and others to positional patterns.';
    } else if (t.includes('PE') || t.includes('sin(pos') || t.includes('pos /')) {
      resp = 'This is the sinusoidal positional encoding. Since the Transformer has no inherent notion of sequence order (unlike RNNs), positional information is injected by adding a fixed encoding to each token embedding. Different frequencies are used for different dimensions. The sinusoidal choice means encodings for two positions at distance k are related by a linear transformation — this may help the model generalize to sequence lengths not seen during training.';
    } else if (t.includes('L_simple') || t.includes('ε_θ') || t.includes('√ᾱ')) {
      resp = 'This is the simplified denoising objective for diffusion models. The network ε_θ is trained to predict the Gaussian noise ε that was added to x_0 to obtain x_t. The loss is a mean squared error between the true noise and the predicted noise. This is equivalent (with reweighting) to the full variational lower bound, but empirically more stable and effective.';
    } else if (t.includes('q(x_t') || t.includes('N(x_t') || t.includes('β_t')) {
      resp = 'This defines the forward diffusion process — a fixed Markov chain that gradually corrupts data x_0 with Gaussian noise. At each step t, the distribution of x_t given x_{t-1} is Gaussian with mean √(1-β_t)·x_{t-1} (shrinking toward zero) and variance β_t·I. The signal-to-noise ratio decreases monotonically; at t=T, x_T is approximately pure Gaussian noise.';
    } else if (t.includes('KL') || t.includes('π_φ') || t.includes('PPO') || t.includes('objective(φ)')) {
      resp = 'This is the RLHF training objective. The first term maximizes the reward r_θ from the reward model. The KL-divergence penalty (β·KL[...]) prevents the policy from deviating too far from the supervised fine-tuned (SFT) baseline, which mitigates reward hacking. The pretraining term (γ·E[...]) maintains performance on general NLP tasks by keeping the model on the distribution of pre-training data.';
    } else if (t.includes('chain of thought') || t.includes('Chain-of-Thought') || t.includes('step by step')) {
      resp = 'Chain-of-thought prompting works by showing the model exemplars where intermediate reasoning steps are written out before the final answer. This pattern in the context encourages the model to generate its own reasoning steps. The key finding is this only reliably works above ~100B parameters — it appears to be an emergent capability that requires sufficient model capacity to execute multi-step reasoning.';
    } else if (t.includes('contrastive') || t.includes('cos(v') || t.includes('cosine similarity')) {
      resp = 'This is a contrastive objective — specifically InfoNCE / symmetric cross-entropy. For each image in a batch of N, the model must identify its correct text pair among N options (and vice versa). By maximizing agreement between matched pairs and minimizing it for mismatched ones, the model learns a shared embedding space. The temperature τ controls how sharply peaked the softmax distribution is.';
    } else {
      resp = `The passage you selected — "${t.substring(0, 80)}${t.length > 80 ? '…' : ''}" — describes a technical component of the method as presented by the authors. For the precise interpretation, consult the surrounding context in the paper (${paper.title}) at the cited section and any referenced prior work listed in the references tab.`;
    }
    setExplanation({ text: resp, query: t });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5 relative" onMouseUp={handleMouseUp}>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(160,142,207,0.1)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>
            Select text to request contextual explanation
          </span>
        </div>
        <PaperFullText paper={paper} />

        {selection && (
          <div
            className="absolute z-20 flex gap-1 animate-fade-in"
            style={{ left: selection.x - 120, top: selection.y - 72, minWidth: 240 }}
          >
            <div className="rounded shadow-lg p-1 flex flex-col gap-1" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
              <div className="text-[10px] px-2 py-1" style={{ color: 'var(--color-muted)' }}>
                "{selection.text.substring(0, 40)}{selection.text.length > 40 ? '…' : ''}"
              </div>
              {[
                { type: 'explain', label: 'Explain this' },
                { type: 'equation', label: 'Decode equation / notation' },
                { type: 'intuition', label: 'Build intuition' },
                { type: 'context', label: 'Why here in paper?' },
              ].map(opt => (
                <button
                  key={opt.type}
                  onClick={() => explain(opt.type)}
                  className="text-left px-2.5 py-1.5 rounded text-[12px] transition-colors"
                  style={{ color: 'var(--color-lav-light)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(160,142,207,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {explanation && (
        <div className="w-72 shrink-0 border-l overflow-y-auto p-4 animate-slide-in" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-panel-alt)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium" style={{ color: 'var(--color-lavender)' }}>Explanation</span>
            <button onClick={() => setExplanation(null)} style={{ color: 'var(--color-muted)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="text-[11px] px-2 py-1.5 rounded mb-3 italic" style={{ background: 'rgba(160,142,207,0.07)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)' }}>
            "{explanation.query.substring(0, 60)}{explanation.query.length > 60 ? '…' : ''}"
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-serif)' }}>
            {explanation.text}
          </p>
          <div className="mt-4 pt-3 border-t text-[11px]" style={{ borderColor: 'var(--color-edge)', color: 'var(--color-muted)' }}>
            Source: {paper.title}, {paper.year}. Explanation is based on the selected passage and does not include external scientific judgment.
          </div>
        </div>
      )}
    </div>
  );
}

export default function Library({ selectedPaperId, onSelectPaper }: Props) {
  const [selectedCollectionId, setSelectedCollectionId] = useState('c_all');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPapers = papers.filter(p => {
    const inCollection = selectedCollectionId === 'c_all' || p.collectionIds.includes(selectedCollectionId);
    const matchSearch = !searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.authors.some(a => a.toLowerCase().includes(searchQuery.toLowerCase()));
    return inCollection && matchSearch;
  });

  const selectedPaper = papers.find(p => p.id === selectedPaperId) ?? papers[0];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'fulltext', label: 'Full Text' },
    { id: 'methods', label: 'Methods' },
    { id: 'references', label: 'References' },
    { id: 'code', label: 'Code' },
    { id: 'learn', label: 'Learn' },
  ];

  return (
    <div className="flex h-full">
      {/* Collections panel */}
      <div className="w-[180px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Collections</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {collections.map(col => (
            <button
              key={col.id}
              onClick={() => setSelectedCollectionId(col.id)}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-[12.5px] transition-colors text-left ${selectedCollectionId === col.id ? 'collection-active' : 'collection-inactive'}`}
              style={{ color: selectedCollectionId === col.id ? 'var(--color-lav-light)' : 'var(--color-sub)' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span style={{ color: col.color ?? 'var(--color-muted)', fontSize: 10 }}>{col.icon}</span>
                <span className="truncate">{col.name}</span>
              </div>
              <span className="text-[10px] shrink-0" style={{ color: 'var(--color-muted)' }}>{col.count}</span>
            </button>
          ))}
        </div>
        <div className="p-2 border-t" style={{ borderColor: 'var(--color-edge)' }}>
          <button className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11.5px] transition-colors" style={{ color: 'var(--color-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            New Collection
          </button>
        </div>
      </div>

      {/* Papers list */}
      <div className="w-[280px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="flex-1 flex items-center gap-1.5 rounded px-2 py-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input
              type="text"
              placeholder="Filter papers…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[12px] border-0 outline-none"
              style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredPapers.map(paper => (
            <button
              key={paper.id}
              onClick={() => { onSelectPaper(paper.id); setActiveTab('overview'); }}
              className={`w-full text-left px-3 py-2.5 border-b transition-colors ${paper.id === selectedPaperId ? 'paper-row-active' : 'paper-row-inactive'}`}
              style={{ borderColor: 'var(--color-edge)' }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[12.5px] font-medium leading-snug line-clamp-2" style={{ color: paper.id === selectedPaperId ? 'var(--color-ink)' : 'var(--color-sub)' }}>
                  {paper.title}
                </span>
                {paper.saved && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--color-lavender)" className="shrink-0 mt-0.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                )}
              </div>
              <div className="text-[11px] truncate mb-1" style={{ color: 'var(--color-muted)' }}>
                {paper.authors[0]}{paper.authors.length > 1 ? ` +${paper.authors.length - 1}` : ''} · {paper.year}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className={paper.sjrQuartile === 'Q1' ? 'badge-q1' : paper.sjrQuartile === 'Q2' ? 'badge-q2' : 'badge-q3'}>
                  {paper.sjrQuartile}
                </Badge>
                {paper.openAccess && <Badge className="badge-oa">OA</Badge>}
                <span className="text-[10px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                  {paper.citations.toLocaleString()} cit.
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Paper detail / reader */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        {selectedPaper ? (
          <>
            {/* Paper header */}
            <div className="px-5 pt-4 pb-0 border-b" style={{ borderColor: 'var(--color-edge)' }}>
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-[15px] font-semibold leading-snug mb-1" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                    {selectedPaper.title}
                  </h2>
                  <div className="text-[12px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
                    {selectedPaper.authors.join(' · ')}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    <span style={{ color: 'var(--color-sub)' }}>{selectedPaper.journal}</span>
                    <span>·</span>
                    <span>{selectedPaper.year}</span>
                    <span>·</span>
                    <Badge className={selectedPaper.sjrQuartile === 'Q1' ? 'badge-q1' : 'badge-q2'}>{selectedPaper.sjrQuartile}</Badge>
                    {selectedPaper.openAccess && <Badge className="badge-oa">Open Access</Badge>}
                    <span className="font-mono">{selectedPaper.citations.toLocaleString()} citations</span>
                    <span>·</span>
                    <span className="italic">{selectedPaper.discoverySource}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedPaper.tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lavender)', border: '1px solid var(--color-edge)' }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {selectedPaper.arxivId && (
                    <span className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)' }}>
                      arXiv:{selectedPaper.arxivId}
                    </span>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-0 -mb-px">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-[12px] font-medium transition-colors ${activeTab === tab.id ? 'tab-active' : 'tab-inactive'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === 'overview' && (
                <div className="p-5 max-w-2xl">
                  <h3 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>Abstract</h3>
                  <p className="text-[14px] leading-relaxed mb-5" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                    {selectedPaper.abstract}
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Bibliometric</div>
                      <div className="space-y-1.5">
                        {[
                          { label: 'Citations', value: selectedPaper.citations.toLocaleString() },
                          { label: 'SJR Quartile', value: selectedPaper.sjrQuartile },
                          { label: 'Open Access', value: selectedPaper.openAccess ? 'Yes' : 'No' },
                          { label: 'arXiv ID', value: selectedPaper.arxivId ?? '—' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between text-[12px]">
                            <span style={{ color: 'var(--color-muted)' }}>{label}</span>
                            <span style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Discovery</div>
                      <div className="space-y-1.5">
                        {[
                          { label: 'Found via', value: selectedPaper.discoverySource },
                          { label: 'Similarity', value: selectedPaper.similarity != null ? `${(selectedPaper.similarity * 100).toFixed(0)}%` : '—' },
                          { label: 'Methods', value: `${selectedPaper.methods.length}` },
                          { label: 'References', value: `${selectedPaper.references.length}` },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between text-[12px]">
                            <span style={{ color: 'var(--color-muted)' }}>{label}</span>
                            <span className="text-right max-w-[120px] truncate" style={{ color: 'var(--color-sub)', fontSize: 11 }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'fulltext' && (
                <div className="p-5 max-w-2xl">
                  <PaperFullText paper={selectedPaper} />
                </div>
              )}

              {activeTab === 'methods' && (
                <div className="p-5">
                  <div className="space-y-3">
                    {selectedPaper.methods.map((m, i) => (
                      <div key={i} className="p-4 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <span className="font-medium text-[13px]" style={{ color: 'var(--color-lav-light)' }}>{m.name}</span>
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-lav-dim)', color: 'var(--color-muted)' }}>{m.type}</span>
                          </div>
                          <span className="text-[10.5px] shrink-0" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{m.location}</span>
                        </div>
                        <blockquote className="text-[12.5px] italic mb-3 pl-3" style={{ borderLeft: '2px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-serif)' }}>
                          {m.excerpt}
                        </blockquote>
                        {m.comparedTo && (
                          <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                            <div>
                              <span style={{ color: 'var(--color-muted)' }}>Compared to: </span>
                              <span style={{ color: 'var(--color-sub)' }}>{m.comparedTo}</span>
                            </div>
                            {m.advantage && (
                              <div>
                                <span style={{ color: 'var(--color-muted)' }}>Authors note: </span>
                                <span style={{ color: 'var(--color-sub)' }}>{m.advantage}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'references' && (
                <div className="p-5">
                  <div className="space-y-2">
                    {selectedPaper.references.map(ref => (
                      <div key={ref.id} className="flex items-start gap-3 px-3 py-2.5 rounded transition-colors" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] mb-0.5" style={{ color: 'var(--color-ink)' }}>{ref.title}</div>
                          <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                            {ref.authors.join(', ')} · {ref.journal} · {ref.year}
                          </div>
                        </div>
                        {ref.inLibrary && (
                          <Badge className="badge-oa shrink-0">In Library</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'code' && (
                <div className="p-5">
                  {selectedPaper.codeRepos.length > 0 ? (
                    <div className="space-y-4">
                      {selectedPaper.codeRepos.map((repo, i) => (
                        <div key={i} className="p-4 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <span className="font-medium text-[13px]" style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>{repo.name}</span>
                              <span className="ml-2 text-[10px]" style={{ color: 'var(--color-muted)' }}>{repo.language}</span>
                            </div>
                            <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                              {repo.stars.toLocaleString()}
                            </div>
                          </div>
                          <p className="text-[12px] mb-3" style={{ color: 'var(--color-sub)' }}>{repo.description}</p>
                          <div className="mb-3">
                            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Relevant files</div>
                            {repo.relevantFiles.map(f => (
                              <div key={f} className="text-[11.5px] py-0.5" style={{ color: 'var(--color-lavender)', fontFamily: 'var(--font-mono)' }}>{f}</div>
                            ))}
                          </div>
                          {repo.pseudoAlgorithm && (
                            <div>
                              <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Pseudo-algorithm</div>
                              <pre className="text-[11px] p-3 rounded overflow-x-auto" style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', lineHeight: 1.7 }}>
                                {repo.pseudoAlgorithm}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                      <div className="text-[12px] mb-3" style={{ color: 'var(--color-muted)' }}>No public repository found for this paper. Labelled pseudo-algorithm from extracted methods:</div>
                      {selectedPaper.methods.slice(0, 1).map((m, i) => (
                        <div key={i}>
                          <div className="text-[11px] mb-1.5" style={{ color: 'var(--color-lavender)', fontFamily: 'var(--font-mono)' }}># {m.name}</div>
                          <pre className="text-[11px] p-3 rounded" style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                            {m.excerpt}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'learn' && (
                <LearnPanel paper={selectedPaper} />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
            <span className="text-sm">Select a paper to begin reading</span>
          </div>
        )}
      </div>
    </div>
  );
}
