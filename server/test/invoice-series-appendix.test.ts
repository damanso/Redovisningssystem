// LOC-263: fakturaserien synkad med kundserien + bilagan (sida 2) i husmallen.
//
// Facit ur Davids VERKLIGA fakturor:
//   0000027 (ILT juli 2026): tidsbilaga per datum, summa 31,42 h (= 1885 min),
//     rader t.ex. 0,42 h (25 min); fakturaraderna 23,75 h + 7,67 h à 1 100 kr
//     ger 34 562,00 exkl. moms och 43 202,50 att betala.
//   0000024 (NVR juni 2026): utläggsbilaga, summa 14 503,00 exkl. moms.
// Seriesynk: internt 14 = externt 26, internt 26 = externt 27 (Davids läge).
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, createFiscalYear, pdfText, registerUser, withAdmin, type TestUser } from './helpers.js';

const PASSWORD = 'mycket-hemligt-losen-123';
let user: TestUser;
let companyId: string;
let customerId: string;
const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;
const strip = (s: string) => s.replace(/[\s  ]/g, '');

async function approve(body: { approval: { id: string } }) {
  return api.post(`${co()}/approvals/${body.approval.id}/approve`).set(auth()).send({});
}

async function newInvoice(over: Record<string, unknown> = {}): Promise<{ id: string; number: number }> {
  const res = await api.post(`${co()}/actions/create_invoice`).set(auth()).send({
    customer_id: customerId, invoice_date: '2026-07-31', due_date: '2026-08-30',
    lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: res.body.result.id, number: res.body.result.invoice_number };
}

async function pdfBuffer(invoiceId: string): Promise<Buffer> {
  const res = await api.post(`${co()}/invoices/${invoiceId}/pdf`).set(auth()).buffer()
    .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

beforeAll(async () => {
  user = await registerUser('serie');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await api.patch(`${co()}`).set(auth()).send({ org_number: '5593481111', bankgiro: '5776-6446' });
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const c = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Inläsningstjänst AB' });
  customerId = c.body.customer.id;
});

describe('seriesynk: en serie framåt', () => {
  it('räknaren visar läget och flaggar när den ligger efter kundserien', async () => {
    const a = await newInvoice(); // internt 1
    expect(a.number).toBe(1);
    const s = await api.post(`${co()}/actions/get_invoice_number_series`).set(auth()).send({});
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.result.next_invoice_number).toBe(2);
    expect(s.body.result.highest_number_in_use).toBe(1);
    expect(s.body.result.out_of_sync).toBe(false);
  });

  it('räknaren kan flyttas FRAMÅT till kundserien — nästa faktura får rätt nummer', async () => {
    const req = await api.post(`${co()}/actions/set_invoice_number_series`).set(auth()).send({ next_invoice_number: 28 });
    expect(req.status).toBe(202); // känslig: kräver mänskligt godkännande
    const ok = await approve(req.body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.result.next_invoice_number).toBe(28);

    const next = await newInvoice();
    expect(next.number).toBe(28); // fortsätter kundserien
  });

  it('räknaren kan ALDRIG backas (skulle ge dubbla fakturanummer)', async () => {
    const req = await api.post(`${co()}/actions/set_invoice_number_series`).set(auth()).send({ next_invoice_number: 5 });
    expect(req.status).toBe(202);
    const res = await approve(req.body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('series_cannot_move_backwards');
  });

  it('hoppet auditloggas med både gammalt och nytt värde', async () => {
    const row = await withAdmin(async (a) => (await a.query(
      "SELECT details FROM audit_log WHERE company_id = $1 AND action = 'invoice.number_series_set' ORDER BY id DESC LIMIT 1",
      [companyId])).rows[0]);
    expect(row.details.to_next_value).toBe(28);
    expect(row.details.from_next_value).toBe(2);
  });
});

describe('seriesynk: kundens nummer på gamla fakturor (internt 14 = externt 26)', () => {
  let internal14: { id: string; number: number };
  let internal26: { id: string; number: number };

  it('omnumrering i EN batch fungerar oavsett ordning (uppskjuten unikhetskontroll)', async () => {
    internal14 = await newInvoice(); // internt 28
    internal26 = await newInvoice(); // internt 29
    // Byt så att 28 visas som 29 och 29 som 30 — kollisionen under vägen får
    // inte fälla batchen (det var precis fallet internt 14→26 vs befintlig 26).
    const req = await api.post(`${co()}/actions/set_external_invoice_numbers`).set(auth()).send({
      assignments: [
        { invoice_id: internal14.id, external_invoice_number: internal26.number },
        { invoice_id: internal26.id, external_invoice_number: internal26.number + 1 },
      ],
    });
    expect(req.status).toBe(202);
    const ok = await approve(req.body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('PDF:en och vyn visar KUNDENS nummer, internnumret finns kvar spårbart', async () => {
    const got = await api.post(`${co()}/actions/get_invoice`).set(auth()).send({ invoice_id: internal14.id });
    expect(got.body.result.invoice_number).toBe(internal14.number);          // internt orört
    expect(got.body.result.external_invoice_number).toBe(internal26.number); // kundens
    expect(got.body.result.effective_invoice_number).toBe(internal26.number);

    const text = pdfText(await pdfBuffer(internal14.id));
    expect(text).toContain(String(internal26.number).padStart(7, '0')); // kundens nummer på PDF:en
    expect(text).not.toContain(String(internal14.number).padStart(7, '0'));

    const ua = supertest.agent(app);
    await ua.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
    const page = await ua.get(`/app/c/${companyId}/invoices/${internal14.id}`);
    expect(page.text).toContain(`Faktura ${internal26.number} —`);
    expect(page.text).toContain('Internt nummer');
  });

  it('två fakturor kan aldrig visa samma nummer för kunden', async () => {
    const other = await newInvoice();
    const req = await api.post(`${co()}/actions/set_external_invoice_numbers`).set(auth()).send({
      assignments: [{ invoice_id: other.id, external_invoice_number: internal26.number }], // redan upptaget
    });
    expect(req.status).toBe(202);
    const res = await approve(req.body);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('bilagan sida 2 — tidsspecifikation (facit: faktura 0000027)', () => {
  let invoiceId: string;

  it('bilagan sätts och summerar 1885 min = 31,42 h', async () => {
    const inv = await newInvoice({
      our_reference: 'David Mancilla', reference: 'Jakob Skogholm', delivery_period: 'Juli 2026',
      lines: [
        { description: 'Fas 2A – rapporteringsmodell & Commercial Cockpit (v1–v6), juli 2026', quantity: 23.75, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 },
        { description: 'Fas 1A – ambassadörsuppföljningar: 5 uppföljningsmöten à 1 h + mötesförberedelse', quantity: 7.67, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 },
      ],
    });
    invoiceId = inv.id;
    const res = await api.post(`${co()}/actions/set_invoice_appendix`).set(auth()).send({
      invoice_id: invoiceId, kind: 'time',
      title: 'Bilaga – tidsspecifikation juli 2026',
      preamble: 'Konsultarvode enligt löpande räkning, 1 100 SEK/tim exkl. moms. Leveranstidpunkt juli 2026.',
      rows: [
        { entry_date: '2026-07-01', description: 'Fas 2A: modellstart — mötesanalys 2 (Alexandra)', minutes: 180 },
        { entry_date: '2026-07-02', description: 'Fas 1A: körplan + prioriteringsunderlag', minutes: 25 },
        { entry_date: '2026-07-10', description: 'Fas 2A: Commercial Cockpit v1–v4', minutes: 270 },
        { entry_date: '2026-07-29', description: 'Fas 2A: Cockpit v6 — Zeyneps KPI-data', minutes: 1410 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.total_minutes).toBe(1885); // = 31,42 h
    expect(res.body.result.kind).toBe('time');
  });

  it('PDF:en får en sida 2 med husmallens tidsbilaga', async () => {
    const buf = await pdfBuffer(invoiceId);
    const text = pdfText(buf);
    expect(buf.toString('latin1')).toContain('/Count 2'); // två sidor
    expect(text).toContain('Tillhör faktura');
    expect(text).toContain('Bilaga – tidsspecifikation juli 2026');
    expect(text).toContain('Konsultarvode enligt löpande räkning');
    expect(text).toContain('Datum');
    expect(text).toContain('Timmar');
    expect(text).toContain('2026-07-01');
    expect(strip(text)).toContain('0,42');            // 25 min visas som 0,42 h
    expect(text).toContain('Summa fakturerbar tid');
    expect(strip(text)).toContain('31,42h');          // facit ur faktura 27
    // Sida 1:s belopp ska stämma med den riktiga fakturan.
    expect(strip(text)).toContain('34562,00SEK');
    expect(strip(text)).toContain('43202,50SEK');
  });

  it('bilagan kan inte ändras på en bokförd faktura (underlaget är oföränderligt)', async () => {
    const req = await api.post(`${co()}/actions/book_invoice`).set(auth()).send({ invoice_id: invoiceId });
    expect(req.status).toBe(202);
    expect((await approve(req.body)).status).toBe(200);

    const res = await api.post(`${co()}/actions/set_invoice_appendix`).set(auth()).send({
      invoice_id: invoiceId, kind: 'time',
      rows: [{ entry_date: '2026-07-01', description: 'Ändring i efterhand', minutes: 60 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('invoice_not_draft');
  });
});

describe('bilagan sida 2 — utläggsspecifikation (facit: faktura 0000024)', () => {
  it('utläggsbilagan summerar exkl./moms/inkl. moms som i husmallen', async () => {
    const inv = await newInvoice({
      lines: [{ description: 'Vidarefakturerade reseutlägg', quantity: 1, unit: 'st', unit_price_ore: 1_450_300, vat_rate: 25 }],
    });
    const res = await api.post(`${co()}/actions/set_invoice_appendix`).set(auth()).send({
      invoice_id: inv.id, kind: 'expense',
      title: 'Bilaga – specifikation av utlägg',
      preamble: 'Vidarefakturerade reseutlägg, NVR-uppdraget – Dublin/London-resan.',
      notes: 'Belopp i SEK enligt bokförda verifikationer (Locollabs AB).',
      rows: [
        { entry_date: '2026-05-22', description: 'SAS flyg ARN–Dublin t/r', amount_ore: 197_900 },
        { entry_date: '2026-06-01', description: 'Aer Lingus Dublin–London Heathrow', amount_ore: 136_600 },
        { entry_date: '2026-06-08', description: 'Crowne Plaza Dublin, boende', amount_ore: 1_115_800 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.total_amount_ore).toBe(1_450_300); // 14 503,00

    const text = pdfText(await pdfBuffer(inv.id));
    expect(text).toContain('Bilaga – specifikation av utlägg');
    expect(text).toContain('SEK');
    expect(strip(text)).toContain('14503,00');   // summa exkl. moms
    expect(text).toContain('Summa utlägg exkl. moms');
    expect(text).toContain('Moms 25 % (vidarefakturering)');
    expect(strip(text)).toContain('3625,75');    // moms
    expect(strip(text)).toContain('18128,75');   // inkl. moms — facit ur faktura 24
    expect(text).toContain('bokförda verifikationer');
  });

  it('rad utan belopp/tid avvisas med begripligt fel', async () => {
    const inv = await newInvoice();
    const res = await api.post(`${co()}/actions/set_invoice_appendix`).set(auth()).send({
      invoice_id: inv.id, kind: 'expense',
      rows: [{ entry_date: '2026-07-01', description: 'Saknar belopp' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('bilagan ur systemets egen tidrapportering', () => {
  it('fakturerbar, ofakturerad tid blir bilaga och markeras som fakturerad', async () => {
    const proj = await api.post(`${co()}/actions/create_project`).set(auth()).send({
      name: 'ILT-uppdraget', customer_id: customerId, hourly_rate_ore: 110_000,
    });
    expect(proj.status, JSON.stringify(proj.body)).toBe(200);
    const projectId = proj.body.result.id;
    for (const [d, m, t] of [['2026-07-01', 180, 'Modellstart'], ['2026-07-02', 25, 'Körplan']] as const) {
      const r = await api.post(`${co()}/actions/log_time`).set(auth()).send({
        project_id: projectId, work_date: d, minutes: m, description: t,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }

    const inv = await newInvoice();
    const res = await api.post(`${co()}/actions/invoice_appendix_from_time_entries`).set(auth()).send({
      invoice_id: inv.id, project_id: projectId, from: '2026-07-01', to: '2026-07-31',
      title: 'Bilaga – tidsspecifikation juli 2026',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.total_minutes).toBe(205);
    expect(res.body.result.rows).toHaveLength(2);

    // Samma timmar kan inte faktureras igen.
    const again = await api.post(`${co()}/actions/invoice_appendix_from_time_entries`).set(auth()).send({
      invoice_id: (await newInvoice()).id, project_id: projectId, from: '2026-07-01', to: '2026-07-31',
    });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('no_time_entries');
  });
});
