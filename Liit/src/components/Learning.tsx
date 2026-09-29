/**Learning (sidebar view): honest guide to the contextual tutor (beta).
 * The tutor itself runs only as a layer inside the paper — select text in
 * Full Text → Explain, or Learn on a Methods item. Nothing is generated,
 * ranked, or stored on this page.*/
import { Empty } from '../lib/states';

interface Props {
  selectedPaperId: string | null;
  onSelectPaper: (id: string) => void;
}

export default function Learning({ selectedPaperId, onSelectPaper }: Props) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-[17px] font-semibold mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Learning</h1>
        <div className="max-w-xl">
          <p className="text-[13px] leading-relaxed mb-3" style={{ color: 'var(--color-sub)' }}>
            Learning is contextual: open a paper, select a passage in Full Text, and ask for an
            explanation. The answer is generated from that selection, the surrounding paragraph,
            and the paper you are reading — nothing else.
          </p>
          <div
            className="text-[12px] leading-relaxed rounded p-3 mb-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}>
            1. Open a paper → <span style={{ color: 'var(--color-lav-light)' }}>Full Text</span> →
            select a passage → <span style={{ color: 'var(--color-lav-light)' }}>Explain</span>.<br />
            2. In <span style={{ color: 'var(--color-lav-light)' }}>Methods</span>, press{' '}
            <span style={{ color: 'var(--color-lav-light)' }}>Learn</span> on any item to explain it
            beside its source text.<br />
            3. The panel stays over the paper; close it any time. Nothing runs in the background,
            no explanation is stored, and nothing here is generated until you ask.
          </div>
          <Empty
            title="Nothing is generated on this page"
            hint="The tutor only answers when you ask, on the paper you are reading."
            action={selectedPaperId ? (
              <button
                onClick={() => onSelectPaper(selectedPaperId)}
                className="text-[11.5px] px-3 py-1.5 rounded"
                style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                Open the selected paper → Full Text
              </button>
            ) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
