// Översiktens kort «Likvida medel» (Davids fynd 27/11): talet är bokföringens
// saldo på 1910–1940 PER I DAG, inte summan av alla verifikat — ett verifikat
// daterat efter i dag får inte räknas in. Kortet säger per vilket datum talet
// gäller, att det är bokföringen och inte banken, och — när kontoutdraget är
// inläst — bankens saldo och skillnaden mot bokföringen.
//
// Provdata är vald så att varje fel ger ett annat tal: ett framtida verifikat
// på 1930, ett i dag och ett i förrgår, och ett kontoutdrag vars saldodag inte
// är dess senaste dag och vars sista rad samma dag inte står först i filen.
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, registerUser, type TestUser } from './helpers.js';
import { amount, money } from '../src/http/view/html.js';
import { stockholmToday } from '../src/services/reports.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

const plusDagar = (iso: string, n: number): string => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

const IDAG = stockholmToday();
const FORRGAR = plusDagar(IDAG, -2);
const I_MORGON = plusDagar(IDAG, 1);

const INSATTNING = 500_000;  // förrgår: 1930 debet
const KOSTNAD = 20_000;      // i dag: 1930 kredit
const FRAMTIDA = 70_000;     // i morgon: 1930 debet — får inte ingå
const BANKENS_SALDO = 490_000; // kontoutdraget i förrgår: insättningen minus en obokförd avgift på 100 kr

const MANADER = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const dagManad = (iso: string): string => {
  const [ar, m, d] = iso.split('-');
  const text = `${Number(d)} ${MANADER[Number(m) - 1]}`;
  return ar === IDAG.slice(0, 4) ? text : `${text} ${ar}`;
};

const fyPerAr = new Map<string, string>();

async function verifikat(datum: string, lines: { account_number: number; debit_ore?: number; credit_ore?: number }[]) {
  const res = await api.post(`${co()}/accounting/vouchers`).set(auth()).send({
    fiscal_year_id: fyPerAr.get(datum.slice(0, 4)), voucher_date: datum, description: `Prov ${datum}`, lines,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function dashboardHandling() {
  const res = await api.post(`${co()}/actions/dashboard`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result;
}

async function oversikt(): Promise<string> {
  const ua = supertest.agent(app);
  await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  const sida = await ua.get(`/app/c/${companyId}`);
  expect(sida.status).toBe(200);
  return sida.text;
}

beforeAll(async () => {
  user = await registerUser('likvida');
  companyId = await createCompany(user.token, 'Likvida AB');
  // Tre kalenderår, så att förrgår och i morgon har ett räkenskapsår även runt nyår.
  const ar = Number(IDAG.slice(0, 4));
  for (const y of [ar - 1, ar, ar + 1]) {
    const fy = await createFiscalYear(companyId, auth(), { label: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` });
    fyPerAr.set(String(y), fy.id);
  }
  await verifikat(FORRGAR, [{ account_number: 1930, debit_ore: INSATTNING }, { account_number: 2081, credit_ore: INSATTNING }]);
  await verifikat(IDAG, [{ account_number: 6110, debit_ore: KOSTNAD }, { account_number: 1930, credit_ore: KOSTNAD }]);
  await verifikat(I_MORGON, [{ account_number: 1930, debit_ore: FRAMTIDA }, { account_number: 2081, credit_ore: FRAMTIDA }]);
});

describe('Likvida medel — bokföringen per i dag', () => {
  it('räknar inte verifikat daterade efter i dag, och redovisar dem separat', async () => {
    const d = await dashboardHandling();
    expect(d.bank_ore).toBe(INSATTNING - KOSTNAD);
    expect(d.bank_ore).not.toBe(INSATTNING - KOSTNAD + FRAMTIDA);
    expect(d.bank_future_ore).toBe(FRAMTIDA);
  });

  it('bär datumfälten: i dag, senaste bokförda bankhändelse t.o.m. i dag', async () => {
    const d = await dashboardHandling();
    expect(d.bank_as_of).toBe(IDAG);
    expect(d.as_of).toBe(IDAG);
    // Verifikatet i dag räknas (gränsen är t.o.m.), verifikatet i morgon inte.
    expect(d.bank_last_voucher_date).toBe(IDAG);
    expect(d.scope.bank_ore).toMatch(/till och med bank_as_of/);
  });

  it('utan bankimport: avstämningsfälten är null och kortet säger att banken inte är inläst', async () => {
    const d = await dashboardHandling();
    expect(d.bank_import_date).toBeNull();
    expect(d.bank_statement_date).toBeNull();
    expect(d.bank_statement_ore).toBeNull();
    expect(d.bank_diff_ore).toBeNull();

    const sida = await oversikt();
    expect(sida).not.toContain('Saldo på bankkonton (1910–1940)');
    expect(sida).toContain(`Bokfört på bankkontona 1910–1940 per ${dagManad(IDAG)} · senast bokförd bankhändelse ${dagManad(IDAG)}`);
    expect(sida).toContain('Banken är inte inläst – talet är bokföringen.');
    expect(sida).toContain(`href="/app/c/${companyId}/import#bank-csv"`);
    expect(sida).toContain(`${amount(FRAMTIDA).value} bokfört med datum efter i dag ingår inte.`);
    // Talet vid rubriken är bokföringen per i dag.
    const i = sida.indexOf('>Likvida medel</div>');
    expect(i).toBeGreaterThan(0);
    expect(/<span class="amount[^"]*">[^<]*<\/span>/.exec(sida.slice(i))?.[0]).toBe(amount(INSATTNING - KOSTNAD).value);
    // Importsidan har ankaret som länken pekar på.
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const imp = await ua.get(`/app/c/${companyId}/import`);
    expect(imp.text).toContain('id="bank-csv"');
  });

  it('konsoliderade vyn har samma datumgräns', async () => {
    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const res = await ua.get('/app/consolidated');
    expect(res.status).toBe(200);
    expect(res.text).toContain(amount(INSATTNING - KOSTNAD, { unit: false }).value);
    expect(res.text).not.toContain(amount(INSATTNING - KOSTNAD + FRAMTIDA, { unit: false }).value);
  });

  it('med bankimport: bankens saldo på saldodagens sista rad och skillnaden mot bokföringen samma dag', async () => {
    // Nyaste först, som bankerna exporterar. Dagens sista rad (avgiften) står
    // överst; raden i dag saknar saldo, så saldodagen är förrgår.
    const csv = [
      'Datum;Text;Belopp;Saldo',
      `${IDAG};Kortköp;-200,00;`,
      `${FORRGAR};Bankavgift;-100,00;4900,00`,
      `${FORRGAR};Insättning;5000,00;5000,00`,
    ].join('\n');
    const imp = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.result.imported).toBe(3);

    const d = await dashboardHandling();
    expect(d.bank_import_date).toBe(IDAG);
    expect(d.bank_statement_date).toBe(FORRGAR);
    expect(d.bank_statement_ore).toBe(BANKENS_SALDO);
    // Bokfört per FÖRRGÅR (500 000) minus banken (490 000) — inte dagens bokförda saldo.
    expect(d.bank_diff_ore).toBe(INSATTNING - BANKENS_SALDO);
    // Kortets tal är fortfarande bokföringen per i dag.
    expect(d.bank_ore).toBe(INSATTNING - KOSTNAD);

    const sida = await oversikt();
    expect(sida).not.toContain('Banken är inte inläst');
    expect(sida).toContain(`Banken ${dagManad(FORRGAR)}: ${amount(BANKENS_SALDO).value}`);
    expect(sida).toContain(`Skillnad mot bokföringen: ${money(INSATTNING - BANKENS_SALDO)} kr`);
    expect(sida).toMatch(/<span class="chip chip--warn">(?:<span[^>]*>[^<]*<\/span>)?Skillnad mot bokföringen/);
  });
});
