// VexFlow measures and draws with its music font (Bravura), so drawing waits
// for it — but never for more than 3 seconds, so a slow or failed font load
// can't leave the page blank.

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const musicFontReady: Promise<void> = Promise.race([
  document.fonts
    .load('30px Bravura')
    .then(() => document.fonts.ready)
    .then(() => undefined),
  wait(3000),
]).catch(() => undefined);
