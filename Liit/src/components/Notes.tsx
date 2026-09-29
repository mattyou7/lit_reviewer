/**Placeholder: source-linked notes arrive in a later slice.*/
import { Empty } from '../lib/states';

interface Props {
  selectedPaperId: string | null;
}

export default function Notes(_props: Props) {
  void _props;
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-[17px] font-semibold mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Notes</h1>
        <Empty title="Notes are not built yet" hint="Paper, project, and selected-text notes arrive in a later slice." />
      </div>
    </div>
  );
}
