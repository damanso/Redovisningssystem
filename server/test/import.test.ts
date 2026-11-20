// Fas A13: migration/import. SIE-import (konton + verifikat med färska nummer)
// och CSV-bankimport (dedup, öre). Enhetsparsning + end-to-end via actions.
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { parseSie, accountTypeForNumber, kontrolleraSieInnehall } from '../src/services/sieImport.js';
import { parseBankCsv, parseAmountToOre } from '../src/services/bankImport.js';

const SIE = [
  '#FLAGGA 0', '#PROGRAM "X" 1', '#FORMAT PC8', '#SIETYP 4', '#FNAMN "Test AB"',
  '#KONTO 1930 "Företagskonto"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20250310 "Kontantförsäljning"', '{',
  '   #TRANS 1930 {} 1250.00', '   #TRANS 3001 {} -1250.00', '}',
].join('\r\n');

describe('SIE-parsning', () => {
  it('kontotyp härleds ur kontonummer', () => {
    expect(accountTypeForNumber(1930)).toBe('asset');
    expect(accountTypeForNumber(2010)).toBe('equity');
    expect(accountTypeForNumber(2440)).toBe('liability');
    expect(accountTypeForNumber(3001)).toBe('revenue');
    expect(accountTypeForNumber(5460)).toBe('expense');
  });
  it('parsar konton och verifikat med rätt debet/kredit i öre', () => {
    const p = parseSie(SIE);
    expect(p.accounts).toEqual([{ number: 1930, name: 'Företagskonto' }, { number: 3001, name: 'Försäljning' }]);
    expect(p.vouchers.length).toBe(1);
    const v = p.vouchers[0]!;
    expect(v.date).toBe('2025-03-10');
    expect(v.lines).toEqual([
      { account: 1930, debit_ore: 125000, credit_ore: 0 },
      { account: 3001, debit_ore: 0, credit_ore: 125000 },
    ]);
  });
});

describe('bank-CSV-parsning', () => {
  it('parsar svenska belopp till öre', () => {
    expect(parseAmountToOre('1 234,56')).toBe(123456);
    expect(parseAmountToOre('-1234.56')).toBe(-123456);
    expect(parseAmountToOre('1.234,56')).toBe(123456);
    expect(parseAmountToOre('500')).toBe(50000);
  });
  it('efterställt minus tolkas som negativt (grindfynd)', () => {
    expect(parseAmountToOre('1 234,56-')).toBe(-123456);
    expect(parseAmountToOre('(250,00)')).toBe(-25000);
  });
  it('parsar CSV med rubrikrad och ; som avgränsare', () => {
    const csv = 'Datum;Text;Belopp;Saldo\n2025-06-01;Lön;25000,00;30000,00\n2025-06-02;Hyra;-8000,00;22000,00';
    const rows = parseBankCsv(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ booking_date: '2025-06-01', text: 'Lön', amount_ore: 2500000, balance_ore: 3000000 });
    expect(rows[1]!.amount_ore).toBe(-800000);
  });
});

describe('SIE #TRANS med dimensionsobjekt (grindfynd)', () => {
  it('numeriskt dimensionsvärde förväxlas inte med beloppet', () => {
    const sie = ['#KONTO 1930 "Bank"', '#VER A 1 20250101 "Test"', '{',
      '   #TRANS 1930 {1 "500"} 1000.00', '   #TRANS 3001 {1 "500"} -1000.00', '}'].join('\r\n');
    const v = parseSie(sie).vouchers[0]!;
    expect(v.lines[0]).toEqual({ account: 1930, debit_ore: 100000, credit_ore: 0 }); // 1000 kr, inte 500
    expect(v.lines[1]).toEqual({ account: 3001, debit_ore: 0, credit_ore: 100000 });
  });
});

describe('import end-to-end (actions)', () => {
  let user: TestUser;
  let companyId: string;
  let fiscalYearId: string;
  const auth = () => ({ Authorization: `Bearer ${user.token}` });
  const co = () => `/api/companies/${companyId}`;

  beforeAll(async () => {
    user = await registerUser('import');
    companyId = await createCompany(user.token, 'Import AB');
    const fy = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
    fiscalYearId = fy.body.fiscal_year.id;
  });

  it('SIE-import skapar konton och verifikat (via godkännande)', async () => {
    const req = await api.post(`${co()}/actions/import_sie`).set(auth()).send({ fiscal_year_id: fiscalYearId, sie_content: SIE });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.result.vouchers_imported).toBe(1);
    expect(done.body.result.accounts_created).toBeGreaterThanOrEqual(0); // 1930/3001 kan redan finnas i BAS

    // Verifikatet syns vid SIE-export med importserien I och originalreferensen.
    const sie = await api.get(`${co()}/accounting/fiscal-years/${fiscalYearId}/sie`).set(auth()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(sie.status).toBe(200);
    const text = (sie.body as Buffer).toString('latin1');
    expect(text).toContain('[SIE A1]');
    expect(text).toContain('#VER I 1');
  });

  it('OMimport när kontona redan finns kraschar inte (grindfynd: 25P02 förgiftad transaktion)', async () => {
    // Första importen skapade kontona. En andra import med SAMMA #KONTO-poster
    // gav tidigare 500: INSERT slog i unik-indexet → hela transaktionen i
    // abortläge → nästa fråga fick "current transaction is aborted".
    const req = await api.post(`${co()}/actions/import_sie`).set(auth()).send({ fiscal_year_id: fiscalYearId, sie_content: SIE });
    expect(req.status).toBe(202);
    const done = await api.post(`${co()}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.result.accounts_created).toBe(0); // allt fanns redan
    expect(done.body.result.accounts_skipped).toBeGreaterThan(0);
    expect(done.body.result.vouchers_imported).toBe(1);
  });

  it('godkännande mot fel räkenskapsår ger notis i vyn — inte felsida (grindfynd)', async () => {
    const supertestModule = await import('supertest');
    const { app } = await import('./helpers.js');
    const fyFel = await api.post(`${co()}/accounting/fiscal-years`).set(auth()).send({ label: '2030', start_date: '2030-01-01', end_date: '2030-12-31' });
    const req = await api.post(`${co()}/actions/import_sie`).set(auth()).send({ fiscal_year_id: fyFel.body.fiscal_year.id, sie_content: SIE });
    expect(req.status).toBe(202);
    const ua = supertestModule.default.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
    const res = await ua.post(`/app/c/${companyId}/approvals/${req.body.approval.id}/approve`).send({});
    expect([302, 303]).toContain(res.status); // ALDRIG 500
    expect(res.headers.location).toContain('fel=');
    const page = await ua.get(res.headers.location!);
    expect(page.text).toContain('utanför räkenskapsåret');
  });

  it('bank-CSV-import deduperar vid omkörning', async () => {
    const csv = 'Datum;Text;Belopp\n2025-06-01;Insättning;1000,00\n2025-06-02;Uttag;-250,00';
    const first = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.result.imported).toBe(2);
    expect(first.body.result.duplicates).toBe(0);

    const again = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(again.body.result.imported).toBe(0);
    expect(again.body.result.duplicates).toBe(2);

    const list = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({});
    expect(list.body.result.length).toBe(2);
  });

  it('två genuint identiska rader i samma fil behålls båda (grindfynd)', async () => {
    // Samma dag, text och belopp, inget radsaldo → tidigare kollapsade de till en.
    const csv = 'Datum;Text;Belopp\n2025-07-01;Kaffe;-4500\n2025-07-01;Kaffe;-4500';
    const res = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(res.body.result.imported).toBe(2);
    expect(res.body.result.duplicates).toBe(0);
    // Men en OMimport av exakt samma fil ska fortfarande dedupas helt.
    const again = await api.post(`${co()}/actions/import_bank_csv`).set(auth()).send({ csv_content: csv });
    expect(again.body.result.imported).toBe(0);
    expect(again.body.result.duplicates).toBe(2);
  });

  it('avstämning markerar en transaktion', async () => {
    const list = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({ reconciled: false });
    const before = list.body.result.length;
    const id = list.body.result[0].id;
    const rec = await api.post(`${co()}/actions/reconcile_bank_transaction`).set(auth()).send({ transaction_id: id, reconciled: true });
    expect(rec.status).toBe(200);
    const remaining = await api.post(`${co()}/actions/list_bank_transactions`).set(auth()).send({ reconciled: false });
    expect(remaining.body.result.length).toBe(before - 1);
  });
});


// Rigg och tabellbilder för vyfallen: riktiga HTTP-anrop, tenantfiltrerade
// databasläsningar och auditdifferenser före/efter varje handling.
async function importvy(name: string, years: number[] = [2025]) {
  const user = await registerUser('importvy');
  const companyId = await createCompany(user.token, name);
  const auth = { Authorization: `Bearer ${user.token}` };
  const fy: Record<number, string> = {};
  for (const year of years) {
    fy[year] = (await createFiscalYear(companyId, auth, {
      label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31`,
    })).id;
  }
  const browser = supertest.agent(app);
  const login = await browser.post('/app/login').type('form')
    .send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status, login.text).toBe(302);
  return { user, companyId, auth, fy, browser, base: `/app/c/${companyId}` };
}

type Importvy = Awaited<ReturnType<typeof importvy>>;
type Importresultat = { accounts_created: number; accounts_skipped: number; vouchers_imported: number };
async function importbild(companyId: string) {
  return withAdmin(async (client) => ({
    accounts: (await client.query<{ n: number }>('SELECT count(*)::int AS n FROM accounts WHERE company_id = $1', [companyId])).rows[0]!.n,
    vouchers: (await client.query<{ id: string; series: string; description: string }>(
      'SELECT id, series, description FROM vouchers WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    approvals: (await client.query<{ id: string; action: string; status: string; input: Record<string, unknown>; result: Importresultat }>(
      'SELECT id, action, status, input, result FROM action_approvals WHERE company_id = $1 ORDER BY created_at, id', [companyId])).rows,
    audit: (await client.query<{ id: string; action: string; entity_id: string; user_id: string; details: Record<string, unknown> }>(
      'SELECT id::text, action, entity_id, user_id, details FROM audit_log WHERE company_id = $1 ORDER BY id', [companyId])).rows,
    bank: (await client.query<{ id: string; amount_ore: number; reconciled: boolean }>(
      'SELECT id, amount_ore, reconciled FROM bank_transactions WHERE company_id = $1 ORDER BY booking_date, id', [companyId])).rows,
  }));
}

function nyaRader<T extends { id: string }>(fore: T[], efter: T[]): T[] {
  const ids = new Set(fore.map((row) => row.id));
  return efter.filter((row) => !ids.has(row.id));
}

describe('SIE-import i vyn (FR-39, FR-38, AD-1)', () => {
  let rig: Importvy;
  let agentToken: string;
  let proposalId: string;
  beforeAll(async () => {
    rig = await importvy('Importvy AB');
    const token = await api.post(`/api/companies/${rig.companyId}/agent-tokens`).set(rig.auth).send({ name: 'Importagent' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    agentToken = token.body.token;
  });

  it('S1.1 SIE-importen köas utan konton eller verifikat före godkännande', async () => {
    const before = await importbild(rig.companyId);
    const input = { fiscal_year_id: rig.fy[2025]!, sie_content: SIE };
    const res = await rig.browser.post(`${rig.base}/import/sie`).type('form').send(input);
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const after = await importbild(rig.companyId);
    const added = nyaRader(before.approvals, after.approvals);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ action: 'import_sie', status: 'pending', input });
    proposalId = added[0]!.id;
    expect(after.accounts).toBe(before.accounts);
    expect(after.vouchers).toEqual(before.vouchers);
    const audit = nyaRader(before.audit, after.audit);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'action.approval_requested', entity_id: proposalId })]));
    expect(audit.some((row) => row.action === 'sie.imported')).toBe(false);
  });

  it('S1.2 stor SIE köas medan andra vyformulär behåller 16 kB-gränsen', async () => {
    const large = SIE + '\n' + Array.from({ length: 1000 }, (_, n) => `#UTFYLLNAD "rad ${n}"`).join('\n');
    expect(large.length).toBeGreaterThan(20_000);
    const before = await importbild(rig.companyId);
    const res = await rig.browser.post(`${rig.base}/import/sie`).type('form')
      .send({ fiscal_year_id: rig.fy[2025], sie_content: large });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const after = await importbild(rig.companyId);
    expect(nyaRader(before.approvals, after.approvals)).toEqual([
      expect.objectContaining({ action: 'import_sie', status: 'pending' }),
    ]);
    const denied = await rig.browser.post(`${rig.base}/annual/description`).type('form')
      .send({ fy: rig.fy[2025], business_description: large });
    expect(denied.status, denied.text).toBe(413);
    expect((await importbild(rig.companyId)).audit).toEqual(after.audit);
  });

  it('S1.3 människans godkännande importerar och auditloggar', async () => {
    const before = await importbild(rig.companyId);
    const res = await rig.browser.post(`${rig.base}/approvals/${proposalId}/approve`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).not.toContain('fel=');
    const after = await importbild(rig.companyId);
    const proposal = after.approvals.find((row) => row.id === proposalId)!;
    expect(proposal.status).toBe('executed');
    expect(proposal.result.vouchers_imported).toBe(1);
    expect(proposal.result.accounts_created + proposal.result.accounts_skipped).toBe(2);
    expect(after.accounts).toBe(before.accounts + proposal.result.accounts_created);
    expect(nyaRader(before.vouchers, after.vouchers)).toEqual([
      expect.objectContaining({ series: 'I', description: expect.stringMatching(/^\[SIE A1\]/) }),
    ]);
    expect(nyaRader(before.audit, after.audit).map((row) => row.action))
      .toEqual(expect.arrayContaining(['action.approved_executed', 'sie.imported']));
  });

  it('S1.4 omimport hoppar över befintliga konton utan förgiftad transaktion', async () => {
    const before = await importbild(rig.companyId);
    const queued = await rig.browser.post(`${rig.base}/import/sie`).type('form')
      .send({ fiscal_year_id: rig.fy[2025], sie_content: SIE });
    expect(queued.status, queued.text).toBe(302);
    expect(queued.headers.location).toBe(`${rig.base}/approvals`);
    const added = nyaRader(before.approvals, (await importbild(rig.companyId)).approvals);
    expect(added).toHaveLength(1);
    const res = await rig.browser.post(`${rig.base}/approvals/${added[0]!.id}/approve`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).not.toContain('fel=');
    const after = await importbild(rig.companyId);
    expect(after.approvals.find((row) => row.id === added[0]!.id)).toMatchObject({
      status: 'executed', result: { accounts_created: 0, accounts_skipped: 2, vouchers_imported: 1 },
    });
    expect(after.accounts).toBe(before.accounts);
  });

  it('S1.5 agentens import förblir ett väntande förslag utan verkan', async () => {
    // Förutsättning: blir röd om import_sie körs direkt eller byter känslighet.
    const before = await importbild(rig.companyId);
    const res = await api.post(`/api/companies/${rig.companyId}/actions/import_sie`)
      .set('Authorization', `Bearer ${agentToken}`).send({ fiscal_year_id: rig.fy[2025], sie_content: SIE });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.approval.id).toEqual(expect.any(String));
    const after = await importbild(rig.companyId);
    expect(after.accounts).toBe(before.accounts);
    expect(after.vouchers).toEqual(before.vouchers);
  });
});


describe('Bankimport och avstämning i vyn (FR-25, AD-1)', () => {
  let rig: Importvy;
  let transactionId: string;
  beforeAll(async () => { rig = await importvy('Bankvy AB'); });

  it('B2.1 bankimporten utförs genom åtgärdslagret med människans audit', async () => {
    const before = await importbild(rig.companyId);
    const res = await rig.browser.post(`${rig.base}/import/bank`).type('form').send({
      csv_content: 'Datum;Text;Belopp\n2025-06-01;Insättning;1000,00\n2025-06-02;Uttag;-250,00',
    });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/import`);
    const after = await importbild(rig.companyId);
    const added = nyaRader(before.bank, after.bank);
    expect(added).toHaveLength(2);
    transactionId = added[0]!.id;
    const audit = nyaRader(before.audit, after.audit);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({
      action: 'action.executed', entity_id: 'import_bank_csv', user_id: rig.user.userId,
      details: { actor: 'human', sensitivity: 'write' },
    }), expect.objectContaining({ action: 'bank.imported' })]));
  });

  it('B2.2 identiska rader behålls, svenska ören tolkas och omkörning deduplicerar', async () => {
    // Förutsättning: blir röd om dedupliceringen eller beloppstolkningen ändras.
    const own = await importvy('Bankbelopp AB', []);
    const csv = ['Datum;Text;Belopp', '2025-07-01;Kaffe;-4500', '2025-07-01;Kaffe;-4500',
      '2025-08-01;Avgift;1 234,56-', '2025-08-02;Insättning;1.234,56'].join('\n');
    const before = await importbild(own.companyId);
    const res = await own.browser.post(`${own.base}/import/bank`).type('form').send({ csv_content: csv });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${own.base}/import`);
    const after = await importbild(own.companyId);
    expect(nyaRader(before.bank, after.bank).map((row) => row.amount_ore))
      .toEqual([-450000, -450000, -123456, 123456]);
    const again = await own.browser.post(`${own.base}/import/bank`).type('form').send({ csv_content: csv });
    expect(again.status, again.text).toBe(302);
    expect(again.headers.location).toBe(`${own.base}/import`);
    expect((await importbild(own.companyId)).bank).toEqual(after.bank);
  });

  it('B2.3 avstämningen auditloggas utan att skapa verifikat', async () => {
    const before = await importbild(rig.companyId);
    const res = await rig.browser.post(`${rig.base}/import/reconcile`).type('form').send({ transaction_id: transactionId });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/import`);
    const after = await importbild(rig.companyId);
    expect(after.bank.find((row) => row.id === transactionId)?.reconciled).toBe(true);
    expect(after.vouchers).toEqual(before.vouchers);
    expect(nyaRader(before.audit, after.audit)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'action.executed', entity_id: 'reconcile_bank_transaction' }),
      expect.objectContaining({ action: 'bank.reconciled' }),
    ]));
  });
});


describe('Import visar sina fel (FR-39, AD-1, UX K2)', () => {
  let rig: Importvy;
  let otherCompany: string;
  let otherYear: string;
  const formError = 'Något i formuläret gick inte att spara';
  beforeAll(async () => {
    rig = await importvy('Importfel AB', [2024, 2025]);
    otherCompany = await createCompany(rig.user.token, 'Annat AB');
    otherYear = (await createFiscalYear(otherCompany, rig.auth, {
      label: '2025', start_date: '2025-01-01', end_date: '2025-12-31',
    })).id;
  });

  async function fel(route: string, input: Record<string, unknown>, text: string, fy?: string) {
    const res = await rig.browser.post(`${rig.base}/import/${route}`).type('form').send(input);
    expect(res.status, res.text).toBe(302);
    const url = new URL(res.headers.location!, 'http://vy');
    const message = url.searchParams.get('fel');
    expect(url.pathname).toBe(`${rig.base}/import`);
    expect(url.searchParams.get('fy')).toBe(fy ?? null);
    expect(message).toContain(text);
    const page = await rig.browser.get(res.headers.location!);
    expect(page.status, page.text).toBe(200);
    expect(page.text).toContain('<p class="notice">');
    expect(page.text).toContain(message!);
  }

  it('F3.1 tom SIE samt saknat eller felaktigt år ger formulärnotis utan köpost', async () => {
    const before = await importbild(rig.companyId);
    await fel('sie', { fiscal_year_id: rig.fy[2025], sie_content: '' }, formError, rig.fy[2025]);
    await fel('sie', { sie_content: SIE }, formError);
    await fel('sie', { fiscal_year_id: 'inte-ett-id', sie_content: SIE }, formError);
    // Utan formulärtyp är req.body undefined i Express 5: fortfarande notis.
    const empty = await rig.browser.post(`${rig.base}/import/sie`);
    expect(empty.status, empty.text).toBe(302);
    expect(new URL(empty.headers.location!, 'http://vy').searchParams.get('fel')).toContain(formError);
    expect((await importbild(rig.companyId)).approvals).toEqual(before.approvals);
  });

  it('F3.2 ett främmande räkenskapsår avvisas före kön', async () => {
    const before = await importbild(rig.companyId);
    const otherBefore = await importbild(otherCompany);
    await fel('sie', { fiscal_year_id: otherYear, sie_content: SIE }, 'Räkenskapsåret finns inte i bolaget.', otherYear);
    expect((await importbild(rig.companyId)).approvals).toEqual(before.approvals);
    expect((await importbild(otherCompany)).approvals).toEqual(otherBefore.approvals);
  });

  it('F3.3 ett låst räkenskapsår avvisas före importkön', async () => {
    const lock = await api.patch(`/api/companies/${rig.companyId}/accounting/fiscal-years/${rig.fy[2024]}`)
      .set(rig.auth).send({ locked: true });
    expect(lock.status, JSON.stringify(lock.body)).toBe(202);
    const approve = await api.post(`/api/companies/${rig.companyId}/approvals/${lock.body.approval.id}/approve`)
      .set(rig.auth).send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const before = await importbild(rig.companyId);
    await fel('sie', { fiscal_year_id: rig.fy[2024], sie_content: SIE }, 'räkenskapsåret är låst', rig.fy[2024]);
    expect((await importbild(rig.companyId)).approvals).toEqual(before.approvals);
  });

  it('F3.4 ogiltigt datum och innehåll utan importposter ger svensk notis', async () => {
    const before = await importbild(rig.companyId);
    await fel('sie', { fiscal_year_id: rig.fy[2025], sie_content: SIE.replace('20250310', '2025031') },
      'ogiltigt SIE-datum', rig.fy[2025]);
    await fel('sie', { fiscal_year_id: rig.fy[2025], sie_content: 'detta är ingen SIE-fil' },
      'inga konton och inga verifikat', rig.fy[2025]);
    expect((await importbild(rig.companyId)).approvals).toEqual(before.approvals);
  });

  it('F3.5 tom och otolkbar bank-CSV ger notis utan bankrader', async () => {
    const before = await importbild(rig.companyId);
    await fel('bank', { csv_content: '' }, formError);
    await fel('bank', { csv_content: 'ingen giltig rad här' }, 'inga tolkbara rader i filen');
    expect((await importbild(rig.companyId)).bank).toEqual(before.bank);
  });

  it('F3.6 felaktigt och okänt transaktions-id ger notis utan utförd åtgärd', async () => {
    const before = await importbild(rig.companyId);
    await fel('reconcile', { transaction_id: 'inte-ett-id' }, formError);
    await fel('reconcile', { transaction_id: randomUUID() }, 'transaktionen finns inte');
    const empty = await rig.browser.post(`${rig.base}/import/reconcile`);
    expect(empty.status, empty.text).toBe(302);
    expect(new URL(empty.headers.location!, 'http://vy').searchParams.get('fel')).toContain(formError);
    expect(nyaRader(before.audit, (await importbild(rig.companyId)).audit)
      .filter((row) => row.action === 'action.executed')).toEqual([]);
  });
});


describe('SIE-innehållets formkontroll före kön', () => {
  it('F3.4 formkontrollen kräver konton eller ett avslutat verifikat med rader', () => {
    for (const text of ['', 'detta är ingen SIE-fil', '#VER A 1 20250310 "Tomt"\n{\n}',
      '#VER A 1 20250310 "Oavslutat"\n{\n#TRANS 1930 {} 100']) {
      expect(() => kontrolleraSieInnehall(text)).toThrow('inga konton och inga verifikat');
    }
    expect(() => kontrolleraSieInnehall(SIE.replace('20250310', '2025031'))).toThrow('ogiltigt SIE-datum');
    expect(() => kontrolleraSieInnehall('#KONTO 1930 "Bank"')).not.toThrow();
    expect(() => kontrolleraSieInnehall(SIE.split('\r\n').filter((line) => !line.startsWith('#KONTO')).join('\n'))).not.toThrow();
  });
});


describe('Import-sidans SIE-panel (FR-39, UX K2)', () => {
  let rig: Importvy;
  beforeAll(async () => { rig = await importvy('Importpanel AB', [2025, 2026]); });
  function panel(text: string) {
    const start = text.indexOf('<h2>SIE-import</h2>');
    const end = text.indexOf('<h2>Bank-CSV</h2>', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  }
  async function sida(fy?: string) {
    const res = await rig.browser.get(`${rig.base}/import${fy ? `?fy=${fy}` : ''}`);
    expect(res.status, res.text).toBe(200);
    return res.text;
  }
  async function koa(year: number) {
    const before = await importbild(rig.companyId);
    const res = await rig.browser.post(`${rig.base}/import/sie`).type('form').send({
      fiscal_year_id: rig.fy[year], sie_content: SIE.replace('20250310', `${year}0310`),
    });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const added = nyaRader(before.approvals, (await importbild(rig.companyId)).approvals);
    expect(added).toHaveLength(1);
    return added[0]!.id;
  }

  it('K4.1 SIE-formuläret beskriver förslaget, bär valt år och använder husets fokus', async () => {
    const text = await sida(rig.fy[2025]);
    const sie = panel(text);
    expect(sie).toContain('Importera SIE…');
    expect(sie).toContain('kräver godkännande');
    expect(sie).not.toContain('>Importera SIE<');
    expect(sie).toContain(`action="${rig.base}/import/sie"`);
    expect(sie).toContain(`<input type="hidden" name="fiscal_year_id" value="${rig.fy[2025]}">`);
    expect(sie).toContain('Importen läggs som ett förslag i Att göra.');
    expect(text).toContain('>Importera bank-CSV</button>');
    expect(text).toContain(':focus-visible');
    expect(sie).toMatch(/<label[^>]*>[\s\S]*SIE-innehåll[\s\S]*<textarea[^>]*required/);
    const empty = await importvy('Import utan år AB', []);
    const noYear = await empty.browser.get(`${empty.base}/import`);
    expect(noYear.status, noYear.text).toBe(200);
    expect(panel(noYear.text)).toContain('Skapa ett räkenskapsår först.');
    expect(panel(noYear.text)).not.toContain(`action="${empty.base}/import/sie"`);
    expect(noYear.text).toContain('Inga importerade transaktioner ännu.');
  });

  it('K4.2 ett väntande förslag ersätter formuläret och avvisning återställer det', async () => {
    const id = await koa(2025);
    const text = await sida(rig.fy[2025]);
    const sie = panel(text);
    const link = `${rig.base}/approvals#forslag-${id}`;
    expect(sie).not.toContain(`action="${rig.base}/import/sie"`);
    expect(sie).not.toContain('Importera SIE…');
    expect(sie).toContain(`href="${link}"`);
    expect(sie.split(`href="${link}"`)[1]?.split('</a>')[0]).toContain('Väntar godkännande');
    expect(text).toContain(`action="${rig.base}/import/bank"`);
    const rejected = await rig.browser.post(`${rig.base}/approvals/${id}/reject`).type('form').send({});
    expect(rejected.status, rejected.text).toBe(302);
    expect(rejected.headers.location).not.toContain('fel=');
    const again = panel(await sida(rig.fy[2025]));
    expect(again).toContain(`action="${rig.base}/import/sie"`);
    expect(again).not.toContain(`href="${link}"`);
  });

  it('K4.3 väntan gäller bara valt år och utan årsval används det senaste', async () => {
    const id = await koa(2026);
    const old = panel(await sida(rig.fy[2025]));
    expect(old).toContain(`action="${rig.base}/import/sie"`);
    expect(old).toContain(`name="fiscal_year_id" value="${rig.fy[2025]}"`);
    for (const text of [await sida(rig.fy[2026]), await sida()]) {
      const sie = panel(text);
      expect(sie).toContain(`href="${rig.base}/approvals#forslag-${id}"`);
      expect(sie).not.toContain(`action="${rig.base}/import/sie"`);
      for (const year of [2025, 2026]) expect(sie).toContain(`href="${rig.base}/import?fy=${rig.fy[year]}"`);
      expect(sie).toContain(`class="btn btn--primary btn--sm" href="${rig.base}/import?fy=${rig.fy[2026]}"`);
    }
  });
});
