/**Projects: real project list, creation, and selection.*/
import { useState } from 'react';
import { api } from '../lib/api';
import type { Project } from '../lib/api';
import { Empty, Err, Loading, friendlyError } from '../lib/states';

interface Props {
  projects: Project[] | null;
  activeProjectId: string | null;
  error: string | null;
  onRefresh: () => void;
  onSelect: (id: string) => void;
}

export default function Projects({ projects, activeProjectId, error, onRefresh, onSelect }: Props) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const p = await api.createProject(trimmed);
      setName('');
      onRefresh();
      onSelect(p.id);
    } catch (e) {
      setCreateError(friendlyError(e, 'Project creation'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Projects</h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Each project holds its own papers, searches, and landscape</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="text" placeholder="New project name…" value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              className="rounded px-2.5 py-2 text-[12px] outline-none w-52"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)', color: 'var(--color-ink)' }} />
            <button onClick={create} disabled={creating || !name.trim()}
              className="text-[12px] px-3.5 py-2 rounded transition-colors"
              style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)', opacity: creating || !name.trim() ? 0.6 : 1 }}>
              {creating ? 'Creating…' : 'New project'}
            </button>
          </div>
        </div>
        {createError && <div className="text-[12px] mb-3" style={{ color: 'var(--color-rose)' }}>{createError}</div>}

        {projects === null ? <Loading text="Loading projects…" /> : error ? (
          <Err message={error} onRetry={onRefresh} />
        ) : projects.length === 0 ? (
          <Empty title="Create a project to begin." hint="Each project collects its own papers, searches, and landscape." />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {projects.map(project => (
              <button key={project.id} onClick={() => onSelect(project.id)}
                className="p-4 rounded-lg text-left transition-colors"
                style={{
                  background: 'var(--color-surface)',
                  border: `1px solid ${activeProjectId === project.id ? 'var(--color-lavender)' : 'var(--color-edge)'}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
                onMouseLeave={e => { e.currentTarget.style.borderColor = activeProjectId === project.id ? 'var(--color-lavender)' : 'var(--color-edge)'; }}>
                <h3 className="text-[13.5px] font-semibold mb-1" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                  {project.name}
                </h3>
                <p className="text-[12px] leading-relaxed mb-2 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                  {project.description || 'No description'}
                </p>
                <div className="text-[11px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                  {activeProjectId === project.id ? '● active project' : '○ click to open'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
