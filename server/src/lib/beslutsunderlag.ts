// B-1, FR-41: underlagets summa har en plats. Mandatets hash använder
// samma sortering men bevarar lästiden; förslagets hash undantar den.
import { createHash } from 'node:crypto';

// Sortera objektnycklar på varje nivå; listornas ordning bär indatats innebörd.
export function sorteradJson(varde: unknown): string {
  if (Array.isArray(varde)) return `[${varde.map(sorteradJson).join(',')}]`;
  if (varde !== null && typeof varde === 'object') {
    const post = varde as Record<string, unknown>;
    return `{${Object.keys(post).sort().map((k) => `${JSON.stringify(k)}:${sorteradJson(post[k])}`).join(',')}}`;
  }
  return JSON.stringify(varde);
}

/** Tar bort last_nar på varje nivå, med bibehållen listordning och null. */
export function utanLastNar(varde: unknown): unknown {
  if (Array.isArray(varde)) return varde.map(utanLastNar);
  if (varde !== null && typeof varde === 'object') {
    const post = varde as Record<string, unknown>;
    return Object.fromEntries(Object.keys(post)
      .filter((k) => Object.hasOwn(post, k) && k !== 'last_nar')
      .map((k) => [k, utanLastNar(post[k])]));
  }
  return varde;
}

/** sha256 (hex) av ren JSON med sorterade nycklar och utan lästid. */
export function forslagHash(underlag: unknown): string {
  return createHash('sha256').update(sorteradJson(utanLastNar(underlag)), 'utf8').digest('hex');
}
