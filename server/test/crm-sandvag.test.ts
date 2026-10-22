// Story 8.4, FR-23: en ny väg ut till en kund får inte tillkomma osedd.
// Lagren: hela källträdets importgraf, registrets CRM-åtgärder och den
// inloggade dagsytans löfte. Planterade brott visar att vakterna kan fälla.
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import {
  CRM_ATGARDER, TILLATNA_SANDVAGAR, crmbrister, handlerbrister, handlermoduler,
  provaN1, provaN2, sandvagsbrister, sandvagsmangd,
} from './sandvagHelper.js';

/** Hela server/src, med samma modulnycklar som utskicksprovet. */
async function kodbasen(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}
const CRM_TJANSTER = [
  'services/crm.ts', 'services/crmDerivations.ts', 'services/crmIngest.ts', 'services/crmMerge.ts',
  'services/crmProvenance.ts', 'services/crmRelations.ts', 'services/crmStadning.ts', 'services/crmThread.ts',
] as const;
const crmnamn = () => ACTIONS.filter((a) => a.name.includes('crm') || a.name === 'log_contact').map((a) => a.name);

describe('CRM:s sändspärr (FR-23): ingenting går ut till en kund', () => {
  const korda = new Set<string>();
  it('N1 grafens sex planteringar fälls av exakt rätt kontroller', () => {
    provaN1();
    korda.add('N1');
  });
  it('S1 registrets sändvägsmängd är exakt dagens tillåtelselista', async () => {
    const filer = await kodbasen();
    expect(filer.size).toBeGreaterThanOrEqual(140);
    for (const fil of ['actions/registry.ts', 'services/email.ts', 'services/notifications.ts']) expect(filer.has(fil), fil).toBe(true);
    const mangd = sandvagsmangd(filer);
    expect(mangd).toContain('actions/registry.ts');
    expect(mangd).toContain('services/notifications.ts');
    const brister = sandvagsbrister(filer, TILLATNA_SANDVAGAR);
    expect(brister, brister.join('\n')).toEqual([]);
    expect(TILLATNA_SANDVAGAR).toHaveLength(36);
    expect(new Set(TILLATNA_SANDVAGAR).size).toBe(36);
    korda.add('S1');
  });
  it('S2 ingen CRM-tjänst når e-postkön, oavsett tillåtelselistan', async () => {
    const filer = await kodbasen();
    for (const fil of CRM_TJANSTER) expect(filer.has(fil), fil).toBe(true);
    expect(crmbrister(filer)).toEqual([]);
    korda.add('S2');
  });
  it('N2 handlerns planteringar fälls av exakt rätt kontroll', () => {
    provaN2();
    korda.add('N2');
  });
  it('S3 varje CRM-åtgärd i ACTIONS saknar sändande handlermodul', async () => {
    const filer = await kodbasen(); const namn = crmnamn();
    expect(CRM_ATGARDER).toHaveLength(27);
    for (const n of CRM_ATGARDER) expect(namn).toContain(n);
    expect(handlerbrister(filer, namn)).toEqual([]);
    expect(handlermoduler(filer, 'log_contact')).toEqual(['lib/validation.ts', 'services/crmRelations.ts']);
    expect(handlermoduler(filer, 'ingest_crm_events')).toEqual(['lib/validation.ts', 'services/crmIngest.ts']);
    korda.add('S3');
  });
});
