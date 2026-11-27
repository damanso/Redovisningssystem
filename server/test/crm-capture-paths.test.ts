// Story 5.1, FR-31 (PRD lucka 21): ett tomläge eller en hint som lovar en
// fångstväg som inte finns får David att tro att något fångas som inte fångas —
// en tom lista läses då som avbetad fast den bara är oläst. Provet täcker den
// rena textbyggaren (`captureTexts` ur konstanten `CAPTURE_PATHS_IN_OPERATION`)
// och de fem ytorna i webbvyn genom hela stacken. Facit är literaler ur
// epics.md och berättelsens Dev Notes, aldrig räknade ur koden som prövas.
// Story 5.9 lade kalendern bland kontaktvägarna, så facit beskriver konstanten
// i drift efter den. Story 5.11 lade AI-samtalet bland löftesvägarna, så
// facit beskriver konstanten i drift efter den.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { captureTexts, type CapturePaths } from '../src/lib/crmRules.js';
import { CAPTURE_PATHS_IN_OPERATION } from '../src/services/crmDerivations.js';
import { api, app, createCompany, registerUser, type TestUser } from './helpers.js';

/** De sex texterna för konstanten i drift (5.9 och 5.11), ordagrant (kriterium 2 och 3). */
const I_DRIFT = {
  todayQuiet: 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.',
  relationsLede: 'Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten, ärenden och bokförda fakturor. Ingen inmatning krävs.',
  relationsEmpty: 'De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.',
  commitmentsOpenEmpty: 'Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.',
  promiseFormHint: 'Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.',
  customerCardEmpty: 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.',
};
const P4_TODAY = 'Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.';
const P5_CUSTOMER = 'Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.';
const BARA_SAMTALET = 'Det här är för det som sades i ett samtal eller möte.';

describe('fångsttexterna, rena', () => {
  it('P1 konstanten är exakt vägarna i drift — kalendern sedan 5.9, AI-samtalet sedan 5.11 — och är fryst', () => {
    expect(CAPTURE_PATHS_IN_OPERATION).toEqual({
      contacts: ['mail', 'calendar', 'issues'],
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    });
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.contacts)).toBe(true);
    expect(Object.isFrozen(CAPTURE_PATHS_IN_OPERATION.commitments)).toBe(true);
  });

  it('P2 konstanten ger de sex texterna ordagrant', () => {
    expect(captureTexts(CAPTURE_PATHS_IN_OPERATION)).toEqual(I_DRIFT);
  });

  it('P3 ingen text nämner kalendern, och löftestexterna varken möten, mail eller avbetat', () => {
    const t = captureTexts(CAPTURE_PATHS_IN_OPERATION);
    for (const [falt, text] of Object.entries(t)) {
      expect(text, falt).not.toContain('kalender');
    }
    // Kontakttexterna säger «möten» sedan 5.9, som är sant; löftestexterna aldrig.
    expect(t.commitmentsOpenEmpty).not.toContain('möten');
    expect(t.promiseFormHint).not.toContain('möten');
    expect(t.customerCardEmpty).not.toContain('möten');
    expect(t.commitmentsOpenEmpty).not.toContain('mail');
    expect(t.promiseFormHint).not.toContain('mail');
    expect(t.customerCardEmpty).not.toContain('mail');
    expect(t.commitmentsOpenEmpty).not.toContain('avbeta');
  });

  it('P4 negativ kontroll: kalendern i drift ger möten i kontakttexterna och rör inte löftestexterna', () => {
    const t = captureTexts({ contacts: ['mail', 'calendar', 'issues'], commitments: CAPTURE_PATHS_IN_OPERATION.commitments });
    expect(t.todayQuiet).toBe(P4_TODAY);
    expect(t.relationsLede).toContain('härlett ur mail, möten, ärenden och bokförda fakturor');
    expect(t.relationsEmpty).toBe('De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.');
    expect(t.commitmentsOpenEmpty).toBe(I_DRIFT.commitmentsOpenEmpty);
    expect(t.promiseFormHint).toBe(I_DRIFT.promiseFormHint);
    expect(t.customerCardEmpty).toBe(I_DRIFT.customerCardEmpty);
  });

  it('P5 AI-samtalet i drift (5.11) ger de tre löftestexterna och ändrar inga andra', () => {
    const t = captureTexts({
      contacts: CAPTURE_PATHS_IN_OPERATION.contacts,
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    });
    expect(t.commitmentsOpenEmpty).toBe('Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.');
    expect(t.promiseFormHint).toBe('Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.');
    expect(t.customerCardEmpty).toBe(P5_CUSTOMER);
    expect(t.todayQuiet).toBe(I_DRIFT.todayQuiet);
    expect(t.relationsLede).toBe(I_DRIFT.relationsLede);
    expect(t.relationsEmpty).toBe(I_DRIFT.relationsEmpty);
  });

  it('P6 ordningen i konstanten och dubbletter spelar ingen roll', () => {
    const blandad: CapturePaths = {
      contacts: ['issues', 'calendar', 'mail', 'mail'],
      commitments: ['promise_form', 'ai_conversation', 'issues_waiting_external'],
    };
    const kanonisk: CapturePaths = {
      contacts: ['mail', 'calendar', 'issues'],
      commitments: ['issues_waiting_external', 'ai_conversation', 'promise_form'],
    };
    const t = captureTexts(blandad);
    expect(t).toEqual(captureTexts(kanonisk));
    expect(t.todayQuiet).toBe(P4_TODAY);
    expect(t.customerCardEmpty).toBe(P5_CUSTOMER);
  });

  it('P7 färre vägar ger färre ord — bara mail och handvägen', () => {
    const t = captureTexts({ contacts: ['mail'], commitments: ['promise_form'] });
    expect(t.todayQuiet).toBe('Kommer något in via mail dyker det upp av sig självt.');
    expect(t.relationsLede).toContain('härlett ur mail och bokförda fakturor');
    expect(t.relationsEmpty).toBe('De flesta dyker upp av sig själva när mail kommer in.');
    expect(t.commitmentsOpenEmpty).toBe('Du kan lägga till ett under Lova något på en relation.');
    expect(t.promiseFormHint).toBe(BARA_SAMTALET);
    expect(t.customerCardEmpty).toBe('Inga öppna löften. Löften kommer från Lova något på relationen.');
    for (const [falt, text] of Object.entries(t)) {
      expect(text, falt).not.toContain('ärenden');
      expect(text, falt).not.toContain('Väntar-extern');
    }
  });

  it('P8 inga vägar alls lovar ingenting', () => {
    const t = captureTexts({ contacts: [], commitments: [] });
    expect(t.todayQuiet).toBe('');
    expect(t.relationsEmpty).toBe('');
    expect(t.relationsLede).toContain('härlett ur bokförda fakturor');
    expect(t.commitmentsOpenEmpty).toBe('');
    expect(t.promiseFormHint).toBe(BARA_SAMTALET);
    expect(t.customerCardEmpty).toBe('Inga öppna löften.');
  });
});

/** Texten som den syns: varje tagg blir ett blanksteg, så en mening över `<div class="big">` läses hel. */
function synlig(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Tomlägets block: från första `<div class="empty">` till och med det andra
 * `</div>` efter det (det första stänger rubriken). Länkarna prövas här,
 * eftersom sidhuvudets filterknappar och menyn bär samma adresser.
 */
function tomlaget(html: string): string {
  const start = html.indexOf('<div class="empty">');
  if (start < 0) return '';
  const rubrikensSlut = html.indexOf('</div>', start);
  if (rubrikensSlut < 0) return '';
  const slut = html.indexOf('</div>', rubrikensSlut + '</div>'.length);
  return slut < 0 ? '' : html.slice(start, slut + '</div>'.length);
}

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
/** Bolaget T får aldrig en relation: Idag är tom och Relationer visar sitt tomläge bara då. */
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

describe('fångsttexterna i ytorna', () => {
  beforeAll(async () => {
    user = await registerUser('fangst');
    tomt = await createCompany(user.token, 'Fångsttomt AB');
    fullt = await createCompany(user.token, 'Fångstfullt AB');
    const auth = { Authorization: `Bearer ${user.token}` };
    const org = await api.post(`/api/companies/${fullt}/actions/upsert_crm_organization`).set(auth)
      .send({ name: 'Fångstrelationen AB' });
    expect(org.status, JSON.stringify(org.body)).toBe(200);
    relationId = org.body.result.id as string;
    const kund = await api.post(`/api/companies/${fullt}/customers`).set(auth).send({ name: 'Kundkortet Utan Löften AB' });
    expect(kund.status, JSON.stringify(kund.body)).toBe(201);
    kundId = kund.body.customer.id as string;
    ua = supertest.agent(app);
    const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(302);
  });

  it('A1 Öppna utan löften: hela meningen med AI-samtalet, länken till Klara och länken till Idag', async () => {
    const sida = await las(`/app/c/${tomt}/commitments`);
    expect(synlig(sida)).toContain('Inga öppna löften. Löften kommer in av sig själva från ärenden märkta Väntar-extern och när du nämner det för AI:n, och du kan lägga till ett under Lova något på en relation.');
    const block = tomlaget(sida);
    expect(block).toContain(`href="/app/c/${tomt}/commitments?status=done"`);
    expect(block).toContain(`href="/app/c/${tomt}/idag"`);
  });

  it('A2 Klara och Avskrivna: egen rubrik, länk till de öppna och ingen fångstmening', async () => {
    const klara = await las(`/app/c/${tomt}/commitments?status=done`);
    expect(synlig(klara)).toContain('Inga klara löften.');
    expect(tomlaget(klara)).toContain(`href="/app/c/${tomt}/commitments?status=open"`);
    const avskrivna = await las(`/app/c/${tomt}/commitments?status=dropped`);
    expect(synlig(avskrivna)).toContain('Inga avskrivna löften.');
    expect(tomlaget(avskrivna)).toContain(`href="/app/c/${tomt}/commitments?status=open"`);
    expect(klara).not.toContain('Löften kommer in av sig själva');
    expect(avskrivna).not.toContain('Löften kommer in av sig själva');
  });

  it('A3 inget filter säger avbetad eller de gamla meningarna', async () => {
    for (const status of ['open', 'done', 'dropped']) {
      const sida = await las(`/app/c/${tomt}/commitments?status=${status}`);
      expect(sida, status).not.toMatch(/avbeta/i);
      expect(sida, status).not.toContain('Inga åtaganden här');
      expect(sida, status).not.toContain('Löften fångas');
      expect(sida, status).not.toContain('Är listan tom');
    }
  });

  it('A4 sfärfiltret följer med i tomlägets länkar', async () => {
    const oppna = await las(`/app/c/${tomt}/commitments?status=open&sfar=privat`);
    expect(tomlaget(oppna)).toContain(`href="/app/c/${tomt}/commitments?status=done&amp;sfar=privat"`);
    const klara = await las(`/app/c/${tomt}/commitments?status=done&sfar=privat`);
    expect(tomlaget(klara)).toContain(`href="/app/c/${tomt}/commitments?status=open&amp;sfar=privat"`);
  });

  it('H1 hinten i Lova något nämner ärendevägen och AI-samtalet och inte mail och möten', async () => {
    const sida = synlig(await las(`/app/c/${fullt}/relations/${relationId}`));
    expect(sida).toContain('Löften ur ärenden märkta Väntar-extern kommer in av sig själva, eller när du nämner det för AI:n. Det här är för det som sades i ett samtal eller möte.');
    expect(sida).not.toContain('Löften fångas normalt');
  });

  it('C1 kundkortets tomma Åtaganden säger ärendevägen, AI-samtalet och Lova något', async () => {
    const sida = synlig(await las(`/app/c/${fullt}/customers/${kundId}`));
    expect(sida).toContain('Inga öppna löften. Löften kommer från ärenden märkta Väntar-extern, när du nämner det för AI:n och från Lova något på relationen.');
    expect(sida).not.toContain('Löften fångas ur mail');
  });

  it('D1 Idag avbetad nämner mail, möten och ärenden, och Avbetat för i dag står kvar', async () => {
    const sida = synlig(await las(`/app/c/${tomt}/idag`));
    expect(sida).toContain('Avbetat för i dag');
    expect(sida).toContain('Loggade kontakter och stängda löften försvinner härifrån. Kommer något in via mail, möten eller ärenden dyker det upp av sig självt.');
    expect(sida).not.toContain('via mail eller kalender');
    expect(sida).not.toContain('dyker det upp automatiskt');
    expect(sida).not.toContain('via mail eller ärenden dyker');
  });

  it('R1 Relationer utan relationer: ingressen och tomläget nämner bara vägar i drift', async () => {
    const sida = synlig(await las(`/app/c/${tomt}/relations`));
    expect(sida).toContain('Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten, ärenden och bokförda fakturor. Ingen inmatning krävs.');
    expect(sida).toContain('Inga relationer ännu');
    expect(sida).toContain('De flesta dyker upp av sig själva när mail, möten och ärenden kommer in.');
    expect(sida).not.toContain('härlett ur mail, ärenden och');
    expect(sida).not.toContain('när mail och ärenden kommer in');
  });

  it('R2 Relationer med en relation: ingressen står kvar och tomläget syns inte', async () => {
    const sida = synlig(await las(`/app/c/${fullt}/relations`));
    expect(sida).toContain('Senaste kontakt, öppna löften och vad relationen är värd — härlett ur mail, möten, ärenden och bokförda fakturor. Ingen inmatning krävs.');
    expect(sida).not.toContain('Inga relationer ännu');
  });
});
