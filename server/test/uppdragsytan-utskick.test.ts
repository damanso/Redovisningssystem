// Story 1.16 (FR-42, PRD avsnitt 11): provet ”Davids utskick”. Risken: att en
// åtgärd, ett svepsteg eller en köhandler i modulen får en sändande väg (mejl,
// extern Drive-mapp eller delningslänk), eller att ett godkänt förslag eller ett
// sparat utkast skickar något. Lagren: tillåtelselistan över vilka filer som
// importerar e-postkön och notiserna, modulens importslutna mängd, köhandlerns
// importer och ett körande förlopp med fetch ersatt av en funktion som kastar.
// Negativa kontroller i minnet visar att varje kontroll fäller ett planterat brott.
// Story 12.5 lägger sitt kontrollfall i samma fil.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { withAdmin } from './helpers.js';
import { godkann, nyttBolag, rest, sida } from './undantagsvynRigg.js';
import { anteckning, forslag, svepa } from './ovrigtRigg.js';
import { beslutForKalla } from './kompletteringRigg.js';
import { kundIlt, nej, utkastblockHtml } from './utkastRigg.js';
import { beslutsradHtml } from './beslutsunderlagHelper.js';
import {
  FETCH, NATMODULER, PLANTERADE, SANDANDE, TILLATNA_IMPORTORER, importer, importorer, slutenMangd, tillatelsebrott, upplos, utskicksbrott,
} from './utskickHelper.js';

const SRC = new URL('../src/', import.meta.url);
/** En källfil i src/, med sökvägen relativt src/ (posix). */
const las = (fil: string): string => readFileSync(new URL(fil, SRC), 'utf8');
const allaFiler = (): string[] => (readdirSync(SRC, { recursive: true }) as string[])
  .map((f) => f.split('\\').join('/')).filter((f) => f.endsWith('.ts')).sort();

describe('Davids utskick (FR-42, PRD avsnitt 11): redovisningen skickar ingenting åt David', () => {
  const korda = new Set<string>();
  it('U0 negativa kontroller: varje planterat brott fälls av rätt kontroll', () => {
    for (const p of PLANTERADE) {
      const brott = p.kontroll();
      expect(brott.length, p.namn).toBeGreaterThan(0);
      expect(brott.join('\n'), p.namn).toContain(p.vantat);
      korda.add(`U0${p.namn}`);
    }
  });
  it('U1 tillåtelselistan: exakt de kända filerna importerar e-postkön och notiserna', () => {
    const faktiska = importorer(allaFiler(), las);
    expect(tillatelsebrott(faktiska)).toEqual([]);
    expect(faktiska).toEqual(TILLATNA_IMPORTORER);
    korda.add('U1');
  });
  it('U2 modulens slutna mängd når ingen sändande fil, ingen nätmodul och inget fetch', () => {
    const start = [...allaFiler().filter((f) => /^services\/uppdrag[^/]*\.ts$/.test(f)), 'lib/utkast.ts'];
    const { filer } = slutenMangd(start, las);
    for (const f of ['services/uppdragBeslut.ts', 'lib/utkast.ts', 'services/accounting/numbering.ts']) expect([...filer]).toContain(f);
    expect(utskicksbrott(start, las)).toEqual([]);
    korda.add('U2');
  });
  it('U3 köhandlern importerar ingen sändande fil och ingen nätmodul och anropar inte fetch', () => {
    const text = las('actions/execute.ts');
    const mal = importer(text).map((s) => upplos('actions/execute.ts', s));
    expect(mal.filter((m) => SANDANDE.includes(m))).toEqual([]);
    expect(mal.filter((m) => NATMODULER.includes(m))).toEqual([]);
    expect(text).not.toMatch(FETCH);
    korda.add('U3');
  });
  it('U4 förloppet: svep, nej med utkast, ja, REST-avslag, Läget och nytt svep skickar ingenting', async () => {
    const b = await nyttBolag('Utskick U4'); const { ilt } = await kundIlt(b);
    const rader = [await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId), await anteckning(b, ilt.contractId)];
    const utkorgen = async () => (await withAdmin((c) => c.query<{ n: number }>('SELECT count(*)::int AS n FROM email_outbox'))).rows[0]!.n;
    const fore = await utkorgen();
    const stub = vi.fn(() => { throw new Error('nätverksanrop i utskicksprovet'); });
    vi.stubGlobal('fetch', stub);
    try {
      const s = await svepa(b, { ovrigt_forslag: rader.map((r) => forslag(r)) });
      const koade = s.ovrigt.koade as { anteckning_id: string; approval_id: string }[];
      expect(koade, JSON.stringify(s.ovrigt)).toHaveLength(3);
      const q = rader.map((r) => koade.find((k) => k.anteckning_id === r)!.approval_id);
      const n = await nej(b, q[0]!); expect(n.status, JSON.stringify(n.body)).toBe(200);
      expect((await beslutForKalla(b.id, rader[0]!))[0]!.utkast).not.toBeNull();
      await godkann(b, q[1]!);
      const r = await rest(b, `approvals/${q[2]}/reject`, { reason: 'Inte i år' }); expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await beslutForKalla(b.id, rader[2]!))[0]!.utkast).not.toBeNull();
      const panel = (await sida(b, `/app/c/${b.id}/projects/${ilt.projektId}/laget`)).split('id="beslut"')[1]!.split('</section>')[0]!;
      for (const id of [q[0]!, q[2]!]) expect(utkastblockHtml(beslutsradHtml(panel, id))).not.toBeNull();
      await sida(b, `/app/c/${b.id}/uppdrag`);
      const l = await rest(b, 'actions/las_uppdragslage', { project_id: ilt.projektId }); expect(l.status, JSON.stringify(l.body)).toBe(200);
      await svepa(b);
      expect(stub).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
    expect(await utkorgen()).toBe(fore);
    korda.add('U4');
  }, 120_000);
  it('kontrollvakt: alla åtta negativa kontroller och U1–U4 kördes', () => expect([...korda].sort()).toEqual(
    ['U0a', 'U0b', 'U0c', 'U0d', 'U0e', 'U0f', 'U0g', 'U0h', 'U1', 'U2', 'U3', 'U4']));
});
