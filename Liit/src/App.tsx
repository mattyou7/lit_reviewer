/**LiiT shell: navigation, project context, view switching.*/
import { useCallback, useEffect, useState } from 'react';
import type { NavItem } from './data/mockData';
import { api } from './lib/api';
import type { Project } from './lib/api';
import Library from './components/Library';
import Landscape from './components/Landscape';
import Discovery from './components/Discovery';
import Methods from './components/Methods';
import Learning from './components/Learning';
import Notes from './components/Notes';
import Projects from './components/Projects';
import Settings from './components/Settings';
import Saved from './components/Saved';

const NAV_ITEMS: { id: NavItem; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1 2 2H5a2 2 0 0 1-2-2V7z' },
  { id: 'library', label: 'Library', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z' },
  { id: 'landscape', label: 'Landscape', icon: 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0zM12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42' },
  { id: 'searches', label: 'Searches', icon: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z' },
  { id: 'saved', label: 'Saved', icon: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
  { id: 'notes', label: 'Notes', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
  { id: 'methods', label: 'Methods', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' },
  { id: 'learning', label: 'Learning', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
];

export default function App() {
  const [activeView, setActiveView] = useState<NavItem>('library');
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [landscapeRefresh, setLandscapeRefresh] = useState(0);
  // Which paper-detail tab a paper opens on: the Methods index opens
  // papers directly on Methods, the Learning view opens Full Text
  // (selectable text), and every other opener starts at Overview.
  const [detailTab, setDetailTab] = useState<'overview' | 'methods' | 'fulltext'>('overview');
  // Kept in the shell so the selected landscape node survives
  // Landscape -> paper detail -> Landscape navigation.
  const [landscapeNodeId, setLandscapeNodeId] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    setProjectsError(null);
    api.listProjects()
      .then(ps => {
        setProjects(ps);
        setActiveProjectId(prev => {
          if (prev && ps.some(p => p.id === prev)) return prev;
          return ps.length > 0 ? ps[0].id : null;
        });
      })
      .catch(() => { setProjectsError('Cannot reach the LiiT backend. Start it, then retry.'); setProjects([]); });
  }, []);

  useEffect(loadProjects, [loadProjects]);

  // Selecting a paper from another project follows the paper's project.
  // null clears the selection (back to the library list placeholder).
  const selectPaper = useCallback((id: string | null) => {
    setDetailTab('overview');
    setSelectedPaperId(id);
  }, []);

  const openPaperInLibrary = useCallback((id: string) => {
    setDetailTab('overview');
    setSelectedPaperId(id);
    setActiveView('library');
  }, []);

  const activeProject = projects?.find(p => p.id === activeProjectId) ?? null;

  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      {/* Sidebar */}
      <nav
        className="flex flex-col w-[184px] shrink-0 bg-surface border-r border-edge overflow-hidden"
        style={{ borderRight: '1px solid var(--color-edge)' }}
      >
        {/* Logo / App name */}
        <div className="px-4 pt-5 pb-4 border-b border-edge" style={{ borderBottom: '1px solid var(--color-edge)' }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-6 h-6 rounded flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-lav-dim)', border: '1px solid var(--color-edge)' }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3" stroke="var(--color-lavender)" strokeWidth="1.5" />
                <circle cx="8" cy="3" r="1.2" fill="var(--color-lavender)" opacity="0.7" />
                <circle cx="13" cy="10.5" r="1.2" fill="var(--color-lavender)" opacity="0.7" />
                <circle cx="3" cy="10.5" r="1.2" fill="var(--color-lavender)" opacity="0.7" />
                <line x1="8" y1="5" x2="8" y2="4.2" stroke="var(--color-lavender)" strokeWidth="1" opacity="0.5" />
                <line x1="10.6" y1="9.5" x2="11.9" y2="9.9" stroke="var(--color-lavender)" strokeWidth="1" opacity="0.5" />
                <line x1="5.4" y1="9.5" x2="4.1" y2="9.9" stroke="var(--color-lavender)" strokeWidth="1" opacity="0.5" />
              </svg>
            </div>
            <div>
              <div className="font-serif text-sm font-semibold leading-tight" style={{ color: 'var(--color-ink)', fontFamily: 'var(--font-serif)' }}>
                LiiT
              </div>
              <div className="text-[10px] leading-tight truncate max-w-[130px]" style={{ color: 'var(--color-muted)' }} title={activeProject?.name ?? ''}>
                {activeProject ? activeProject.name : 'Research Environment'}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.slice(0, -1).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors text-left ${activeView === item.id ? 'nav-item-active' : 'nav-item-inactive'}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon shrink-0">
                <path d={item.icon} />
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Settings at bottom */}
        <div className="border-t border-edge" style={{ borderTop: '1px solid var(--color-edge)' }}>
          <button
            onClick={() => setActiveView('settings')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[12.5px] transition-colors ${activeView === 'settings' ? 'nav-item-active' : 'nav-item-inactive'}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon shrink-0">
              <path d={NAV_ITEMS[NAV_ITEMS.length - 1].icon} />
            </svg>
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {activeView === 'projects' && (
          <Projects projects={projects} activeProjectId={activeProjectId} error={projectsError}
            onRefresh={loadProjects}
            onSelect={(id) => { setActiveProjectId(id); setSelectedPaperId(null); setLandscapeNodeId(null); setActiveView('library'); }} />
        )}
        {activeView === 'library' && (
          <Library projectId={activeProjectId} selectedPaperId={selectedPaperId}
            onSelectPaper={selectPaper} onGoSearch={() => setActiveView('searches')}
            onLandscapeChanged={() => setLandscapeRefresh(t => t + 1)}
            onGoLandscape={() => setActiveView('landscape')} openDetailTab={detailTab} />
        )}
        {activeView === 'landscape' && (
          <Landscape projectId={activeProjectId} selectedNodeId={landscapeNodeId}
            onSelectNode={setLandscapeNodeId} onSelectPaper={selectPaper}
            onOpenPaper={openPaperInLibrary} onGoSearch={() => setActiveView('searches')}
            refreshToken={landscapeRefresh} />
        )}
        {activeView === 'searches' && (
          <Discovery projectId={activeProjectId}
            onPaperImported={(id) => { setDetailTab('overview'); setSelectedPaperId(id); setLandscapeRefresh(t => t + 1); }}
            onOpenPaper={openPaperInLibrary} />
        )}
        {activeView === 'saved' && (
          <Saved onSelectPaper={(id) => { setDetailTab('overview'); setSelectedPaperId(id); setActiveView('library'); }} />
        )}
        {activeView === 'notes' && <Notes selectedPaperId={selectedPaperId} />}
        {activeView === 'methods' && (
          <Methods projectId={activeProjectId} onSelectPaper={(id) => { setDetailTab('methods'); setSelectedPaperId(id); setActiveView('library'); }} />
        )}
        {activeView === 'learning' && (
          <Learning selectedPaperId={selectedPaperId} onSelectPaper={(id) => { setDetailTab('fulltext'); setSelectedPaperId(id); setActiveView('library'); }} />
        )}
        {activeView === 'settings' && <Settings />}
      </main>
    </div>
  );
}
