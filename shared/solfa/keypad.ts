// The tap keypad's music: a bar is a row of quarter-pulse slots (4 per pulse). Each slot starts a note,
// starts a rest, or holds what came before. renderBar() writes the bar in typed sol-fa using the same
// rules the parser reads: ":" between pulses, "." at the half pulse, "," at the quarter pulses,
// "-" holding into a new pulse, a space for a rest starting mid-pulse, nothing for "keep holding".

export type Slot = { kind: 'note'; syl: string } | { kind: 'rest' } | { kind: 'hold' };

/** Lengths offered on the keypad, in quarter-pulse slots. */
export const LENGTHS: { slots: number; label: string }[] = [
  { slots: 1, label: '¼' },
  { slots: 2, label: '½' },
  { slots: 3, label: '¾' },
  { slots: 4, label: '1 beat' },
  { slots: 6, label: '1½' },
  { slots: 8, label: '2 beats' },
  { slots: 12, label: '3 beats' },
  { slots: 16, label: '4 beats' },
];

/** What is sounding at each slot: a note, or a rest (holds resolved). */
function resolve(slots: Slot[], tiedIn: boolean): ('note' | 'rest')[] {
  let cur: 'note' | 'rest' = tiedIn ? 'note' : 'rest';
  return slots.map((s) => (cur = s.kind === 'hold' ? cur : s.kind));
}

/** One bar as sol-fa text, e.g. "d :r .m :f :-". Only whole pulses are written. */
export function renderBar(slots: Slot[], opts: { tiedIn?: boolean } = {}): string {
  const state = resolve(slots, !!opts.tiedIn);
  const pulses: string[] = [];
  for (let p = 0; p * 4 + 4 <= slots.length; p++) {
    const s = slots.slice(p * 4, p * 4 + 4);
    const st = state.slice(p * 4, p * 4 + 4);
    let out = s[0].kind === 'note' ? s[0].syl : s[0].kind === 'rest' ? '' : st[0] === 'note' ? '-' : '';
    let last = 0;
    for (let k = 1; k < 4; k++) {
      const starts = s[k].kind === 'note' || (s[k].kind === 'rest' && st[k - 1] === 'note');
      if (!starts) continue;
      out += (last < 2 && k >= 2 ? '.' : '') + (k % 2 === 1 ? ',' : '') + (s[k].kind === 'note' ? (s[k] as { syl: string }).syl : ' ');
      last = k;
    }
    pulses.push(out);
  }
  return pulses.map((x, i) => (i === 0 ? x : ` :${x}`)).join('');
}

/** Adds a bar after the last line of that part ("S: …"), or as a new line at the end. */
export function appendBar(text: string, voice: string, bar: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  let at = -1;
  lines.forEach((l, i) => { if (new RegExp(`^\\s*${voice}\\s*:`).test(l)) at = i; });
  const line = `${voice}: | ${bar} |`;
  if (at < 0) {
    // Put new parts before any lyric lines.
    const lyr = lines.findIndex((l) => /^\s*[SATB]-lyrics/i.test(l));
    lines.splice(lyr < 0 ? lines.length : lyr, 0, line);
  } else {
    lines[at] = lines[at].replace(/\|\]\s*$/, '|');
    lines.splice(at + 1, 0, line);
  }
  return lines.join('\n') + '\n';
}
