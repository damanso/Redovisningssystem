// Story 5.9, FR-3, FR-17 och FR-31: ett möte som intaget fångat men som inte
// syns som kontakt, inte nollställer tystnadsklockan och inte nämns i ytan får
// David att ringa någon han nyss träffat. En text som påstår att löften fångas
// ur möten lovar något som inte finns: FR-3 registrerar att ett möte skett,
// inte vad som lovades. Provet täcker konstanten för fångstvägar och
// textbyggaren (rena), källradens kalenderlänk i tråden, åtagandevyn och på
// Idag, och mötet genom intaget till tråden, relationssidan, Relationer, Idag
// och kontaktförslagen, genom hela stacken (REST, executeAction, den inloggade
// vyn och Postgres). Facit är literaler ur epics.md och berättelsens Dev Notes,
// aldrig räknade ur koden som prövas.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { captureTexts } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
/** Idags avbetade mening med kalendern i drift, ordagrant (epics.md, 5.9 kriterium 3). */
const IDAG_TEXT = 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.';
/** Relationers ingress med kalendern i drift. */
const LEDE_TEXT = 'Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten, ärenden och bokförda fakturor. Ingen inmatning krävs.';
/** Relationers tomläge med kalendern i drift. */
const TOMT_TEXT = 'De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.';
/** De tre löftestexterna med konstanten i drift (5.11): kalendern är ingen löftesväg och ändrar dem inte. */
const LOFTESTEXTER = {
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
};
/**
 * Länkfragmentet för ett `eid`, som källraden skriver det (UX K5). En hjälpare
 * för att skriva facit, inte en kopia av koden som prövas: `eid` står ändå som
 * en egen literal i varje facit.
 */
const LANK = (eid: string): string => ' · <a href="https://www.google.com/calendar/event?eid=' + eid
  + '" target="_blank" rel="noopener" aria-label="Öppna mötet i Google Kalender (ny flik)">Öppna ↗</a>';

let user: TestUser;

beforeAll(async () => {
  user = await registerUser('kalender59');
});

type Yta = 'traden' | 'atagandevyn' | 'idag';
/** Källradernas innehåll på en yta, läst i ytans egen omgivning (4.2:s form). */
function kallrader(sida: string, yta: Yta): string[] {
  // Husets tabellrendering lägger till roll och etikett i cellens öppningstagg.
  const omgivning = yta === 'traden' ? /<div class="thread__src">([\s\S]*?)<\/div>/g
    : yta === 'atagandevyn' ? /<td class="muted"[^>]*>([\s\S]*?)<\/td>/g
      : / · Lovat 2026-09-02 via ([\s\S]*?)<\/span><\/p>/g;
  return [...sida.matchAll(omgivning)].map((m) => m[1]!);
}
const antal = (sida: string, yta: Yta, facit: string): number =>
  kallrader(sida, yta).filter((rad) => rad === facit).length;
/** Sant bara när listorna har samma innehåll räknat med antal; ordningen spelar ingen roll. */
function baraFacit(fangade: readonly string[], facit: readonly string[]): boolean {
  const a = [...fangade].sort();
  const b = [...facit].sort();
  return a.length === b.length && a.every((rad, i) => rad === b[i]);
}

/** Mötets tid: nu, så att relationens senaste kontakt är i dag. Läst en gång, så att K2 och K6 skickar samma händelse. */
const MOTETS_TID = new Date().toISOString();
/** Kundmötet som Hermes kalendergren skickar (3.9). Ingen person, så att trådens källrad är exakt fragmentet. */
const MOTET = {
  kind: 'interaction', organization: { name: 'Mötesrelationen AB' }, occurred_at: MOTETS_TID,
  channel: 'meeting', direction: 'outbound', summary: 'Kundmötet om fas 2.',
  source_system: 'calendar', source_ref: 'calendar:TTU5X21vdGV0',
};

/** Texten som den syns: varje tagg blir ett blanksteg, så en mening över `<div class="big">` läses hel. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}
/** Tystnaden n som ett helt tal före enheten, så att «0 dagar» inte träffas av «30 dagar». */
function harTystnad(text: string, n: number, enhet: ' d sedan' | ' dagar'): boolean {
  return new RegExp('(^|[^0-9])' + n + enhet).test(text);
}

describe('kalendern i fångstvägarna (5.9)', () => {
  it('F1 konstanten är exakt mail, kalendern och ärenden bland kontaktvägarna, AI-samtalet bland löftesvägarna (5.11), och är fryst', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual({
      contacts: ['mail', 'calendar', 'issues'],
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    });
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.contacts)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.commitments)).toBe(true);
  });

  it('F2 löftestexterna är konstantens och nämner varken möten eller kalendern', () => {
    const t = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    const loften = {
      commitmentsOpenEmpty: t.commitmentsOpenEmpty,
      promiseFormHint: t.promiseFormHint,
      customerCardEmpty: t.customerCardEmpty,
    };
    expect(loften).toEqual(LOFTESTEXTER);
    // «möte» i hintens andra mening säger var löftet sades, inte en fångstväg (UX K8).
    for (const [falt, text] of Object.entries(loften)) {
      expect(text, falt).not.toContain('möten');
      expect(text, falt).not.toContain('kalender');
    }
  });

  it('F3 negativ kontroll: kalendern bland löftesvägarna fälls av typen och ändrar ingen text', () => {
    const t = captureTexts({
      contacts: CAPTURE_PATHS_IN_OPERATION.contacts,
      // Löftesvägarnas slutna typ har ingen kalender (FR-3 registrerar att ett
      // möte skett, inte vad som lovades). Vidgas typen blir direktivet oanvänt
      // och typkontrollen röd.
      // @ts-expect-error 'calendar' är ingen CommitmentCapturePath
      commitments: ['issues_waiting_external', 'ai_conversation', 'calendar', 'promise_form'],
    });
    expect(t).toEqual(captureTexts(CAPTURE_PATHS_IN_OPERATION));
  });

  it('F4 konstanten ger Idag och Relationer meningarna med möten ordagrant', () => {
    const t = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    expect(t.todayQuiet).toBe(IDAG_TEXT);
    expect(t.relationsLede).toBe(LEDE_TEXT);
    expect(t.relationsEmpty).toBe(TOMT_TEXT);
  });
});

// Bolaget L har exakt de tolv löftena nedan och inga andra händelser, så varje
// ytas facitlista är sluten. Löften jämförs på hela nyckeln (grundnyckeln gäller
// bara kontaktpunkter), så de tolv nycklarna ger tolv löften. Provet letar inte
// efter otillåtna former: varje yta ska ha exakt facit, och en länk på någon av
// de nio planterade nycklarna fäller jämförelsen (L5).
describe('kalenderlänken i källraden (5.9)', () => {
  let bolagL: string;
  let relationL: string;
  let agentL: ReturnType<typeof supertest.agent>;
  const EID_G3 = 'k'.repeat(291);
  const KL = {
    G1: 'Kalender · <span class="thread__ref">calendar:TDU5X2dpbHRpZw</span>' + LANK('TDU5X2dpbHRpZw'),
    G2: 'Kalender · <span class="thread__ref">calendar:TDU5X3N1ZmZpeA#kunda.se</span>' + LANK('TDU5X3N1ZmZpeA'),
    G3: 'Kalender · <span class="thread__ref">calendar:' + EID_G3 + '</span>' + LANK(EID_G3),
    B1: 'Kalender · <span class="thread__ref">calendar:</span>',
    B2: 'Kalender · <span class="thread__ref">calendar:#kunda.se</span>',
    B3: 'Kalender · <span class="thread__ref">calendar:TDU5 mellanslag</span>',
    B4: 'Kalender · <span class="thread__ref">calendar:TDU5+X2Jh/c2U=</span>',
    B5: 'Kalender · <span class="thread__ref">calendar:TDU5X2ZyYWdh?eid=x</span>',
    B6: 'Kalender · <span class="thread__ref">calendar:TDU5X3RvbXQ#</span>',
    B7: 'Kalender · <span class="thread__ref">kalender:TDU5X3ByZWZpeA</span>',
    B8: 'Kalender · <span class="thread__ref">calendar:TDU5&quot;&gt;&lt;img src=x&gt;</span>',
    B9: 'Kalender · <span class="thread__ref">calendar:TDU5X3N1ZmZpeA#kund a.se</span>',
  } as const;
  const GILTIGA = [KL.G1, KL.G2, KL.G3];
  const PLANTERADE = [KL.B1, KL.B2, KL.B3, KL.B4, KL.B5, KL.B6, KL.B7, KL.B8, KL.B9];
  const FACIT = [...GILTIGA, ...PLANTERADE];

  async function sida(sokvag: string): Promise<string> {
    const r = await agentL.get(sokvag);
    expect(r.status, r.text).toBe(200);
    return r.text;
  }
  const relationssidan = () => sida(`/app/c/${bolagL}/relations/${relationL}`);
  const atagandevyn = () => sida(`/app/c/${bolagL}/commitments?status=open`);

  beforeAll(async () => {
    bolagL = await createCompany(user.token, 'Kalenderlänken AB-bolaget');
    const auth = { Authorization: `Bearer ${user.token}` };
    // Datumet räknas i UTC, som Idag själv räknar dagens datum.
    const dag = (dagar: number): string => new Date(Date.now() + dagar * 86_400_000).toISOString().slice(0, 10);
    const lofte = (sourceRef: string, body: string, dagar: number) => ({
      kind: 'commitment', organization: { name: 'Kalenderlänken AB' }, commitment_direction: 'we_owe',
      body, occurred_at: '2026-09-02T09:00:00Z', due_date: dag(dagar), source_system: 'calendar', source_ref: sourceRef,
    });
    // G1 och G2 förfaller inom Idags horisont, resten långt efter den.
    const intaget = await api.post(`/api/companies/${bolagL}/actions/ingest_crm_events`).set(auth).send({
      events: [
        lofte('calendar:TDU5X2dpbHRpZw', 'Kalenderlänk G1.', 2),
        lofte('calendar:TDU5X3N1ZmZpeA#kunda.se', 'Kalenderlänk G2.', 2),
        lofte('calendar:' + EID_G3, 'Kalenderlänk G3.', 60),
        lofte('calendar:', 'Kalenderlänk B1.', 60),
        lofte('calendar:#kunda.se', 'Kalenderlänk B2.', 60),
        lofte('calendar:TDU5 mellanslag', 'Kalenderlänk B3.', 60),
        lofte('calendar:TDU5+X2Jh/c2U=', 'Kalenderlänk B4.', 60),
        lofte('calendar:TDU5X2ZyYWdh?eid=x', 'Kalenderlänk B5.', 60),
        lofte('calendar:TDU5X3RvbXQ#', 'Kalenderlänk B6.', 60),
        lofte('kalender:TDU5X3ByZWZpeA', 'Kalenderlänk B7.', 60),
        lofte('calendar:TDU5"><img src=x>', 'Kalenderlänk B8.', 60),
        lofte('calendar:TDU5X3N1ZmZpeA#kund a.se', 'Kalenderlänk B9.', 60),
      ],
    });
    expect(intaget.status, JSON.stringify(intaget.body)).toBe(200);
    expect(intaget.body.result.skipped).toEqual([]);
    expect(intaget.body.result.commitments_created).toBe(12);
    const lista = await api.post(`/api/companies/${bolagL}/actions/list_crm_organizations`).set(auth).send({});
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    const relation = (lista.body.result as Array<{ id: string; name: string }>).find((o) => o.name === 'Kalenderlänken AB');
    expect(relation, 'relationen Kalenderlänken AB').toBeDefined();
    relationL = relation!.id;
    agentL = supertest.agent(app);
    const login = await agentL.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
  });

  it('L1 tråden: de tre giltiga nycklarna länkar till mötet med mallen exakt, med nyckeln hel och utan suffixet i adressen', async () => {
    const s = await relationssidan();
    for (const facit of GILTIGA) expect(antal(s, 'traden', facit), facit).toBe(1);
  });

  it('L2 de nio planterade nycklarna står som text utan länk i tråden, och sidan bär ingen rå tagg', async () => {
    const s = await relationssidan();
    const rader = kallrader(s, 'traden');
    for (const facit of PLANTERADE) {
      expect(antal(s, 'traden', facit), facit).toBe(1);
      // Raden som börjar med nyckeln har ingen länk efter den.
      const raden = rader.filter((rad) => rad.startsWith(facit));
      expect(raden, facit).toHaveLength(1);
      expect(raden[0], facit).not.toContain('<a ');
    }
    expect(s).not.toContain('<img src=x');
  });

  it('L3 trådens och åtagandevyns alla källrader är var för sig exakt facitlistan G1–G3 och B1–B9', async () => {
    expect(FACIT).toHaveLength(12);
    const ytor: Array<[Yta, string]> = [['traden', await relationssidan()], ['atagandevyn', await atagandevyn()]];
    for (const [yta, s] of ytor) {
      const fangade = kallrader(s, yta);
      expect(baraFacit(fangade, FACIT), `${yta}: ${JSON.stringify(fangade, null, 1)}`).toBe(true);
    }
  });

  it('L4 Idag har exakt G1 och G2, och de står exakt en gång på var och en av de tre ytorna', async () => {
    const idag = await sida(`/app/c/${bolagL}/idag`);
    const fangade = kallrader(idag, 'idag');
    expect(baraFacit(fangade, [KL.G1, KL.G2]), JSON.stringify(fangade, null, 1)).toBe(true);
    const ytor: Array<[Yta, string]> = [['traden', await relationssidan()], ['atagandevyn', await atagandevyn()], ['idag', idag]];
    for (const facit of [KL.G1, KL.G2]) {
      for (const [yta, s] of ytor) expect(antal(s, yta, facit), `${yta}: ${facit}`).toBe(1);
    }
  });

  it('L5 negativ kontroll: jämförelsen fäller en länk på en planterad nyckel, och facit fäller uppdragsytans kalendermall', () => {
    // (a) B3 med en länk ändå, planterad i åtagandevyns cell: fångas som en rad
    // men är inte B3:s facit, och listan med den är inte facitlistan (L2, L3).
    const planterad = KL.B3 + LANK('TDU5');
    const cell = `<td class="muted" role="cell" data-etikett="Källa">${planterad}</td>`;
    expect(kallrader(cell, 'atagandevyn')).toEqual([planterad]);
    expect(antal(cell, 'atagandevyn', KL.B3)).toBe(0);
    const medLank = FACIT.map((rad) => (rad === KL.B3 ? planterad : rad));
    expect(medLank).not.toEqual(FACIT);
    expect(baraFacit(medLank, FACIT)).toBe(false);
    // (b) En annan kalendermall, här uppdragsytans, är inte G1:s facit.
    const annanMall = KL.G1.replace('www.google.com/calendar/event', 'calendar.google.com/calendar/event');
    expect(annanMall).not.toBe(KL.G1);
    const annanCell = `<td class="muted" role="cell" data-etikett="Källa">${annanMall}</td>`;
    expect(kallrader(annanCell, 'atagandevyn')).toHaveLength(1);
    expect(antal(annanCell, 'atagandevyn', KL.G1)).toBe(0);
  });

  it('L6 mallen och etiketten står exakt en gång i vyns källkod', async () => {
    const kod = await readFile(new URL('../src/http/view/routes.ts', import.meta.url), 'utf8');
    expect(kod.split('https://www.google.com/calendar/event?eid=')).toHaveLength(2);
    expect(kod.split('Öppna mötet i Google Kalender (ny flik)')).toHaveLength(2);
  });

  it('L7 dokumentet säger att en kalendernyckel leder till mötet i Google Kalender', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Källan på varje rad (crm 4.2)';
    expect(doc.split(rubrik)).toHaveLength(2);
    // Dokumentet bryter raderna vid cirka 80 tecken, så blanktecknen slås ihop.
    const avsnitt = doc.split(rubrik)[1]!.split(/\n## /)[0]!.replace(/\s+/g, ' ');
    expect(avsnitt).toContain('`calendar:<eid>`');
    expect(avsnitt).toContain('Google Kalender');
    expect(avsnitt).not.toContain('Kalendern och handvägen får ingen länk');
  });
});

// Mottagaren var redo före berättelsen (arkitekturens K-3): en enda väg in
// (`ingest_crm_events` → `recordInteraction`) och senaste kontakt härledd ur
// alla relationens kontaktpunkter utan filter på kanal eller källa. Fallen
// bygger på varandra i ordning: K1 läser läget före mötet, K2 skickar mötet och
// K6 skickar det igen. Bolaget K har ett mail 45 dygn bakåt, så att relationen
// är föreslagen för tystnad före mötet och K5 visar en förändring.
describe('mötet i tråden och klockan (5.9)', () => {
  let bolagK: string;
  let relationK: string;
  let agentK: ReturnType<typeof supertest.agent>;
  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const MOTETS_RAD = 'Kalender · <span class="thread__ref">calendar:TTU5X21vdGV0</span>' + LANK('TTU5X21vdGV0');

  async function sida(sokvag: string): Promise<string> {
    const r = await agentK.get(sokvag);
    expect(r.status, r.text).toBe(200);
    return r.text;
  }
  const relationssidan = () => sida(`/app/c/${bolagK}/relations/${relationK}`);
  /** Kontaktförslagen genom åtgärden, som JSON: relationens id står där bara när den är föreslagen. */
  async function forslagen(): Promise<string> {
    const r = await api.post(`/api/companies/${bolagK}/actions/crm_contact_suggestions`).set(auth()).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return JSON.stringify(r.body.result);
  }
  async function skickaMotet(): Promise<{ interactions_created: number; interactions_unchanged: number; skipped: unknown[] }> {
    const r = await api.post(`/api/companies/${bolagK}/actions/ingest_crm_events`).set(auth()).send({ events: [MOTET] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.result;
  }

  beforeAll(async () => {
    bolagK = await createCompany(user.token, 'Kalenderklockan AB');
    const mailet = await api.post(`/api/companies/${bolagK}/actions/ingest_crm_events`).set(auth()).send({
      events: [{
        kind: 'interaction', organization: { name: 'Mötesrelationen AB' },
        occurred_at: new Date(Date.now() - 45 * 86_400_000).toISOString(),
        channel: 'email', direction: 'inbound', summary: 'Senaste mailet före mötet.',
        source_system: 'gmail', source_ref: 'gmail:e59a0b1c2d3e4f50',
      }],
    });
    expect(mailet.status, JSON.stringify(mailet.body)).toBe(200);
    expect(mailet.body.result.skipped).toEqual([]);
    const lista = await api.post(`/api/companies/${bolagK}/actions/list_crm_organizations`).set(auth()).send({});
    expect(lista.status, JSON.stringify(lista.body)).toBe(200);
    const relation = (lista.body.result as Array<{ id: string; name: string }>).find((o) => o.name === 'Mötesrelationen AB');
    expect(relation, 'relationen Mötesrelationen AB').toBeDefined();
    relationK = relation!.id;
    agentK = supertest.agent(app);
    const login = await agentK.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
  });

  it('K1 före mötet: relationen är föreslagen för tystnad på Idag och i kontaktförslagen', async () => {
    const idag = synlig(await sida(`/app/c/${bolagK}/idag`));
    expect(idag).toContain('Mötesrelationen AB');
    // 45 dygn bakåt kan bli 44–46 kalenderdagar i databasens zon; poängen är skälet.
    expect(idag).toMatch(/tyst i \d+ dagar/);
    expect(await forslagen()).toContain(relationK);
  });

  it('K2 mötet skickas genom intaget: en ny kontaktpunkt och inget överhopp', async () => {
    const r = await skickaMotet();
    expect(r.interactions_created).toBe(1);
    expect(r.interactions_unchanged).toBe(0);
    expect(r.skipped).toEqual([]);
  });

  it('K3 tråden: mötets källrad står exakt en gång, med Kalender, nyckeln och länken till mötet', async () => {
    const s = await relationssidan();
    expect(antal(s, 'traden', MOTETS_RAD), JSON.stringify(kallrader(s, 'traden'), null, 1)).toBe(1);
    expect(synlig(s)).toContain('Kundmötet om fas 2.');
  });

  it('K4 relationssidan säger 0 d sedan och relationslistan 0 dagar', async () => {
    expect(harTystnad(synlig(await relationssidan()), 0, ' d sedan'), 'relationssidan').toBe(true);
    expect(harTystnad(synlig(await sida(`/app/c/${bolagK}/relations`)), 0, ' dagar'), 'relationslistan').toBe(true);
  });

  it('K5 Idag är avbetad och nämner möten, och relationen har lämnat kontaktförslagen', async () => {
    const idag = synlig(await sida(`/app/c/${bolagK}/idag`));
    expect(idag).not.toContain('Mötesrelationen AB');
    expect(idag).not.toMatch(/tyst i/);
    expect(idag).toContain('Avbetat för i dag');
    expect(idag).toContain(IDAG_TEXT);
    expect(await forslagen()).not.toContain(relationK);
  });

  it('K6 samma möte igen ger interactions_unchanged, och tråden har fortfarande en rad för mötet', async () => {
    const r = await skickaMotet();
    expect(r.interactions_created).toBe(0);
    expect(r.interactions_unchanged).toBe(1);
    expect(r.skipped).toEqual([]);
    const s = await relationssidan();
    expect(antal(s, 'traden', MOTETS_RAD), JSON.stringify(kallrader(s, 'traden'), null, 1)).toBe(1);
  });
});
