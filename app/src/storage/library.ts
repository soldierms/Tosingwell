// Saving scores on this device (in the browser), plus downloading and opening
// score files. Browser storage can be cleared (private browsing, "clear site
// data"), so the app also offers "Download" for a copy you keep yourself.

export type Format = 'solfa' | 'staff';

export interface SavedScore {
  id: string;
  title: string;
  format: Format;
  text: string;
  savedAt: string; // ISO date
}

const LIB_KEY = 'tosingwell.library.v1';
const DRAFT_KEY = 'tosingwell.draft.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private browsing or storage full
  }
}

export const listScores = (): SavedScore[] =>
  read<SavedScore[]>(LIB_KEY, []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));

/** Save (or update, if a score with this title and format exists). Returns false if the browser refused. */
export function saveScore(title: string, format: Format, text: string): boolean {
  const all = read<SavedScore[]>(LIB_KEY, []);
  const existing = all.find((s) => s.title === title && s.format === format);
  const entry: SavedScore = { id: existing?.id ?? crypto.randomUUID(), title, format, text, savedAt: new Date().toISOString() };
  return write(LIB_KEY, [entry, ...all.filter((s) => s.id !== entry.id)]);
}

export function deleteScore(id: string): void {
  write(LIB_KEY, read<SavedScore[]>(LIB_KEY, []).filter((s) => s.id !== id));
}

/** The work in progress, saved automatically. */
export const loadDraft = () => read<{ format: Format; text: string } | null>(DRAFT_KEY, null);
export const saveDraft = (format: Format, text: string) => write(DRAFT_KEY, { format, text });

// ---------- Files ----------

const safeName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'score';

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const scoreFileName = (title: string, format: Format) => `${safeName(title)}.${format === 'solfa' ? 'solfa' : 'staff'}.txt`;
export const musicXmlFileName = (title: string) => `${safeName(title)}.musicxml`;

/** True if the part lines clearly look like this format (used to catch a wrong "Type in" choice). */
export function looksLike(text: string): Format | undefined {
  const parts = text.split('\n').filter((l) => /^\s*[SATB]\s*:/.test(l)).join(' ');
  if (!parts.trim()) return undefined;
  const staffNotes = (parts.match(/\b[A-G](#|##|b|bb|n)?\d[whqest]/g) ?? []).length;
  const solfaNotes = (parts.match(/(^|[\s:!.|])(d|r|m|f|s|l|t|de|ra|me|fe|se|le|ta)['’,₁₂]*(?=[\s:!.|,]|$)/g) ?? []).length;
  if (staffNotes > 3 && staffNotes > solfaNotes) return 'staff';
  if (solfaNotes > 3 && solfaNotes > staffNotes * 2) return 'solfa';
  return undefined;
}

/** Work out whether a score file is sol-fa or staff text. */
export function detectFormat(filename: string, text: string): Format {
  if (/\.solfa\.txt$/i.test(filename)) return 'solfa';
  if (/\.staff\.txt$/i.test(filename)) return 'staff';
  const partLines = text.split('\n').filter((l) => /^\s*[SATB]\s*:/.test(l)).join(' ');
  return /\b[A-G](#|##|b|bb|n)?\d[whqest]/.test(partLines) ? 'staff' : 'solfa';
}
