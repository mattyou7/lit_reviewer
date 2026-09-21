import { useState } from 'react';

type SettingsSection = 'general' | 'library' | 'discovery' | 'appearance' | 'data';

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { id: 'library', label: 'Library', icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z' },
  { id: 'discovery', label: 'Discovery & APIs', icon: 'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z' },
  { id: 'appearance', label: 'Appearance', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5' },
  { id: 'data', label: 'Data & Export', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
      style={{ background: checked ? 'var(--color-lavender)' : 'var(--color-edge)' }}
      onClick={() => onChange(!checked)}>
      <div className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
        style={{ background: 'var(--color-ink)', transform: checked ? 'translateX(21px)' : 'translateX(2px)' }} />
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 border-b" style={{ borderColor: 'var(--color-edge)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px]" style={{ color: 'var(--color-ink)' }}>{label}</div>
        {description && <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [autoSave, setAutoSave] = useState(true);
  const [semanticSimilarity, setSemanticSimilarity] = useState(true);
  const [openAccessOnly, setOpenAccessOnly] = useState(false);
  const [expandDepthDefault, setExpandDepthDefault] = useState('2');
  const [apiKey, setApiKey] = useState('');
  const [zoteroSync, setZoteroSync] = useState(false);
  const [showAbstract, setShowAbstract] = useState(true);
  const [compactView, setCompactView] = useState(false);
  const [fontSize, setFontSize] = useState('13');

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sections */}
      <div className="w-[200px] shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Settings</div>
        </div>
        <div className="flex-1 py-1">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] transition-colors text-left"
              style={{
                background: activeSection === s.id ? 'rgba(160,142,207,0.1)' : 'transparent',
                color: activeSection === s.id ? 'var(--color-lav-light)' : 'var(--color-sub)',
                borderLeft: `2px solid ${activeSection === s.id ? 'var(--color-lavender)' : 'transparent'}`,
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d={s.icon} />
              </svg>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-[16px] font-semibold mb-5" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
          {SECTIONS.find(s => s.id === activeSection)?.label}
        </h2>

        {activeSection === 'general' && (
          <div>
            <SettingRow label="Auto-save notes" description="Save note changes automatically every 5 seconds">
              <Toggle checked={autoSave} onChange={setAutoSave} />
            </SettingRow>
            <SettingRow label="Show abstract preview in paper list" description="Display the first sentence of the abstract in the paper list panel">
              <Toggle checked={showAbstract} onChange={setShowAbstract} />
            </SettingRow>
            <SettingRow label="Compact paper list" description="Reduce row height in the papers panel">
              <Toggle checked={compactView} onChange={setCompactView} />
            </SettingRow>
            <SettingRow label="Default project">
              <select className="text-[12px] rounded px-2 py-1.5 outline-none" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
                <option>Foundation Models Survey</option>
                <option>Alignment Methods Comparison</option>
              </select>
            </SettingRow>
          </div>
        )}

        {activeSection === 'library' && (
          <div>
            <SettingRow label="Zotero sync" description="Sync your library with Zotero via local connector">
              <Toggle checked={zoteroSync} onChange={setZoteroSync} />
            </SettingRow>
            <SettingRow label="Default reader tab" description="Which tab opens when you select a paper">
              <select className="text-[12px] rounded px-2 py-1.5 outline-none" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
                <option>Overview</option>
                <option>Full Text</option>
                <option>Methods</option>
              </select>
            </SettingRow>
            <SettingRow label="Method extraction" description="Automatically extract methods section when importing papers">
              <Toggle checked={true} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Citation format">
              <select className="text-[12px] rounded px-2 py-1.5 outline-none" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
                <option>APA</option>
                <option>MLA</option>
                <option>BibTeX</option>
                <option>Chicago</option>
              </select>
            </SettingRow>
          </div>
        )}

        {activeSection === 'discovery' && (
          <div>
            <div className="mb-4 p-3 rounded text-[12px]" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}>
              API keys are stored locally and never transmitted. Discovery queries are sent directly to the respective services.
            </div>
            <SettingRow label="Semantic Scholar API key" description="For higher rate limits (optional — works without key at lower rate)">
              <input type="password" placeholder="sk-…" value={apiKey} onChange={e => setApiKey(e.target.value)}
                className="rounded px-2 py-1.5 text-[12px] outline-none w-48"
                style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }} />
            </SettingRow>
            <SettingRow label="PubMed API key">
              <input type="password" placeholder="(optional)" className="rounded px-2 py-1.5 text-[12px] outline-none w-48"
                style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }} />
            </SettingRow>
            <SettingRow label="Include semantic similarity in discovery">
              <Toggle checked={semanticSimilarity} onChange={setSemanticSimilarity} />
            </SettingRow>
            <SettingRow label="Open Access papers only by default">
              <Toggle checked={openAccessOnly} onChange={setOpenAccessOnly} />
            </SettingRow>
            <SettingRow label="Default expansion depth">
              <select value={expandDepthDefault} onChange={e => setExpandDepthDefault(e.target.value)}
                className="text-[12px] rounded px-2 py-1.5 outline-none" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </SettingRow>
          </div>
        )}

        {activeSection === 'appearance' && (
          <div>
            <SettingRow label="Base font size" description="Size of body text in points">
              <div className="flex items-center gap-2">
                <input type="range" min="11" max="16" value={fontSize} onChange={e => setFontSize(e.target.value)}
                  style={{ accentColor: 'var(--color-lavender)', width: 100 }} />
                <span className="text-[11px] w-6 text-center" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>{fontSize}</span>
              </div>
            </SettingRow>
            <SettingRow label="Color theme" description="Currently: Dark Academic">
              <select className="text-[12px] rounded px-2 py-1.5 outline-none" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
                <option>Dark Academic (default)</option>
                <option disabled>Light Academic (coming soon)</option>
              </select>
            </SettingRow>
            <SettingRow label="Accent color">
              <div className="flex items-center gap-2">
                {['#a08ecf', '#6b9e8c', '#c2975a', '#c26f6f', '#7a9ec2'].map(c => (
                  <div key={c} className="w-5 h-5 rounded-full cursor-pointer ring-offset-1" style={{ background: c }} />
                ))}
              </div>
            </SettingRow>
          </div>
        )}

        {activeSection === 'data' && (
          <div>
            <div className="space-y-2 mb-6">
              {[
                { label: 'Export library as BibTeX', description: 'Export all papers as a .bib file' },
                { label: 'Export notes as Markdown', description: 'Export all notes as individual .md files' },
                { label: 'Export library as JSON', description: 'Full export including metadata and discovery provenance' },
                { label: 'Import from Zotero (.rdf)', description: 'Import a Zotero library export file' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-edge)' }}>
                  <div>
                    <div className="text-[12.5px]" style={{ color: 'var(--color-ink)' }}>{item.label}</div>
                    <div className="text-[11.5px]" style={{ color: 'var(--color-muted)' }}>{item.description}</div>
                  </div>
                  <button className="text-[11.5px] px-3 py-1.5 rounded transition-colors"
                    style={{ background: 'var(--color-panel)', color: 'var(--color-sub)', border: '1px solid var(--color-edge)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-lav-light)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-sub)')}>
                    Export
                  </button>
                </div>
              ))}
            </div>

            <div className="p-3 rounded" style={{ background: 'rgba(194,111,111,0.06)', border: '1px solid rgba(194,111,111,0.2)' }}>
              <div className="text-[12.5px] font-medium mb-1" style={{ color: 'var(--color-rose)' }}>Danger zone</div>
              <div className="text-[12px] mb-3" style={{ color: 'var(--color-muted)' }}>Clear all local data. This cannot be undone.</div>
              <button className="text-[11.5px] px-3 py-1.5 rounded transition-colors"
                style={{ background: 'rgba(194,111,111,0.1)', color: 'var(--color-rose)', border: '1px solid rgba(194,111,111,0.3)' }}>
                Clear all data
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
