import { useState } from 'react';
import { notes as initialNotes, papers } from '../data/mockData';
import type { Note } from '../data/mockData';

interface Props {
  selectedPaperId: string | null;
}

export default function Notes({ selectedPaperId }: Props) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id ?? null);
  const [editContent, setEditContent] = useState<Record<string, string>>(Object.fromEntries(notes.map(n => [n.id, n.content])));
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPaper, setFilterPaper] = useState<string>('all');

  const selectedNote = notes.find(n => n.id === selectedNoteId);

  const filtered = notes.filter(n => {
    if (filterPaper !== 'all' && n.paperId !== filterPaper) return false;
    if (searchQuery && !n.title.toLowerCase().includes(searchQuery.toLowerCase()) && !n.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const addNote = () => {
    const id = `n${Date.now()}`;
    const newNote: Note = {
      id,
      title: 'Untitled note',
      paperId: selectedPaperId,
      content: '',
      date: new Date().toISOString().split('T')[0],
      tags: [],
    };
    setNotes(prev => [newNote, ...prev]);
    setEditContent(prev => ({ ...prev, [id]: '' }));
    setSelectedNoteId(id);
  };

  const updateContent = (id: string, content: string) => {
    setEditContent(prev => ({ ...prev, [id]: content }));
    setNotes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
  };

  const updateTitle = (id: string, title: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  };

  const deleteNote = (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedNoteId === id) setSelectedNoteId(notes.find(n => n.id !== id)?.id ?? null);
  };

  const linkedPaper = selectedNote?.paperId ? papers.find(p => p.id === selectedNote.paperId) : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Notes list */}
      <div className="w-[240px] shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="flex-1 flex items-center gap-1.5 rounded px-2 py-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Search notes…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[11.5px] border-0 outline-none"
              style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
          </div>
          <button onClick={addNote} className="w-7 h-7 flex items-center justify-center rounded transition-colors"
            style={{ background: 'var(--color-lav-dim)', border: '1px solid var(--color-edge)', color: 'var(--color-lavender)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>

        {/* Paper filter */}
        <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <select value={filterPaper} onChange={e => setFilterPaper(e.target.value)}
            className="w-full rounded px-2 py-1 text-[11px] outline-none"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)', color: 'var(--color-sub)' }}>
            <option value="all">All papers</option>
            <option value="">No paper linked</option>
            {papers.map(p => (
              <option key={p.id} value={p.id}>{p.title.substring(0, 30)}…</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-[12px]" style={{ color: 'var(--color-muted)' }}>No notes found.</div>
          ) : filtered.map(note => (
            <button key={note.id} onClick={() => setSelectedNoteId(note.id)}
              className="w-full text-left px-3 py-3 border-b transition-colors"
              style={{
                borderColor: 'var(--color-edge)',
                borderLeft: `2px solid ${note.id === selectedNoteId ? 'var(--color-lavender)' : 'transparent'}`,
                background: note.id === selectedNoteId ? 'rgba(160,142,207,0.07)' : 'transparent',
              }}>
              <div className="text-[12.5px] font-medium mb-0.5" style={{ color: note.id === selectedNoteId ? 'var(--color-ink)' : 'var(--color-sub)' }}>
                {note.title}
              </div>
              {note.paperId && (
                <div className="text-[10.5px] mb-1 truncate" style={{ color: 'var(--color-lavender)' }}>
                  ↳ {papers.find(p => p.id === note.paperId)?.title.split(':')[0]}
                </div>
              )}
              <div className="text-[11px] line-clamp-2" style={{ color: 'var(--color-muted)' }}>
                {(editContent[note.id] ?? note.content).substring(0, 80)}
              </div>
              <div className="text-[10px] mt-1.5" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>{note.date}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedNote ? (
          <>
            <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-edge)' }}>
              <input
                type="text"
                value={selectedNote.title}
                onChange={e => updateTitle(selectedNote.id, e.target.value)}
                className="text-[15px] font-semibold bg-transparent border-0 outline-none flex-1"
                style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }}
              />
              <div className="flex items-center gap-2">
                {linkedPaper && (
                  <span className="text-[11px] px-2 py-1 rounded" style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lavender)', border: '1px solid var(--color-edge)' }}>
                    ↳ {linkedPaper.title.split(':')[0]}
                  </span>
                )}
                <button onClick={() => deleteNote(selectedNote.id)}
                  className="p-1 rounded transition-colors" style={{ color: 'var(--color-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-rose)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" /></svg>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 px-6 py-2 border-b" style={{ borderColor: 'var(--color-edge)' }}>
              <div className="flex flex-wrap gap-1">
                {selectedNote.tags.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lavender)', border: '1px solid var(--color-edge)' }}>
                    {tag}
                  </span>
                ))}
                <button className="text-[10px] px-1.5 py-0.5 rounded transition-colors" style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>+ tag</button>
              </div>
              <span className="ml-auto text-[10.5px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                {selectedNote.date}
              </span>
            </div>

            <textarea
              className="flex-1 resize-none outline-none px-8 py-5 border-0"
              value={editContent[selectedNote.id] ?? selectedNote.content}
              onChange={e => updateContent(selectedNote.id, e.target.value)}
              placeholder="Begin writing…"
              style={{
                background: 'var(--color-bg)',
                color: 'var(--color-ink)',
                fontFamily: 'var(--font-serif)',
                fontSize: '14px',
                lineHeight: '1.8',
                caretColor: 'var(--color-lavender)',
              }}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ background: 'var(--color-bg)' }}>
            <div className="text-[13px] mb-3" style={{ color: 'var(--color-muted)' }}>No note selected</div>
            <button onClick={addNote} className="text-[12px] px-4 py-2 rounded transition-colors"
              style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
              New note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
