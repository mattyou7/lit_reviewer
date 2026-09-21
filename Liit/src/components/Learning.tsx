import { useState, useRef } from 'react';
import { papers } from '../data/mockData';

interface Props {
  selectedPaperId: string | null;
  onSelectPaper: (id: string) => void;
}

interface SelectionPopup {
  text: string;
  x: number;
  y: number;
}

interface Explanation {
  query: string;
  type: string;
  text: string;
  paperId: string;
}

const EXPLAIN_OPTIONS = [
  { type: 'explain', label: 'Explain this passage', icon: '◎' },
  { type: 'equation', label: 'Decode notation / equation', icon: '∑' },
  { type: 'intuition', label: 'Build intuition', icon: '⟳' },
  { type: 'context', label: 'Why is this here?', icon: '↳' },
  { type: 'connect', label: 'Connect to other work', icon: '⟶' },
];

function getExplanation(text: string, type: string, paperId: string): string {
  const t = text.toLowerCase();

  if (t.includes('softmax') || t.includes('qk') || t.includes('√d') || t.includes('scaled dot')) {
    if (type === 'equation' || type === 'explain') {
      return 'The scaled dot-product attention formula Attention(Q, K, V) = softmax(QKᵀ/√d_k)V computes attention weights by (1) taking the dot product of queries Q with transposed keys Kᵀ — measuring pairwise similarity; (2) scaling by 1/√d_k to prevent magnitudes from growing large in high dimensions, which would push softmax into saturation; (3) applying softmax to convert scores to a probability distribution; and (4) using these weights to take a weighted sum of the values V. The output is a context-dependent representation of each query position.';
    }
    if (type === 'intuition') return 'Think of it as a soft information retrieval: given a query (what you\'re looking for), you score every key (what each position contains), normalize the scores, and retrieve values (what each position carries) in proportion to how relevant each key was to your query. Unlike hard retrieval (where one entry wins), every position contributes to the output — just proportionally.';
    if (type === 'context') return 'This formula appears in the section defining the core attention primitive used in all layers of the Transformer. The authors first present this "building block" and then compose it into multi-head attention. Understanding this formula is prerequisite to understanding everything else in the paper.';
  }

  if (t.includes('multihead') || t.includes('multi-head') || t.includes('concat(head')) {
    if (type === 'explain') return 'Multi-head attention runs h parallel scaled dot-product attention functions, each operating in a lower-dimensional subspace (d_model/h per head). Each head uses separate learnable weight matrices W_i^Q, W_i^K, W_i^V to project the inputs. The h outputs are concatenated and projected back to d_model with W^O. Running attention h times in lower dimensions costs the same compute as running it once in full dimension, but allows each head to specialize to different relationship types.';
    if (type === 'intuition') return 'Imagine having h different types of "attention" simultaneously — one head tracking syntactic dependencies, another tracking coreference, another capturing semantic similarity. Each sees the same input but through a different learned "lens." The final projection reconciles all perspectives into a unified representation.';
  }

  if (t.includes('pe(pos') || t.includes('positional') || t.includes('sin(pos') || t.includes('cos(pos')) {
    if (type === 'equation' || type === 'explain') return 'The positional encoding PE(pos, 2i) = sin(pos / 10000^(2i/d_model)) injects sequence-order information. Each dimension i uses a sinusoid at a different frequency: low-i dimensions oscillate rapidly (capturing fine-grained position) while high-i dimensions oscillate slowly (capturing coarse-grained position). The 10000^(2i/d_model) base ensures frequencies span many orders of magnitude across d_model dimensions. The resulting encoding is added (not concatenated) to the token embeddings.';
    if (type === 'intuition') return 'Each position gets a unique "fingerprint" made of many sinusoids at different frequencies — like a clock with many hands moving at different speeds. Any two positions have different fingerprints, and importantly, the relationship between two positions\' fingerprints is consistent regardless of where in the sequence they appear.';
  }

  if (t.includes('masked language') || t.includes('mlm') || t.includes('[mask]')) {
    if (type === 'explain') return 'Masked Language Modeling (MLM) trains BERT by randomly replacing 15% of tokens with a [MASK] token (or a random token, or leaving unchanged) and predicting the original token from context. Crucially, this allows the model to see both left and right context for every position simultaneously — unlike autoregressive LMs that can only see past tokens. The 80/10/10 replacement strategy (mask/random/unchanged) prevents the model from learning to always ignore non-[MASK] positions during pre-training, which would cause a mismatch at fine-tuning time.';
  }

  if (t.includes('l_simple') || t.includes('ε_θ') || t.includes('denoising') || t.includes('score match')) {
    if (type === 'equation' || type === 'explain') return 'The simplified DDPM objective L_simple = E[||ε - ε_θ(√ᾱ_t x_0 + √(1-ᾱ_t)ε, t)||²] trains a neural network ε_θ to predict the noise ε that was added to clean data x_0. Given a timestep t (uniformly sampled during training), a clean image x_0, and noise ε ~ N(0,I), the noisy image x_t = √ᾱ_t·x_0 + √(1-ᾱ_t)·ε is computed in closed form. The network sees (x_t, t) and must recover ε. At inference, we start from pure noise x_T and iteratively apply the learned reverse step.';
    if (type === 'intuition') return 'Imagine teaching someone to "un-muddy" a picture by showing them the original, then a slightly muddied version, and asking them to identify what mud was added. Repeat this at every level of muddiness (timestep t). Once the network can remove any amount of mud from any starting muddy image, you can generate new images by starting with pure mud (random noise) and progressively un-muddying it.';
  }

  if (t.includes('rlhf') || t.includes('kl') || t.includes('ppo') || t.includes('reward model')) {
    if (type === 'explain') return 'RLHF (Reinforcement Learning from Human Feedback) fine-tunes a language model to align with human preferences through three steps: (1) supervised fine-tuning on human demonstrations; (2) training a reward model on human preference rankings; (3) RL optimization (PPO) to maximize the reward. The KL divergence term in the objective prevents the model from "reward hacking" — exploiting the reward model in ways that don\'t reflect true human preferences. The pretraining gradient prevents catastrophic forgetting of general language understanding.';
    if (type === 'intuition') return 'Standard training teaches a model to imitate text. RLHF teaches a model to please human raters — which is a different goal. The reward model is a "proxy critic" that predicts how much a human would like an output. PPO adjusts the language model to produce outputs the critic scores highly, while the KL term keeps the model from drifting too far from sensible language.';
  }

  if (type === 'connect') {
    return `This passage relates to prior and subsequent work: it can be connected to foundational ideas in the literature and is cited by or builds upon related papers in your library. See the References tab for specific papers cited at this point, and the Landscape view for the full citation network around this work.`;
  }

  const paper = papers.find(p => p.id === paperId);
  return `The selected passage — "${text.substring(0, 80)}${text.length > 80 ? '…' : ''}" — is from ${paper?.title ?? 'this paper'}. For a precise technical account of this component, consult the referenced section in the paper and any cited prior work. The Methods tab extracts all formal methods from this paper with their source locations.`;
}

function renderText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('**') && line.endsWith('**')) {
      return <h4 key={i} className="font-semibold mt-5 mb-1.5 text-[13px]" style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-sans)' }}>{line.slice(2, -2)}</h4>;
    }
    if (line.trim().startsWith('    ') || line.trim().startsWith('\t')) {
      return <pre key={i} className="my-2 px-3 py-2 rounded text-[12px] overflow-x-auto" style={{ fontFamily: 'var(--font-mono)', background: 'rgba(160,142,207,0.06)', border: '1px solid var(--color-edge)', color: 'var(--color-lav-light)', lineHeight: 1.7 }}>{line.trim()}</pre>;
    }
    if (line.trim() === '') return <div key={i} className="h-3" />;
    return <p key={i} className="leading-relaxed">{line}</p>;
  });
}

export default function Learning({ selectedPaperId, onSelectPaper }: Props) {
  const paper = papers.find(p => p.id === selectedPaperId) ?? papers[0];
  const [popup, setPopup] = useState<SelectionPopup | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [history, setHistory] = useState<Explanation[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setPopup(null); return; }
    const text = sel.toString().trim();
    if (text.length < 5) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return;
    setPopup({
      text,
      x: Math.min(rect.left - container.left + rect.width / 2, container.width - 160),
      y: rect.top - container.top - 8,
    });
  };

  const handleExplain = (type: string) => {
    if (!popup) return;
    const text = getExplanation(popup.text, type, paper.id);
    const expl: Explanation = { query: popup.text, type, text, paperId: paper.id };
    setExplanation(expl);
    setHistory(prev => [expl, ...prev.slice(0, 9)]);
    setPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Paper selector sidebar */}
      <div className="w-[200px] shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Focus Paper</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {papers.map(p => (
            <button key={p.id} onClick={() => { onSelectPaper(p.id); setExplanation(null); setPopup(null); }}
              className="w-full text-left px-3 py-2.5 border-b transition-colors"
              style={{ borderColor: 'var(--color-edge)', borderLeft: `2px solid ${p.id === paper.id ? 'var(--color-lavender)' : 'transparent'}`, background: p.id === paper.id ? 'rgba(160,142,207,0.07)' : 'transparent' }}>
              <div className="text-[12px] leading-snug mb-0.5 line-clamp-2" style={{ color: p.id === paper.id ? 'var(--color-ink)' : 'var(--color-sub)' }}>
                {p.title}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--color-muted)' }}>{p.authors[0]} · {p.year}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Reading area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold leading-snug" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>{paper.title}</h2>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                {paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ` +${paper.authors.length - 3}` : ''} · {paper.journal} · {paper.year}
              </div>
            </div>
            <div className="text-[11px] px-2.5 py-1 rounded shrink-0" style={{ background: 'rgba(160,142,207,0.08)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}>
              Select text to explain
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Text content */}
          <div ref={containerRef} className="flex-1 overflow-y-auto px-8 py-6 relative" onMouseUp={handleMouseUp}>
            <div className="max-w-2xl text-[14px] selectable-text" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
              {renderText(paper.fullTextSample)}
            </div>

            {/* Selection popup */}
            {popup && (
              <div
                className="absolute z-20 animate-fade-in"
                style={{ left: Math.max(8, popup.x - 130), top: popup.y - 180, width: 260 }}
              >
                <div className="rounded shadow-xl" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)' }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-edge)' }}>
                    <div className="text-[10.5px] italic line-clamp-1" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      "{popup.text.substring(0, 48)}{popup.text.length > 48 ? '…' : ''}"
                    </div>
                  </div>
                  <div className="py-1">
                    {EXPLAIN_OPTIONS.map(opt => (
                      <button key={opt.type} onClick={() => handleExplain(opt.type)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition-colors"
                        style={{ color: 'var(--color-sub)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(160,142,207,0.1)'; e.currentTarget.style.color = 'var(--color-lav-light)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-sub)'; }}>
                        <span className="text-[13px] shrink-0" style={{ width: 18, color: 'var(--color-lavender)' }}>{opt.icon}</span>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="px-3 pb-2 pt-1 border-t" style={{ borderColor: 'var(--color-edge)' }}>
                    <div className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      Explanation is based on this paper's text — no external scientific judgment.
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Explanation panel */}
          {explanation && (
            <div className="w-[300px] shrink-0 border-l flex flex-col overflow-hidden animate-slide-in" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
              <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-edge)' }}>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-lavender)' }}>Explanation</span>
                <button onClick={() => setExplanation(null)} style={{ color: 'var(--color-muted)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-[11px] px-2.5 py-2 rounded mb-4 italic" style={{ background: 'rgba(160,142,207,0.07)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)', fontFamily: 'var(--font-mono)' }}>
                  "{explanation.query.substring(0, 70)}{explanation.query.length > 70 ? '…' : ''}"
                </div>

                <div className="text-[13.5px] leading-relaxed mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                  {explanation.text}
                </div>

                <div className="border-t pt-3" style={{ borderColor: 'var(--color-edge)' }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>Continue with</div>
                  {EXPLAIN_OPTIONS.filter(o => o.type !== explanation.type).slice(0, 3).map(opt => (
                    <button key={opt.type}
                      onClick={() => handleExplain(opt.type)}
                      className="w-full text-left text-[11.5px] py-1.5 transition-colors flex items-center gap-2"
                      style={{ color: 'var(--color-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-lavender)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                      <span>{opt.icon}</span> {opt.label}
                    </button>
                  ))}
                </div>

                <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--color-edge)' }}>
                  <div className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    Source: {paper.title}, {paper.year}. Explanations parse and rephrase the source text only.
                  </div>
                </div>
              </div>

              {/* Explanation history */}
              {history.length > 1 && (
                <div className="border-t p-3 max-h-40 overflow-y-auto" style={{ borderColor: 'var(--color-edge)' }}>
                  <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>History</div>
                  {history.slice(1).map((h, i) => (
                    <button key={i} onClick={() => setExplanation(h)}
                      className="w-full text-left text-[11px] py-1 truncate transition-colors"
                      style={{ color: 'var(--color-muted)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-sub)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                      · "{h.query.substring(0, 40)}"
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
