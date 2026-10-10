// A very small XML reader, enough for MusicXML written by programs (Audiveris, MuseScore…):
// elements, attributes and text. No DTD, entities beyond the five standard ones, or namespaces.

export interface XmlEl {
  name: string;
  attrs: Record<string, string>;
  children: XmlEl[];
  text: string;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m,
  );

export function parseXml(src: string): XmlEl {
  const root: XmlEl = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += unescape(m[6]);
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3] ?? '');
      const el: XmlEl = { name: m[3], attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    }
  }
  return root;
}

export const kids = (el: XmlEl | undefined, name: string) => (el ? el.children.filter((c) => c.name === name) : []);
export const kid = (el: XmlEl | undefined, name: string) => el?.children.find((c) => c.name === name);
export const txt = (el: XmlEl | undefined, name: string) => kid(el, name)?.text.trim();
/** First descendant with this name (depth first). */
export function find(el: XmlEl | undefined, name: string): XmlEl | undefined {
  if (!el) return;
  for (const c of el.children) {
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
}
