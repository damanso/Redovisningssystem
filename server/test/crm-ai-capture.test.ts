// Story 5.11, FR-31, FR-39, UX K8 och K9: ett tomläge som tiger om
// AI-samtalets fångst ger onödig formulärinmatning. Nämns den före drift
// lovar ytan något som inte finns. Provet täcker textbyggaren och ytorna.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { captureTexts } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
const DRIFT_LOFTEN = {
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
};
const UTAN_SAMTALET_LOFTEN = {
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern och från Lova något på relationen.',
};
const KONTAKTTEXTER = {
  todayQuiet: 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.',
  relationsLede: 'Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten, ärenden och bokförda fakturor. Ingen inmatning krävs.',
  relationsEmpty: 'De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.',
};
const FRASEN = 'när du nämner det för AI:n';
const BARA_SAMTALET_HINT = 'Löften kommer in av sig själva när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.';

describe('hintens form för AI-samtalet (5.11)', () => {
  it('S6 de tre löftestexterna följer källor och tillfällen i alla former', () => {
    const rader = [
      { namn: 'R1', commitments: ['issues_waiting_external', 'promise_form'], facit: UTAN_SAMTALET_LOFTEN },
      { namn: 'R2', commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'], facit: DRIFT_LOFTEN },
      { namn: 'R3', commitments: ['ai_conversation', 'promise_form'], facit: {
        commitmentsOpenEmpty: 'Löften kommer in av sig själva när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
        promiseFormHint: BARA_SAMTALET_HINT,
        customerCardEmpty: 'Inga öppna löften. Löften kommer när du nämner det för AI:n och från Lova något på relationen.',
      } },
      { namn: 'R4', commitments: ['ai_conversation'], facit: {
        commitmentsOpenEmpty: 'Löften kommer in av sig själva när du nämner det för AI:n.',
        promiseFormHint: BARA_SAMTALET_HINT,
        customerCardEmpty: 'Inga öppna löften. Löften kommer när du nämner det för AI:n.',
      } },
      { namn: 'R5', commitments: ['issues_waiting_external'], facit: {
        commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern.',
        promiseFormHint: UTAN_SAMTALET_LOFTEN.promiseFormHint,
        customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern.',
      } },
    ] as const;
    for (const { namn, commitments, facit } of rader) {
      const { commitmentsOpenEmpty, promiseFormHint, customerCardEmpty } = captureTexts({
        contacts: ['mail', 'calendar', 'issues'], commitments,
      });
      expect({ commitmentsOpenEmpty, promiseFormHint, customerCardEmpty }, namn).toEqual(facit);
    }
  });
});

describe('AI-samtalet i fångstvägarna (5.11)', () => {
  it('S1 konstanten är exakt vägarna i drift och är fryst', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual({
      contacts: ['mail', 'calendar', 'issues'],
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    });
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.contacts)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.commitments)).toBe(true);
  });

  it('S2 de tre löftestexterna säger AI-samtalet ordagrant', () => {
    const { commitmentsOpenEmpty, promiseFormHint, customerCardEmpty } = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    const loften = { commitmentsOpenEmpty, promiseFormHint, customerCardEmpty };
    expect(loften).toEqual(DRIFT_LOFTEN);
    for (const text of Object.values(loften)) expect(text).toContain(FRASEN);
  });

  it('S3 kontakttexterna är oförändrade och nämner inte AI:n', () => {
    const { todayQuiet, relationsLede, relationsEmpty } = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    const kontakter = { todayQuiet, relationsLede, relationsEmpty };
    expect(kontakter).toEqual(KONTAKTTEXTER);
    for (const text of Object.values(kontakter)) expect(text).not.toContain('AI:n');
  });

  it('S4 löftestexterna lovar ingen fångst ur mail eller möten', () => {
    const { commitmentsOpenEmpty, promiseFormHint, customerCardEmpty } = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    for (const text of [commitmentsOpenEmpty, promiseFormHint, customerCardEmpty]) {
      for (const ord of ['mail', 'Gmail', 'möten', 'kalender', 'avbeta']) expect(text).not.toContain(ord);
    }
  });

  it('S5 negativ kontroll: typerna och frastabellerna avvisar fel slags fångstväg', () => {
    const loften = captureTexts({
      contacts: CAPTURE_PATHS_IN_OPERATION.contacts,
      // Löftesvägarna tillåter varken mail eller kalendern; en vidgad typ fäller direktivet.
      // @ts-expect-error mail och calendar är inga löftesvägar
      commitments: ['issues_waiting_external', 'ai_conversation', 'mail', 'calendar', 'promise_form'],
    });
    expect(loften).toEqual(captureTexts(CAPTURE_PATHS_IN_OPERATION));
    const kontakter = captureTexts({
      // AI-samtalet fångar bara löften; en vidgad kontakttyp fäller direktivet.
      // @ts-expect-error ai_conversation är ingen kontaktväg
      contacts: ['mail', 'calendar', 'issues', 'ai_conversation'],
      commitments: CAPTURE_PATHS_IN_OPERATION.commitments,
    });
    expect(kontakter).toEqual(captureTexts(CAPTURE_PATHS_IN_OPERATION));
  });
});

/** Taggar blir blanksteg, så att även en mening över två element kan läsas. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

describe('löftesytorna nämner AI-samtalet (5.11)', () => {
  let user: TestUser;
  let tomt: string;
  let fullt: string;
  let relationId: string;
  let kundId: string;
  let ua: ReturnType<typeof supertest.agent>;

  async function las(sokvag: string): Promise<string> {
    const r = await ua.get(sokvag);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.text;
  }

  beforeAll(async () => {
    user = await registerUser('samtal511');
    tomt = await createCompany(user.token, 'Samtalstomt AB');
    fullt = await createCompany(user.token, 'Samtalsfullt AB');
    const auth = { Authorization: `Bearer ${user.token}` };
    const org = await api.post(`/api/companies/${fullt}/actions/upsert_crm_organization`).set(auth)
      .send({ name: 'Samtalsrelationen AB' });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    relationId = org.body.result.id as string;
    const kund = await api.post(`/api/companies/${fullt}/customers`).set(auth)
      .send({ name: 'Samtalskund Utan Löften AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    kundId = kund.body.customer.id as string;
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
  });

  it('Y1 åtagandevyns tomläge nämner AI-samtalet', async () => {
    expect(synlig(await las(`/app/c/${tomt}/commitments`)))
      .toContain('Inga öppna löften. ' + DRIFT_LOFTEN.commitmentsOpenEmpty);
  });

  it('Y2 Lova något har den exakta hinten en gång', async () => {
    const sida = await las(`/app/c/${fullt}/relations/${relationId}`);
    expect(sida.split('<p class="hint">' + DRIFT_LOFTEN.promiseFormHint + '</p>')).toHaveLength(2);
  });

  it('Y3 kundkortets tomma Åtaganden nämner AI-samtalet', async () => {
    expect(synlig(await las(`/app/c/${fullt}/customers/${kundId}`))).toContain(DRIFT_LOFTEN.customerCardEmpty);
  });

  it('Y4 kontaktytor och tomma avslutade filter nämner inte AI-samtalet', async () => {
    const ytor: Array<[string, string[]]> = [
      [`/app/c/${tomt}/idag`, ['Avbetat för i dag', KONTAKTTEXTER.todayQuiet]],
      [`/app/c/${tomt}/relations`, [KONTAKTTEXTER.relationsLede, KONTAKTTEXTER.relationsEmpty]],
      [`/app/c/${tomt}/commitments?status=done`, ['Inga klara löften.']],
      [`/app/c/${tomt}/commitments?status=dropped`, ['Inga avskrivna löften.']],
    ];
    for (const [sokvag, texter] of ytor) {
      const sida = synlig(await las(sokvag));
      for (const text of texter) expect(sida, sokvag).toContain(text);
      expect(sida, sokvag).not.toContain('för AI:n');
    }
  });
});

describe('dokumentet (5.11)', () => {
  it('Y5 dokumentet säger att AI-samtalet är en fångstväg sedan 5.11', async () => {
    const doc = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const rubrik = '## Löften som AI:n fångar i samtalet (crm 5.5)';
    expect(doc.split(rubrik)).toHaveLength(2);
    const avsnitt = doc.split(rubrik)[1]!.split(/\n## /)[0]!.replace(/\s+/g, ' ');
    expect(avsnitt).toContain('Sedan berättelse 5.11 är samtalet en fångstväg i ytans texter');
    expect(avsnitt).toContain(FRASEN);
    expect(avsnitt).not.toContain('blir en fångstväg i ytans texter i berättelse 5.11');
  });
});
