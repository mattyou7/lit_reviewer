import { useState } from 'react';
import { projects } from '../data/mockData';
import type { Project } from '../data/mockData';

const STATUS_LABELS: Record<Project['status'], { label: string; color: string }> = {
  active: { label: 'Active', color: 'var(--color-teal)' },
  draft: { label: 'Draft', color: 'var(--color-amber)' },
  archived: { label: 'Archived', color: 'var(--color-muted)' },
};

export default function Projects() {
  const [activeProject, setActiveProject] = useState<string | null>(null);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[18px] font-semibold" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>Projects</h1>
            <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-muted)' }}>Organize your research into focused workspaces</p>
          </div>
          <button className="text-[12px] px-3.5 py-2 rounded flex items-center gap-2 transition-colors"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            New project
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          {projects.map(project => {
            const status = STATUS_LABELS[project.status];
            return (
              <div key={project.id}
                className="p-4 rounded-lg cursor-pointer transition-all group"
                style={{
                  background: 'var(--color-surface)',
                  border: `1px solid ${activeProject === project.id ? project.color : 'var(--color-edge)'}`,
                  boxShadow: activeProject === project.id ? `0 0 0 1px ${project.color}22` : 'none',
                }}
                onClick={() => setActiveProject(project.id === activeProject ? null : project.id)}
                onMouseEnter={e => { e.currentTarget.style.borderColor = project.color; }}
                onMouseLeave={e => { if (activeProject !== project.id) e.currentTarget.style.borderColor = 'var(--color-edge)'; }}>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: `${project.color}22` }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={project.color} strokeWidth="1.5">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                    </svg>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${status.color}18`, color: status.color, border: `1px solid ${status.color}30` }}>
                    {status.label}
                  </span>
                </div>

                <h3 className="text-[13.5px] font-semibold mb-1.5" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                  {project.name}
                </h3>
                <p className="text-[12px] leading-relaxed mb-3 line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                  {project.description}
                </p>

                <div className="flex items-center gap-4 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                  <div className="flex items-center gap-1.5">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" /></svg>
                    <span>{project.paperCount}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></svg>
                    <span>{project.noteCount}</span>
                  </div>
                  <span className="ml-auto" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{project.lastModified}</span>
                </div>
              </div>
            );
          })}

          {/* Add project card */}
          <div className="p-4 rounded-lg cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 border-dashed"
            style={{ border: '1.5px dashed var(--color-edge)', minHeight: 160 }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: 'var(--color-panel)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            </div>
            <span className="text-[12px]" style={{ color: 'var(--color-muted)' }}>New project</span>
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>Recent activity</h2>
          <div className="space-y-2">
            {[
              { action: 'Added paper', detail: 'Chain-of-Thought Prompting Elicits Reasoning…', project: 'Foundation Models Survey', time: '2h ago', icon: 'M12 5v14M5 12h14' },
              { action: 'Note edited', detail: 'Notes on Scaled Dot-Product Attention', project: 'Foundation Models Survey', time: '1d ago', icon: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z' },
              { action: 'Search saved', detail: 'Emergent abilities large language models', project: 'Alignment Methods Comparison', time: '2d ago', icon: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z' },
              { action: 'Method extracted', detail: 'RLHF from InstructGPT (Ouyang et al. 2022)', project: 'Alignment Methods Comparison', time: '3d ago', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded transition-colors"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)' }}>
                <div className="w-7 h-7 rounded flex items-center justify-center shrink-0" style={{ background: 'var(--color-panel)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-lavender)" strokeWidth="1.5">
                    <path d={item.icon} />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span style={{ color: 'var(--color-muted)' }}>{item.action}:</span>
                    <span className="truncate" style={{ color: 'var(--color-sub)' }}>{item.detail}</span>
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                    {item.project}
                  </div>
                </div>
                <span className="text-[10.5px] shrink-0" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
