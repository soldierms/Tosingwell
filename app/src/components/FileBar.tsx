// New / Open / Save / Download / MusicXML, plus Undo and Redo, and the
// "My scores" list saved on this device.

import { useRef, useState } from 'react';
import { deleteScore, detectFormat, listScores, saveScore, type Format, type SavedScore } from '../storage/library';

interface Props {
  title: string;
  format: Format;
  text: string;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onLoad: (format: Format, text: string, how: string) => void;
  onDownload: () => void;
  onMusicXml: () => void;
  /** A picture taken from the clipboard (goes to the photo reader). */
  onPasteImage: (file: File) => void;
}

const NEW_SCORE = `Title: New score
Key: C   Time: 4/4   Tempo: q=80
S: | d :r :m :f | s :- :- :- |]
A: | d :t, :d :r | m :- :- :- |]
T: | s :s :s :l | s :- :- :- |]
B: | d :s, :l, :f, | d :- :- :- |]
`;

export function FileBar({ title, format, text, canUndo, canRedo, onUndo, onRedo, onLoad, onDownload, onMusicXml, onPasteImage }: Props) {
  const [showList, setShowList] = useState(false);
  const [list, setList] = useState<SavedScore[]>([]);
  const [message, setMessage] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const say = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(undefined), 4000);
  };

  const save = () => {
    if (saveScore(title, format, text)) say(`Saved “${title}” in My scores on this device.`);
    else say('This browser would not save it (private browsing?). Use Download instead.');
  };

  const open = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      onPasteImage(file);
      say(`Opened the picture ${file.name} — it is ready in “Read a photo of a score”.`);
      return;
    }
    if (/\.(musicxml|mxl|xml)$/i.test(file.name)) {
      say('Opening MusicXML files is not supported yet — only exporting. Open a .solfa.txt or .staff.txt file.');
      return;
    }
    const content = await file.text();
    onLoad(detectFormat(file.name, content), content, `Opened ${file.name}`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      say('Copied the score text. Paste it into a message, a document, or back into Tosingwell.');
    } catch {
      say('The browser would not copy. Select the text in the box and use ⌘C / Ctrl+C.');
    }
  };

  /** Paste: a picture goes to the photo reader; score text replaces the score (Undo brings it back). */
  const paste = async () => {
    try {
      if (navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            onPasteImage(new File([blob], 'pasted.' + type.split('/')[1], { type }));
            say('Pasted a picture — it is ready in “Read a photo of a score”.');
            return;
          }
        }
      }
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return say('The clipboard is empty.');
      onLoad(detectFormat('', t), t, 'Pasted the score from the clipboard. ↶ Undo brings back the previous one.');
    } catch {
      say('The browser blocked reading the clipboard. Click in the page and press ⌘V / Ctrl+V instead.');
    }
  };

  const toggleList = () => {
    setList(listScores());
    setShowList((s) => !s);
  };

  return (
    <div className="filebar">
      <div className="row">
        <button onClick={() => onLoad('solfa', NEW_SCORE, 'New score')} title="Start a new score">📄 New</button>
        <button onClick={() => fileInput.current?.click()} title="Open a score file">📂 Open file</button>
        <button onClick={toggleList} aria-expanded={showList}>📚 My scores</button>
        <button onClick={save} title="Save in My scores on this device">💾 Save</button>
        <button onClick={copy} title="Copy the score text">📋 Copy</button>
        <button onClick={paste} title="Paste score text or a picture">📥 Paste</button>
        <button onClick={onDownload} title="Download the score as a text file">⬇ Download</button>
        <button onClick={onMusicXml} title="For MuseScore, Finale, Sibelius…">⬇ MusicXML</button>
        <span className="spacer" />
        <button onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">↶ Undo</button>
        <button onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷ Redo</button>
        <input ref={fileInput} type="file" accept=".txt,.musicxml,.mxl,.xml,text/plain,image/*,application/pdf,.pdf" hidden onChange={(e) => { open(e.target.files); e.target.value = ''; }} />
      </div>
      {message && <p className="ok small" role="status">{message}</p>}
      {showList && (
        <div className="library">
          {list.length === 0 && <p className="muted small">Nothing saved yet. Press 💾 Save to keep the current score here.</p>}
          <ul>
            {list.map((s) => (
              <li key={s.id}>
                <button className="link" onClick={() => { onLoad(s.format, s.text, `Opened “${s.title}”`); setShowList(false); }}>
                  {s.title}
                </button>
                <span className="muted small"> {s.format === 'solfa' ? 'sol-fa' : 'staff'} · {new Date(s.savedAt).toLocaleString()}</span>
                <button
                  className="small"
                  onClick={() => {
                    if (confirm(`Delete “${s.title}” from My scores?`)) {
                      deleteScore(s.id);
                      setList(listScores());
                    }
                  }}
                  aria-label={`Delete ${s.title}`}
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Saved in this browser only. Use ⬇ Download to keep a copy you can back up or move to another device.</p>
        </div>
      )}
    </div>
  );
}
