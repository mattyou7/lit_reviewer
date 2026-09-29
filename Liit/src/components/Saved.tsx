/**Placeholder: saved items arrive in a later slice.*/
import { Empty } from '../lib/states';

interface Props {
  onSelectPaper: (id: string) => void;
}

export default function Saved(_props: Props) {
  void _props;
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <h1 className="text-[17px] font-semibold mb-4" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Saved</h1>
        <Empty title="Saved items are not built yet" hint="Saving papers for later arrives in a later slice. Nothing here is generated or inferred." />
      </div>
    </div>
  );
}
