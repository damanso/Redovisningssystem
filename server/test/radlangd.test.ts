// 15-ordsregeln, prövad mot den RENDERADE ytan.
//
// Regeln kommer ur djupanalysen §5 (NN/g:s 28-procentsregel, GOV.UK:s
// radmönster): en rad = max ~15 ord synliga. Skälet är mätbart och inte
// smaksak — `.table-wrap` wrappar inte utan scrollar (`overflow-x: auto`,
// tabellen `min-width: 480px`), så en lång fritext trycker BELOPPET och
// STATUS utanför skärmen på en telefon. Det man kom för hamnar bakom det man
// inte kom för.
//
// Provet är HÄRLETT, inte uppräknat. Det listar inte "leverantörskortet och
// /receipts" — det skapar ETT kvitto med en känd, lång beskrivning och kräver
// sedan att hela beskrivningen inte går att hitta NÅGONSTANS i vyytan.
// Sveparen följer varje intern länk från översikten, så en ny lista som
// glömmer kapa faller här utan att någon behöver komma ihåg att uppdatera
// provet.
//
// Kvittot lämnas som UTKAST med flit: ett bokfört kvitto får ett verifikat,
// och verifikatet är ett DOKUMENT. I dokument kapas ingenting — där ÄR texten
// uppgiften. Gränsen går mellan skanningslista och dokument, inte mellan
// långa och korta strängar.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';

/** 40 entydiga ord — inget av dem kan råka stå någon annanstans i HTML:en. */
const ORD = Array.from({ length: 40 }, (_, i) => `xrad${i + 1}`);
const LANG = ORD.join(' ');
const KAPAD = `${ORD.slice(0, 15).join(' ')}…`;
const KORT = 'Kort rad som inte ska kapas';

let user: TestUser;
let companyId: string;
let supplierId: string;
let ua: ReturnType<typeof supertest.agent>;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

beforeAll(async () => {
  user = await registerUser('radlangd');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), {
    label: '2026', start_date: '2026-01-01', end_date: '2026-12-31',
  });

  const lev = await api.post(`${co()}/suppliers`).set(auth()).send({ name: 'Trycksaker Väst AB' });
  expect(lev.status, JSON.stringify(lev.body)).toBe(201);
  supplierId = lev.body.supplier.id;

  for (const [beskrivning, dag] of [[LANG, '2026-03-02'], [KORT, '2026-03-03']] as const) {
    const r = await api.post(`${co()}/actions/create_receipt`).set(auth()).send({
      supplier_id: supplierId,
      receipt_date: dag,
      description: beskrivning,
      net_ore: 120000,
      vat_rate: 25,
      expense_account: 6110,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }

  ua = supertest.agent(app);
  const login = await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  expect([302, 303]).toContain(login.status);
});

async function sida(path: string): Promise<string> {
  const res = await ua.get(path);
  expect(res.status, `${path} gav ${res.status}`).toBe(200);
  return res.text;
}

describe('15-ordsregeln i skanningslistor', () => {
  it('leverantörskortets kvittopanel kapar — och kapningen syns', async () => {
    const html = await sida(`/app/c/${companyId}/suppliers/${supplierId}`);
    expect(html, 'hela beskrivningen renderas oavkortad').not.toContain(LANG);
    expect(html, 'den kapade formen saknas — då kapades inget alls').toContain(KAPAD);
  });

  it('appens egen kvittolista kapar likadant — samma regel i hela systemet', async () => {
    const html = await sida(`/app/c/${companyId}/receipts`);
    expect(html).not.toContain(LANG);
    expect(html).toContain(KAPAD);
  });

  it('NEGATIV KONTROLL: en kort rad rörs inte, och får ingen ellips', async () => {
    const html = await sida(`/app/c/${companyId}/receipts`);
    expect(html, 'den korta raden ska stå hel').toContain(KORT);
    expect(html, `"${KORT}…" betyder att kapningen slår mot rader den inte ska röra`)
      .not.toContain(`${KORT}…`);
  });

  it('SVEP: hela beskrivningen finns inte på NÅGON sida vyn länkar till', async () => {
    const start = `/app/c/${companyId}`;
    const besokta = new Set<string>();
    const ko = [start];
    const trasiga: string[] = [];

    while (ko.length > 0 && besokta.size < 120) {
      const path = ko.shift()!;
      if (besokta.has(path)) continue;
      besokta.add(path);

      const res = await ua.get(path);
      if (res.status !== 200) continue;
      const html = res.text;

      if (html.includes(LANG)) trasiga.push(path);

      for (const m of html.matchAll(/href="(\/app\/c\/[^"#?]*)"/g)) {
        const nasta = m[1];
        if (!nasta) continue;
        if (!besokta.has(nasta) && !nasta.includes('/download')) ko.push(nasta);
      }
    }

    expect(besokta.size, 'svepet nådde inga sidor — då bevisar det ingenting').toBeGreaterThan(5);
    expect(trasiga, `oavkortad beskrivning renderas på: ${trasiga.join(', ')}`).toEqual([]);
  });
});
