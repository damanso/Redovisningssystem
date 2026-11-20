// Fas A13: migration/import. SIE-import (konton + verifikat med färska nummer)
// och CSV-bankimport (dedup, öre). Enhetsparsning + end-to-end via actions.
import { describe, expect, it, beforeAll } from 'vitest';
import supertest from 'supertest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { parseSie, accountTypeForNumber, kontrolleraSieInnehall } from '../src/services/sieImport.js';
import { parseBankCsv, parseAmountToOre } from '../src/services/bankImport.js';

const SIE = [
  '#FLAGGA 0', '#PROGRAM "X" 1', '#FORMAT PC8', '#SIETYP 4', '#FNAMN "Test AB"',
  '#KONTO 1930 "Företagskonto"', '#KONTO 3001 "Försäljning"',
  '#VER A 1 20250310 "Kontantförsäljning"', '{',
  '   #TRANS 1930 {} 1250.00', '   #TRANS 3001 {} -1250.00', '}',
].join('\r\n');

// Bolagsfiltrerade ögonblicksbilder: inga sidoeffekter får döljas av andra riggar.
async function importState(companyId: string) {
  return withAdmin(async (c) => {
    const counts = await c.query<{ vouchers: number; accounts: number; audit: number }>(
      `SELECT (SELECT count(*)::int FROM vouchers WHERE company_id = $1) AS vouchers,
        (SELECT count(*)::int FROM accounts WHERE company_id = $1) AS accounts,
        (SELECT coalesce(max(id), 0) FROM audit_log WHERE company_id = $1) AS audit`, [companyId]);
    return counts.rows[0]!;
  });
}

async function pendingImports(companyId: string) {
  return withAdmin(async (c) => (await c.query<{
    id: string; action: string; input: Record<string, unknown>;
  }>(`SELECT id, action, input FROM action_approvals
      WHERE company_id = $1 AND action = 'import_sie' AND status = 'pending'
      ORDER BY created_at, id`, [companyId])).rows);
}

async function importAudit(companyId: string, after: number) {
  return withAdmin(async (c) => (await c.query<{
    action: string; entity_id: string; user_id: string; details: Record<string, unknown>;
  }>('SELECT action, entity_id, user_id, details FROM audit_log WHERE company_id = $1 AND id > $2 ORDER BY id',
    [companyId, after])).rows);
}

async function importRig(name: string, years: number[] = [2025]) {
  const user = await registerUser('importvy');
  const companyId = await createCompany(user.token, name);
  const auth = { Authorization: `Bearer ${user.token}` };
  const fys: string[] = [];
  for (const year of years) {
    fys.push((await createFiscalYear(companyId, auth, {
      label: String(year), start_date: `${year}-01-01`, end_date: `${year}-12-31`,
    })).id);
  }
  const view = supertest.agent(app);
  const login = await view.post('/app/login').type('form').send({ email: user.email, password: 'mycket-hemligt-losen-123' });
  expect(login.status, login.text).toBe(302);
  return { user, companyId, auth, fys, view, base: `/app/c/${companyId}`, co: `/api/companies/${companyId}` };
}

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

describe('SIE-import i vyn (FR-39, FR-38, AD-1)', () => {
  let rig: Awaited<ReturnType<typeof importRig>>;
  let agentToken: string;
  let proposalId: string;
  let beforeImport: Awaited<ReturnType<typeof importState>>;

  beforeAll(async () => {
    rig = await importRig('Importvy AB');
    const token = await api.post(`${rig.co}/agent-tokens`).set(rig.auth).send({ name: 'Importagent' });
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    agentToken = token.body.token;
  }, 120_000);

  it('S1.1 SIE-importen köas utan konton eller verifikat före godkännandet', async () => {
    beforeImport = await importState(rig.companyId);
    const pending = await pendingImports(rig.companyId);
    const input = { fiscal_year_id: rig.fys[0]!, sie_content: SIE };
    const res = await rig.view.post(`${rig.base}/import/sie`).type('form').send(input);
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const added = (await pendingImports(rig.companyId)).filter((p) => !pending.some((old) => old.id === p.id));
    expect(added).toHaveLength(1);
    expect(added[0]!.input).toEqual(input);
    proposalId = added[0]!.id;
    expect(await importState(rig.companyId)).toMatchObject({ vouchers: beforeImport.vouchers, accounts: beforeImport.accounts });
    const audit = await importAudit(rig.companyId, beforeImport.audit);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'action.approval_requested', entity_id: proposalId }));
    expect(audit.some((a) => a.action === 'sie.imported')).toBe(false);
  });

  it('S1.2 stor SIE köas medan andra stora vyformulär fortfarande får 413', async () => {
    const large = SIE + '\n' + Array.from({ length: 1000 }, (_, n) => `#UTFYLLNAD "rad ${n}"`).join('\n');
    expect(large.length).toBeGreaterThan(20_000);
    const pending = await pendingImports(rig.companyId);
    const res = await rig.view.post(`${rig.base}/import/sie`).type('form').send({ fiscal_year_id: rig.fys[0]!, sie_content: large });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const added = (await pendingImports(rig.companyId)).filter((p) => !pending.some((old) => old.id === p.id));
    expect(added).toHaveLength(1);
    expect(added[0]!.input.sie_content).toBe(large);
    const before = await importState(rig.companyId);
    const other = await rig.view.post(`${rig.base}/annual/description`).type('form').send({ fy: rig.fys[0]!, business_description: large });
    expect(other.status, other.text).toBe(413);
    expect(await importAudit(rig.companyId, before.audit)).toEqual([]);
  });

  it('S1.3 godkännandet i vyn importerar konton och verifikat i serie I', async () => {
    const res = await rig.view.post(`${rig.base}/approvals/${proposalId}/approve`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const row = await withAdmin(async (c) => (await c.query(
      'SELECT status, result FROM action_approvals WHERE company_id = $1 AND id = $2', [rig.companyId, proposalId])).rows[0]!);
    expect(row.status).toBe('executed');
    expect(row.result.vouchers_imported).toBe(1);
    expect(row.result.accounts_created + row.result.accounts_skipped).toBe(2);
    const now = await importState(rig.companyId);
    expect(now.vouchers).toBe(beforeImport.vouchers + 1);
    expect(now.accounts).toBe(beforeImport.accounts + row.result.accounts_created);
    const vouchers = await withAdmin(async (c) => (await c.query(
      "SELECT description FROM vouchers WHERE company_id = $1 AND series = 'I'", [rig.companyId])).rows);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]!.description).toMatch(/^\[SIE A1\]/);
    const audit = await importAudit(rig.companyId, beforeImport.audit);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['action.approved_executed', 'sie.imported']));
  });

  it('S1.4 omimport hoppar över befintliga konton utan att förgifta transaktionen', async () => {
    const pending = await pendingImports(rig.companyId);
    const queued = await rig.view.post(`${rig.base}/import/sie`).type('form').send({ fiscal_year_id: rig.fys[0]!, sie_content: SIE });
    expect(queued.status, queued.text).toBe(302);
    expect(queued.headers.location).toBe(`${rig.base}/approvals`);
    const added = (await pendingImports(rig.companyId)).filter((p) => !pending.some((old) => old.id === p.id));
    expect(added).toHaveLength(1);
    const before = await importState(rig.companyId);
    const res = await rig.view.post(`${rig.base}/approvals/${added[0]!.id}/approve`).type('form').send({});
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const row = await withAdmin(async (c) => (await c.query(
      'SELECT status, result FROM action_approvals WHERE company_id = $1 AND id = $2', [rig.companyId, added[0]!.id])).rows[0]!);
    expect(row.status).toBe('executed');
    expect(row.result).toMatchObject({ accounts_created: 0, accounts_skipped: 2, vouchers_imported: 1 });
    expect(await importState(rig.companyId)).toMatchObject({ accounts: before.accounts, vouchers: before.vouchers + 1 });
  });

  it('S1.5 agentens import_sie förblir ett väntande förslag utan verkan (förutsättning)', async () => {
    // Motprov: blir rött om åtgärden körs direkt eller slutar kräva godkännande.
    const before = await importState(rig.companyId);
    const res = await api.post(`${rig.co}/actions/import_sie`).set('Authorization', `Bearer ${agentToken}`)
      .send({ fiscal_year_id: rig.fys[0]!, sie_content: SIE });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.approval.id).toEqual(expect.any(String));
    expect(await importState(rig.companyId)).toMatchObject({ accounts: before.accounts, vouchers: before.vouchers });
  });

});

describe('Bankimport och avstämning i vyn (FR-25, AD-1)', () => {
  let rig: Awaited<ReturnType<typeof importRig>>;
  let transactionId: string;
  beforeAll(async () => { rig = await importRig('Bankvy AB'); }, 120_000);

  async function bankRows(companyId: string) {
    return withAdmin(async (c) => (await c.query<{ id: string; amount_ore: number; reconciled: boolean }>(
      'SELECT id, amount_ore, reconciled FROM bank_transactions WHERE company_id = $1 ORDER BY booking_date, id', [companyId])).rows);
  }

  it('B2.1 bankimporten utförs genom åtgärdslagret med människans auditrad', async () => {
    const before = await importState(rig.companyId);
    const rowsBefore = await bankRows(rig.companyId);
    const csv = 'Datum;Text;Belopp\n2025-06-01;Insättning;1000,00\n2025-06-02;Uttag;-250,00';
    const res = await rig.view.post(`${rig.base}/import/bank`).type('form').send({ csv_content: csv });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/import`);
    const rows = await bankRows(rig.companyId);
    expect(rows).toHaveLength(rowsBefore.length + 2);
    transactionId = rows[0]!.id;
    const audit = await importAudit(rig.companyId, before.audit);
    expect(audit).toContainEqual(expect.objectContaining({
      action: 'action.executed', entity_id: 'import_bank_csv', user_id: rig.user.userId,
      details: { actor: 'human', sensitivity: 'write' },
    }));
    expect(audit.map((a) => a.action)).toContain('bank.imported');
  });

  it('B2.2 identiska rader behålls, omkörning deduplicerar och svenska belopp blir rätt ören', async () => {
    // Förutsättning: blir röd om banktjänstens deduplicering/beloppstolkning ändras.
    const own = await importRig('Bankdubbletter AB');
    const csv = 'Datum;Text;Belopp\n2025-07-01;Kaffe;-4500\n2025-07-01;Kaffe;-4500\n2025-08-01;Avgift;1 234,56-\n2025-08-02;Insättning;1.234,56';
    const first = await own.view.post(`${own.base}/import/bank`).type('form').send({ csv_content: csv });
    expect(first.status, first.text).toBe(302);
    expect(first.headers.location).toBe(`${own.base}/import`);
    const rows = await bankRows(own.companyId);
    expect(rows.map((r) => r.amount_ore)).toEqual([-450000, -450000, -123456, 123456]);
    const again = await own.view.post(`${own.base}/import/bank`).type('form').send({ csv_content: csv });
    expect(again.status, again.text).toBe(302);
    expect(again.headers.location).toBe(`${own.base}/import`);
    expect(await bankRows(own.companyId)).toEqual(rows);
  });

  it('B2.3 avstämningen auditloggas utan att skapa verifikat', async () => {
    const before = await importState(rig.companyId);
    const res = await rig.view.post(`${rig.base}/import/reconcile`).type('form').send({ transaction_id: transactionId });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/import`);
    expect((await bankRows(rig.companyId)).find((r) => r.id === transactionId)?.reconciled).toBe(true);
    expect((await importState(rig.companyId)).vouchers).toBe(before.vouchers);
    const audit = await importAudit(rig.companyId, before.audit);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'action.executed', entity_id: 'reconcile_bank_transaction' }));
    expect(audit.map((a) => a.action)).toContain('bank.reconciled');
  });
});

describe('Import visar sina fel (FR-39, AD-1, UX K2)', () => {
  let rig: Awaited<ReturnType<typeof importRig>>;
  let otherCompany: string;
  let otherYear: string;
  beforeAll(async () => {
    rig = await importRig('Importfel AB', [2024, 2025]);
    otherCompany = await createCompany(rig.user.token, 'Annat AB');
    otherYear = (await createFiscalYear(otherCompany, rig.auth, {
      label: '2025', start_date: '2025-01-01', end_date: '2025-12-31',
    })).id;
  }, 120_000);

  async function notice(route: string, fields: Record<string, string>, text: string, fy?: string) {
    const res = await rig.view.post(`${rig.base}/import/${route}`).type('form').send(fields);
    expect(res.status, res.text).toBe(302);
    const url = new URL(res.headers.location!, 'http://vy');
    expect(url.pathname).toBe(`${rig.base}/import`);
    expect(url.searchParams.get('fy')).toBe(fy ?? null);
    const message = url.searchParams.get('fel');
    expect(message).toContain(text);
    if (text.startsWith('Något')) expect(message!.startsWith(text)).toBe(true);
    const page = await rig.view.get(res.headers.location!);
    expect(page.status, page.text).toBe(200);
    expect(page.text).toContain('<p class="notice">');
    expect(page.text).toContain(message!);
  }

  it('F3.1 tom SIE och saknat eller felaktigt års-id ger formulärnotis utan förslag', async () => {
    const before = await pendingImports(rig.companyId);
    const text = 'Något i formuläret gick inte att spara';
    await notice('sie', { fiscal_year_id: rig.fys[1]!, sie_content: '' }, text, rig.fys[1]);
    await notice('sie', { sie_content: SIE }, text);
    await notice('sie', { fiscal_year_id: 'inte-ett-id', sie_content: SIE }, text);
    // Odefinierad body ska också ge notis (Express 5), aldrig ett TypeError.
    for (const route of ['sie', 'bank', 'reconcile']) {
      const res = await rig.view.post(`${rig.base}/import/${route}`);
      expect(res.status, res.text).toBe(302);
      expect(new URL(res.headers.location!, 'http://vy').searchParams.get('fel')).toMatch(/^Något i formuläret/);
    }
    expect(await pendingImports(rig.companyId)).toEqual(before);
  });

  it('F3.2 främmande räkenskapsår ger notis utan förslag i något bolag', async () => {
    const own = await pendingImports(rig.companyId);
    const other = await pendingImports(otherCompany);
    await notice('sie', { fiscal_year_id: otherYear, sie_content: SIE }, 'Räkenskapsåret finns inte i bolaget.', otherYear);
    expect(await pendingImports(rig.companyId)).toEqual(own);
    expect(await pendingImports(otherCompany)).toEqual(other);
  });

  it('F3.3 låst räkenskapsår avvisas före kön med synlig notis', async () => {
    const lock = await api.patch(`${rig.co}/accounting/fiscal-years/${rig.fys[0]!}`).set(rig.auth).send({ locked: true });
    expect(lock.status, JSON.stringify(lock.body)).toBe(202);
    const approved = await api.post(`${rig.co}/approvals/${lock.body.approval.id}/approve`).set(rig.auth).send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const before = await pendingImports(rig.companyId);
    await notice('sie', { fiscal_year_id: rig.fys[0]!, sie_content: SIE }, 'räkenskapsåret är låst', rig.fys[0]);
    expect(await pendingImports(rig.companyId)).toEqual(before);
  });

  it('F3.4 ogiltigt datum och innehåll utan konton eller verifikat avvisas utan förslag', async () => {
    // Ren enhetskontroll av den exakta formregeln, även när bara en typ finns.
    expect(() => kontrolleraSieInnehall(SIE)).not.toThrow();
    expect(() => kontrolleraSieInnehall('#KONTO 1930 "Bank"')).not.toThrow();
    expect(() => kontrolleraSieInnehall(SIE.split('\r\n').filter((line) => !line.startsWith('#KONTO')).join('\n'))).not.toThrow();
    expect(() => kontrolleraSieInnehall(SIE.replace('20250310', '2025031'))).toThrow('ogiltigt SIE-datum');
    const before = await pendingImports(rig.companyId);
    await notice('sie', { fiscal_year_id: rig.fys[1]!, sie_content: SIE.replace('20250310', '2025031') }, 'ogiltigt SIE-datum', rig.fys[1]);
    for (const sie_content of ['detta är ingen SIE-fil', '#VER A 1 20250310 "Tomt"\n{\n}', '#VER A 1 20250310 "Oavslutat"\n{\n#TRANS 1930 {} 10']) {
      expect(() => kontrolleraSieInnehall(sie_content)).toThrow('inga konton och inga verifikat');
      await notice('sie', { fiscal_year_id: rig.fys[1]!, sie_content }, 'inga konton och inga verifikat', rig.fys[1]);
    }
    expect(await pendingImports(rig.companyId)).toEqual(before);
  });

  it('F3.5 tom eller otolkbar bankfil ger notis och inga transaktioner', async () => {
    const count = () => withAdmin(async (c) => (await c.query(
      'SELECT count(*)::int AS n FROM bank_transactions WHERE company_id = $1', [rig.companyId])).rows[0]!.n);
    const before = await count();
    await notice('bank', { csv_content: '' }, 'Något i formuläret gick inte att spara');
    await notice('bank', { csv_content: 'ingen giltig rad här' }, 'inga tolkbara rader i filen');
    expect(await count()).toBe(before);
  });

  it('F3.6 felaktigt och okänt transaktions-id ger notis utan action.executed', async () => {
    const before = await importState(rig.companyId);
    await notice('reconcile', { transaction_id: 'inte-ett-id' }, 'Något i formuläret gick inte att spara');
    await notice('reconcile', { transaction_id: crypto.randomUUID() }, 'transaktionen finns inte');
    expect((await importAudit(rig.companyId, before.audit)).filter((a) => a.action === 'action.executed')).toEqual([]);
  });
});

describe('Import-sidans SIE-panel (FR-39, UX K2)', () => {
  let rig: Awaited<ReturnType<typeof importRig>>;
  let pending2026: string;
  beforeAll(async () => { rig = await importRig('Importpanel AB', [2025, 2026]); }, 120_000);

  async function panel(fy?: string) {
    const page = await rig.view.get(`${rig.base}/import${fy ? `?fy=${fy}` : ''}`);
    expect(page.status, page.text).toBe(200);
    const start = page.text.indexOf('<h2>SIE-import</h2>');
    const end = page.text.indexOf('<h2>Bank-CSV</h2>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return { sie: page.text.slice(start, end), page: page.text };
  }
  async function queue(fy: string, content = SIE) {
    const before = await pendingImports(rig.companyId);
    const res = await rig.view.post(`${rig.base}/import/sie`).type('form').send({ fiscal_year_id: fy, sie_content: content });
    expect(res.status, res.text).toBe(302);
    expect(res.headers.location).toBe(`${rig.base}/approvals`);
    const added = (await pendingImports(rig.companyId)).filter((p) => !before.some((b) => b.id === p.id));
    expect(added).toHaveLength(1);
    return added[0]!.id;
  }
  const hiddenYear = (fy: string) => `type="hidden" name="fiscal_year_id" value="${fy}"`;
  const formAction = () => `action="${rig.base}/import/sie"`;

  it('K4.1 panelen visar förslagstext, ellips, hint och dolt valt år', async () => {
    const { sie, page } = await panel(rig.fys[0]);
    expect(sie).toContain('Importera SIE…');
    expect(sie).toContain('kräver godkännande');
    expect(sie).toContain('Importen läggs som ett förslag i Att göra.');
    expect(sie).not.toContain('>Importera SIE<');
    expect(sie).toContain(formAction());
    expect(sie).toContain(hiddenYear(rig.fys[0]!));
    expect(page).toContain('>Importera bank-CSV</button>');
    expect(sie).toContain('<span>SIE-innehåll</span><textarea');
    expect(sie).toContain('required');
  });

  it('K4.2 väntande import ersätter formuläret med kortlänk tills förslaget avvisats', async () => {
    const id = await queue(rig.fys[0]!);
    const link = `href="${rig.base}/approvals#forslag-${id}"`;
    const pending = await panel(rig.fys[0]);
    expect(pending.sie).not.toContain(formAction());
    expect(pending.sie).not.toContain('Importera SIE…');
    expect(pending.sie).toMatch(new RegExp(`<a href="${rig.base}/approvals#forslag-${id}">[\\s\\S]*?Väntar godkännande[\\s\\S]*?</a>`));
    expect(pending.page).toContain(`action="${rig.base}/import/bank"`);
    const rejected = await rig.view.post(`${rig.base}/approvals/${id}/reject`).type('form').send({});
    expect(rejected.status, rejected.text).toBe(302);
    expect(rejected.headers.location).toBe(`${rig.base}/approvals`);
    const after = await panel(rig.fys[0]);
    expect(after.sie).toContain(formAction());
    expect(after.sie).not.toContain(link);
  });

  it('K4.3 väntande förslag gäller sitt år och utan fy väljs det senaste året', async () => {
    pending2026 = await queue(rig.fys[1]!, SIE.replace('20250310', '20260310'));
    const old = await panel(rig.fys[0]);
    expect(old.sie).toContain(formAction());
    expect(old.sie).toContain(hiddenYear(rig.fys[0]!));
    const link = `href="${rig.base}/approvals#forslag-${pending2026}"`;
    for (const fy of [rig.fys[1], undefined]) {
      const { sie } = await panel(fy);
      expect(sie).toContain(link);
      expect(sie).toContain('Väntar godkännande');
      expect(sie).not.toContain(formAction());
      for (const year of rig.fys) expect(sie).toContain(`href="${rig.base}/import?fy=${year}"`);
    }
  });

  it('K4.4 låst år visar ingen knapp och väntande förslag går före låst-chippet', async () => {
    for (const fy of rig.fys) {
      const lock = await api.patch(`${rig.co}/accounting/fiscal-years/${fy}`).set(rig.auth).send({ locked: true });
      expect(lock.status, JSON.stringify(lock.body)).toBe(202);
      const done = await api.post(`${rig.co}/approvals/${lock.body.approval.id}/approve`).set(rig.auth).send({});
      expect(done.status, JSON.stringify(done.body)).toBe(200);
    }
    const locked = await panel(rig.fys[0]);
    expect(locked.sie).not.toContain(formAction());
    expect(locked.sie).not.toContain('Importera SIE…');
    expect(locked.sie).toContain('Räkenskapsåret är låst');
    expect(locked.page).toContain(`action="${rig.base}/import/bank"`);
    const waiting = await panel(rig.fys[1]);
    expect(waiting.sie).toContain(`href="${rig.base}/approvals#forslag-${pending2026}"`);
    expect(waiting.sie).toContain('Väntar godkännande');
    expect(waiting.sie).not.toContain('Räkenskapsåret är låst');
  });
});
