// A whole score packed into a link: the text is compressed and written after "#song=", so it travels
// inside the link itself (nothing is uploaded; the part after # is never sent to any server).

export type LinkFormat = 'solfa' | 'staff';

const toB64Url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** "#song=s.<data>" (s = sol-fa, t = staff text). */
export async function encodeSongHash(format: LinkFormat, text: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  return `#song=${format === 'solfa' ? 's' : 't'}.${toB64Url(packed)}`;
}

/**
 * Looks for a song link in text typed or pasted into the app (people often paste the link into the
 * score box instead of the address bar).
 * - `song`: the text holds a song link — `hash` is its "#song=…" part, ready for decodeSongHash.
 * - `address`: the text is only a web address with no song in it (for example just the website's address,
 *   or a link that lost its "#song=" part when copied).
 * - undefined: ordinary score text.
 */
export function findSongLink(text: string): { kind: 'song'; hash: string } | { kind: 'address' } | undefined {
  const song = /#song=[st]\.[A-Za-z0-9_-]*/.exec(text);
  if (song) return { kind: 'song', hash: song[0] };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => /^(https?:\/\/|www\.)\S+$/i.test(l))) return { kind: 'address' };
  return undefined;
}

/** Reads a link made by encodeSongHash; undefined if the hash is not a song (or is damaged). */
export async function decodeSongHash(hash: string): Promise<{ format: LinkFormat; text: string } | undefined> {
  const m = /^#?song=([st])\.([A-Za-z0-9_-]+)$/.exec(hash.trim());
  if (!m) return;
  try {
    const raw = await pipe(fromB64Url(m[2]), new DecompressionStream('deflate-raw'));
    return { format: m[1] === 's' ? 'solfa' : 'staff', text: new TextDecoder().decode(raw) };
  } catch {
    return;
  }
}
