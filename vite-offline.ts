// Vite plugin: publishes the offline helper (service worker) as sw.js next to index.html, filled in with the
// list of every file of this version of the app plus the piano sounds (see app/sw-template.js).
// Only for builds (the website); `npm run dev` has no offline helper.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { SAMPLE_URLS } from './app/src/audio/samples';

/** Files in the public folder, as paths relative to it ("icons/a.png"); private scores are never listed. */
function publicFiles(dir: string, prefix = ''): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || (prefix === '' && name === '_private')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(publicFiles(full, `${prefix}${name}/`));
    else out.push(prefix + name);
  }
  return out;
}

export function offline(): Plugin {
  let root = '';
  let publicDir = '';
  return {
    name: 'tosingwell-offline',
    apply: 'build',
    configResolved(c) {
      root = c.root;
      publicDir = c.publicDir;
    },
    generateBundle(_opts, bundle) {
      const pub = publicDir ? publicFiles(publicDir) : [];
      const built = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map'));
      const files = ['./', ...built, ...pub].sort();
      // The version changes whenever any file name (hashed by Vite), public file, or this helper's code changes.
      const template = readFileSync(join(root, 'sw-template.js'), 'utf8');
      const hash = createHash('sha256').update(files.join('\n')).update(template);
      for (const f of pub) hash.update(readFileSync(join(publicDir, f)));
      const source = template
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__FILES__', JSON.stringify(files))
        .replace('__SOUNDS__', JSON.stringify(SAMPLE_URLS));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
