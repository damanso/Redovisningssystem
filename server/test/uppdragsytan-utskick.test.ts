// Provet ”Davids utskick” (FR-42, PRD avsnitt 11; Story 1.16, kriterium 8): ingen
// åtgärd, inget svepsteg och ingen köhandler i redovisningen har en sändande väg, och
// ett godkänt förslag eller ett sparat utkast skickar ingenting. Riskerna: en ny väg ut
// ur processen (en nätmodul i Node, ett paket som öppnar en anslutning eller de globala
// nätgränssnitten) och modulens kod i e-postkön. Lagren: tre tillåtelselistor över hela
// server/src som rena kontroller (utskickHelper.ts, med planterade brott först) och ett
// körande förlopp genom hela stacken med nätanropet utbytt mot en funktion som kastar.
// Story 12.5 lägger sitt kontrollfall i samma fil.
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { withAdmin } from './helpers.js';
import { godkann, nyttBolag, rest, sida } from './undantagsvynRigg.js';
import { anteckning, forslag, svepa } from './ovrigtRigg.js';
import { beslutForKalla } from './kompletteringRigg.js';
import { kundIlt, nej } from './utkastRigg.js';
import {
  NATMODULER, NATNAMN, PAKET, TILLATNA_IMPORTORER, importorbrister, importorer, paketbrister, provaU0, utgangsbrister,
} from './utskickHelper.js';

/** Hela server/src: sökvägen i src (posix) till filens text. */
async function kodbasen(): Promise<Map<string, string>> {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const filer = new Map<string, string>();
  for (const fil of readdirSync(dir, { recursive: true })) {
    if (typeof fil === 'string' && fil.endsWith('.ts')) filer.set(fil.split('\\').join('/'), await readFile(`${dir}/${fil}`, 'utf8'));
  }
  return filer;
}
async function beroenden(): Promise<string[]> {
  const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
  return Object.keys(p.dependencies ?? {});
}
const nyckel = (p: { fil: string; mal: string; namn: string }) => `${p.fil} → ${p.mal}: ${p.namn}`;

describe('Davids utskick (FR-42, PRD avsnitt 11): redovisningen har ingen sändande väg, och ett beslut eller ett utkast skickar ingenting', () => {
  const korda = new Set<string>();
  it('U0 de negativa kontrollerna: varje planterat brott fälls av rätt kontroll och bara av den', () => {
    provaU0(); korda.add('U0');
  });
  it('U1 e-postköns importörer är exakt tillåtelselistan', async () => {
    const filer = await kodbasen();
    expect(importorbrister(filer)).toEqual([]);
    expect(importorer(filer).map(nyckel).sort()).toEqual(TILLATNA_IMPORTORER.map(nyckel).sort());
    korda.add('U1');
  });
  it('U2 nätets utgångar: inga nätmoduler och nätnamnen bara där listan säger', async () => {
    const filer = await kodbasen();
    expect(filer.size).toBeGreaterThanOrEqual(140);
    for (const fil of ['services/uppdragBeslut.ts', 'lib/utkast.ts', 'actions/registry.ts', 'actions/execute.ts', 'services/uppdragSvep.ts', 'http/view/routes.ts', 'mcp/server.ts']) {
      expect(filer.has(fil), fil).toBe(true);
    }
    expect(NATMODULER).toHaveLength(7); expect(NATNAMN).toHaveLength(3);
    expect(utgangsbrister(filer)).toEqual([]);
    korda.add('U2');
  });
  it('U3 paketlistan: varje beroende är klassat, och nätets paket importeras bara i sin fil', async () => {
    const filer = await kodbasen(); const deps = await beroenden();
    expect(deps.length).toBeGreaterThan(0);
    expect(Object.keys(PAKET).sort()).toEqual([...deps].sort());
    expect(paketbrister(filer, deps)).toEqual([]);
    korda.add('U3');
  });
  it('U4 förloppet: svep, nej med utkast, ja, avslag, Läget och undantagsvyn skickar ingenting', async () => {
    const b = await nyttBolag('Davids utskick U4'); const { ilt } = await kundIlt(b);
    const utkorg = async () => (await withAdmin((c) => c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_outbox'))).rows[0]!.n;
    const fore = await utkorg();
    const stub = vi.fn(() => { throw new Error('nätverksanrop i utskicksprovet'); });
    vi.stubGlobal('fetch', stub);
    try {
      const rader = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
      const s = await svepa(b, { ovrigt_forslag: rader.map((r) => forslag(r)) });
      const koade = (s.ovrigt.koade as { approval_id: string; anteckning_id: string }[]);
      expect(koade, JSON.stringify(s.ovrigt)).toHaveLength(3);
      const fraga = (rad: string) => {
        const k = koade.find((x) => x.anteckning_id === rad);
        expect(k, rad).toBeDefined(); return k!.approval_id;
      };
      expect((await nej(b, fraga(rader[0]!))).status).toBe(200);
      expect((await beslutForKalla(b.id, rader[0]!))[0]!.utkast).not.toBeNull();
      await godkann(b, fraga(rader[1]!));
      const avslag = await rest(b, `approvals/${fraga(rader[2]!)}/reject`, { reason: 'Inte i år' }); expect(avslag.status, JSON.stringify(avslag.body)).toBe(200);
      expect((await beslutForKalla(b.id, rader[2]!))[0]!.utkast).not.toBeNull();
      const laget = await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`);
      expect(laget.match(/<div\b[^>]*\bdata-utkast\b/g) ?? []).toHaveLength(2);
      await sida(b, `/app/c/${b.id}/uppdrag`);
      expect((await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId })).status).toBe(200);
      await svepa(b);
      expect(stub).not.toHaveBeenCalled();
      expect(await utkorg()).toBe(fore);
    } finally { vi.unstubAllGlobals(); }
    korda.add('U4');
  }, 120_000);
  it('kontrollvakt: alla fem fall kördes', () => expect([...korda].sort()).toEqual(['U0', 'U1', 'U2', 'U3', 'U4']));
});
