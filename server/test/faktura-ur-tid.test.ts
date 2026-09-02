// PRD_TIDSRAPPORTERING §4 F6+F7 (story 2): faktura ur godkänd tid, atomärt.
//
// Julifelet (PRD §1) var att fakturan kunde existera UTAN att tidposterna
// stängdes. Proven nedan är det felet uttryckt baklänges: fakturan, bilagan och
// låsningen sker i ETT anrop, beloppet är summan av exakt de låsta posterna,
// och faller ett steg finns varken faktura eller låsta poster kvar. Dessutom
// den andra riktningen: raderas utkastet återöppnas tiden — annars vore
// raderingen en fälla där timmarna blev låsta till ingenting.
import type { PoolClient } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { pool } from '../src/db/pool.js';
import { setTenantContext } from '../src/db/tx.js';
import { createInvoiceFromTime } from '../src/services/invoiceFromTime.js';

const TAXA = 110_000; // 1 100,00 kr/h — Locollabs konsulttaxa

let user: TestUser;
let companyId: string;
let customerId: string;

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const co = () => `/api/companies/${companyId}`;

type Svar = { status: number; body: { result: Record<string, unknown>; error?: string } };

async function act(namn: string, kropp: Record<string, unknown>): Promise<Svar> {
  const res = await api.post(`${co()}/actions/${namn}`).set(auth()).send(kropp);
  return res as unknown as Svar;
}

async function nyttUppdrag(namn: string, taxa: number | null = TAXA): Promise<string> {
  const res = await act('create_project', {
    name: namn, customer_id: customerId, ...(taxa === null ? {} : { hourly_rate_ore: taxa }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function loggaTid(projectId: string, kropp: Record<string, unknown>): Promise<string> {
  const res = await act('log_time', { project_id: projectId, description: 'Arbete', ...kropp });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.id as string;
}

async function tidpost(id: string): Promise<Record<string, unknown>> {
  const res = await act('list_time_entries', {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const funnen = (res.body.result as unknown as Record<string, unknown>[]).find((r) => r.id === id);
  expect(funnen, `tidpost ${id} hittades inte`).toBeTruthy();
  return funnen!;
}

async function auditrader(action: string, entityId: string): Promise<Record<string, unknown>[]> {
  return withAdmin(async (admin) => (await admin.query(
    'SELECT details FROM audit_log WHERE company_id = $1 AND action = $2 AND entity_id = $3',
    [companyId, action, entityId],
  )).rows as Record<string, unknown>[]);
}

/** Timmar ur minuter som fakturaraden räknar dem: två decimaler. */
const timmar = (minuter: number) => Math.round((minuter / 60) * 100) / 100;

beforeAll(async () => {
  user = await registerUser('fakturaurtid');
  companyId = await createCompany(user.token, 'Locollabs AB');
  await createFiscalYear(companyId, auth(), { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' });
  const k = await api.post(`${co()}/customers`).set(auth()).send({ name: 'ILT Education AB' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  customerId = k.body.customer.id;
});

describe('create_invoice_from_time: ett anrop, en transaktion', () => {
  let projekt = '';
  let fakturaId = '';
  let undantagen = '';
  const period = { from: '2026-11-01', to: '2026-11-30' };

  it('fakturan, bilagan och låsningen sker tillsammans — och exclude-listan rörs inte', async () => {
    projekt = await nyttUppdrag('Fas 2A — Commercial Cockpit');
    const a = await loggaTid(projekt, { work_date: '2026-11-02', minutes: 120, description: 'Modellstart' });
    const b = await loggaTid(projekt, {
      work_date: '2026-11-03', minutes: 120, description: 'Körplan',
      billable_minutes: 90, adjustment_reason: 'Halva överdraget bärs av oss',
    });
    undantagen = await loggaTid(projekt, { work_date: '2026-11-04', minutes: 60, description: 'Kundmöte om nästa fas' });

    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt, ...period,
      invoice_date: '2026-11-30', due_date: '2026-12-30',
      our_reference: 'David Mancilla', reference: 'Jakob Skogholm',
      exclude_entry_ids: [undantagen],
      title: 'Bilaga – tidsspecifikation november 2026',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.time_entries).toBe(2);
    expect(res.body.result.billable_minutes).toBe(210); // 120 + 90 (de justerade)

    // Beloppet ÄR summan över exakt de låsta posterna: 210 debiterbara minuter.
    const faktura = res.body.result.invoice as Record<string, unknown>;
    fakturaId = faktura.id as string;
    const rader = faktura.lines as Record<string, unknown>[];
    expect(rader).toHaveLength(1); // en rad per taxa, och taxan är uppdragets
    expect(Number(rader[0]!.quantity)).toBe(timmar(210)); // 3,50 h
    expect(rader[0]!.unit_price_ore).toBe(TAXA);
    expect(rader[0]!.vat_rate).toBe(25);
    expect(rader[0]!.revenue_account).toBe(3001);
    expect(rader[0]!.description).toBe('Fas 2A — Commercial Cockpit');
    expect(faktura.subtotal_ore).toBe(Math.round(timmar(210) * TAXA)); // 385 000 ören
    expect(faktura.vat_ore).toBe(Math.round(timmar(210) * TAXA * 0.25));
    expect(faktura.total_ore).toBe(Math.round(timmar(210) * TAXA * 1.25));

    // Bilagan: en rad per tidpost, med de DEBITERBARA minuterna.
    const bilaga = await act('get_invoice_appendix', { invoice_id: fakturaId });
    expect(bilaga.body.result.kind).toBe('time');
    expect(bilaga.body.result.total_minutes).toBe(210);
    expect(bilaga.body.result.rows).toHaveLength(2);
    expect(bilaga.body.result.title).toBe('Bilaga – tidsspecifikation november 2026');

    // Posterna är låsta till fakturan — den undantagna är helt orörd.
    for (const id of [a, b]) {
      const r = await tidpost(id);
      expect(r.status).toBe('fakturerad');
      expect(r.invoice_id).toBe(fakturaId);
    }
    const kvar = await tidpost(undantagen);
    expect(kvar.status).toBe('godkand');
    expect(kvar.invoice_id).toBeNull();

    // Uppdraget står på fakturahuvudet (0060) och skapandet finns i auditloggen.
    const rad = await withAdmin(async (admin) => (await admin.query<{ project_id: string | null }>(
      'SELECT project_id FROM invoices WHERE id = $1', [fakturaId])).rows[0]);
    expect(rad?.project_id).toBe(projekt);
    const audit = await auditrader('invoice.created_from_time', fakturaId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ entries: 2, billable_minutes: 210, excluded_entries: 1 });
  });

  it('samma anrop en gång till hittar ingen tid (400 no_time_entries)', async () => {
    // Exakt samma anrop som lyckades: allt utom den undantagna posten är låst,
    // och den är fortfarande undantagen. Samma timmar kan inte faktureras igen.
    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt, ...period, invoice_date: '2026-11-30',
      exclude_entry_ids: [undantagen],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('no_time_entries');
    expect((await tidpost(undantagen)).status).toBe('godkand');

    // Utan undantaget finns däremot den ena posten kvar att fakturera — den är
    // sparad, inte förbrukad.
    const med = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt, ...period, invoice_date: '2026-11-30',
    });
    expect(med.status, JSON.stringify(med.body)).toBe(200);
    expect(med.body.result.time_entries).toBe(1);
    expect(med.body.result.billable_minutes).toBe(60);
    expect((await tidpost(undantagen)).status).toBe('fakturerad');
  });

  it('en period utan godkänd tid ger 400 no_time_entries — aldrig en tom faktura', async () => {
    const fore = (await act('list_invoices', {})).body.result as unknown as { id: string }[];
    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-04-01', to: '2026-04-30', invoice_date: '2026-04-30',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('no_time_entries');
    const efter = (await act('list_invoices', {})).body.result as unknown as { id: string }[];
    expect(efter.map((f) => f.id)).toEqual(fore.map((f) => f.id));
    expect(fore.some((f) => f.id === fakturaId)).toBe(true);
  });

  it("'per_avtalsdel' ger kategoribilagan utan datum (story 3)", async () => {
    // Uppdraget har inga avtalsdelar: bilagan blir ändå en KATEGORIBILAGA utan
    // datum — det är formen som väljs, inte klassificeringen. Tid utan
    // avtalsdel står under uppdragets namn (se avtalsdelar.test.ts för hur
    // 'Övrigt' skrivs ut när det finns delar att stå bredvid).
    const projektB = await nyttUppdrag('Fas 3 — avtalsdelar');
    await loggaTid(projektB, { work_date: '2026-11-05', minutes: 60 });
    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projektB,
      from: '2026-11-01', to: '2026-11-30', invoice_date: '2026-11-30',
      appendix_layout: 'per_avtalsdel',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bilaga = await act('get_invoice_appendix', {
      invoice_id: (res.body.result.invoice as { id: string }).id,
    });
    expect(bilaga.body.result.kind).toBe('category');
    const rader = bilaga.body.result.rows as Record<string, unknown>[];
    expect(rader).toHaveLength(1);
    expect(rader[0]).toMatchObject({ entry_date: null, description: 'Fas 3 — avtalsdelar', minutes: 60 });
  });

  it('poster med olika taxa får varsin rad — aldrig ett snitt', async () => {
    const projektC = await nyttUppdrag('Fas 2B — blandad taxa');
    await loggaTid(projektC, { work_date: '2026-12-01', minutes: 120, description: 'Uppdragets taxa' });
    await loggaTid(projektC, {
      work_date: '2026-12-02', minutes: 60, description: 'Rabatterad förstudie', hourly_rate_ore: 90_000,
    });
    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projektC,
      from: '2026-12-01', to: '2026-12-31', invoice_date: '2026-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rader = (res.body.result.invoice as { lines: Record<string, unknown>[] }).lines;
    expect(rader).toHaveLength(2);
    expect(rader.map((r) => r.unit_price_ore)).toEqual([90_000, TAXA]);
    expect(rader.map((r) => Number(r.quantity))).toEqual([timmar(60), timmar(120)]);
  });

  it('en post utan taxa på både post och uppdrag ger 400 — aldrig ett tyst nollpris', async () => {
    const utanTaxa = await nyttUppdrag('Uppdrag utan taxa', null);
    const post = await loggaTid(utanTaxa, { work_date: '2026-12-05', minutes: 90, description: 'Oprissatt' });
    const res = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: utanTaxa,
      from: '2026-12-01', to: '2026-12-31', invoice_date: '2026-12-31',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('missing_hourly_rate');
    // Ingenting skrevs: posten är kvar som godkänd och ofakturerad.
    const r = await tidpost(post);
    expect(r.status).toBe('godkand');
    expect(r.invoice_id).toBeNull();
  });
});

describe('atomicitet: faller ett steg finns varken faktura eller låsta poster', () => {
  /**
   * En klient som får bilagesteget att falla. Provet måste angripa mitten av
   * kedjan — fakturan och dess rader är redan skrivna när bilagan skrivs, och
   * det är precis det läget julifelet bestod av: faktura utan stängd tid.
   */
  function klientSomFallerPaBilagan(riktig: PoolClient): PoolClient {
    return new Proxy(riktig, {
      get(mal, prop) {
        if (prop === 'query') {
          return (text: unknown, params?: unknown) => {
            if (typeof text === 'string' && text.includes('INSERT INTO invoice_appendix_rows')) {
              return Promise.reject(new Error('framprovocerat fel i bilagesteget'));
            }
            return (mal.query as unknown as (t: unknown, p?: unknown) => Promise<unknown>).call(mal, text, params);
          };
        }
        const varde = Reflect.get(mal, prop) as unknown;
        return typeof varde === 'function' ? (varde as () => unknown).bind(mal) : varde;
      },
    }) as PoolClient;
  }

  it('ett fel i bilagesteget lämnar varken faktura, bilaga eller låst tid', async () => {
    const projekt = await nyttUppdrag('Fas 4 — atomicitet');
    const post = await loggaTid(projekt, { work_date: '2026-10-05', minutes: 180, description: 'Rapportmodell' });
    const fore = (await act('list_invoices', {})).body.result as unknown as { id: string }[];

    const klient = await pool.connect();
    try {
      await klient.query('BEGIN');
      await setTenantContext(klient, user.userId, companyId);
      await expect(createInvoiceFromTime(klientSomFallerPaBilagan(klient), companyId, user.userId, {
        customerId, projectId: projekt, from: '2026-10-01', to: '2026-10-31', invoiceDate: '2026-10-31',
      })).rejects.toThrow('framprovocerat fel i bilagesteget');
      await klient.query('ROLLBACK');
    } finally {
      klient.release();
    }

    const efter = (await act('list_invoices', {})).body.result as unknown as { id: string }[];
    expect(efter.map((f) => f.id)).toEqual(fore.map((f) => f.id)); // ingen faktura skapades
    const r = await tidpost(post);
    expect(r.status).toBe('godkand');
    expect(r.invoice_id).toBeNull();
    // Inte heller bilagan eller auditspåret överlevde — allt låg i samma transaktion.
    const spar = await withAdmin(async (admin) => (await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE company_id = $1 AND action = 'invoice.created_from_time'
          AND details->>'project_id' = $2`, [companyId, projekt])).rows[0]);
    expect(spar?.n).toBe(0);
  });
});

describe('delete_draft_invoice återöppnar tiden', () => {
  it('posterna får tillbaka godkand/justerad, tappar fakturan och auditloggas', async () => {
    const projekt = await nyttUppdrag('Fas 5 — utkast som ångras');
    const hel = await loggaTid(projekt, { work_date: '2026-09-07', minutes: 120, description: 'Hel dag' });
    const justerad = await loggaTid(projekt, {
      work_date: '2026-09-08', minutes: 120, description: 'Halv debitering',
      billable_minutes: 60, adjustment_reason: 'Resterande tid var eget lärande',
    });

    const skapad = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-09-01', to: '2026-09-30', invoice_date: '2026-09-30',
    });
    expect(skapad.status, JSON.stringify(skapad.body)).toBe(200);
    const fakturaId = (skapad.body.result.invoice as { id: string }).id;
    expect((await tidpost(hel)).status).toBe('fakturerad');

    const raderad = await act('delete_draft_invoice', { invoice_id: fakturaId });
    expect(raderad.status, JSON.stringify(raderad.body)).toBe(200);
    expect(raderad.body.result.reopened_time_entries).toBe(2);

    // Statusen härleds ur raden själv: lika minuter → godkand, olika → justerad.
    const helEfter = await tidpost(hel);
    expect(helEfter.status).toBe('godkand');
    expect(helEfter.invoice_id).toBeNull();
    const justeradEfter = await tidpost(justerad);
    expect(justeradEfter.status).toBe('justerad');
    expect(justeradEfter.invoice_id).toBeNull();
    expect(justeradEfter.billable_minutes).toBe(60);

    const speglingar = await withAdmin(async (admin) => (await admin.query<{ invoiced: boolean; billable: boolean }>(
      'SELECT invoiced, billable FROM time_entries WHERE id = ANY($1::uuid[])', [[hel, justerad]])).rows);
    expect(speglingar).toHaveLength(2);
    for (const s of speglingar) expect(s).toEqual({ invoiced: false, billable: true });

    const audit = await auditrader('invoice.time_entries_reopened', fakturaId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ time_entries: 2 });

    // Och tiden går att fakturera igen — det är hela poängen med återöppningen.
    const omtag = await act('create_invoice_from_time', {
      customer_id: customerId, project_id: projekt,
      from: '2026-09-01', to: '2026-09-30', invoice_date: '2026-09-30',
    });
    expect(omtag.status, JSON.stringify(omtag.body)).toBe(200);
    expect(omtag.body.result.billable_minutes).toBe(180);
  });
});

describe('set_invoice_appendix kind time kräver ett uttalat undantag', () => {
  async function utkast(): Promise<string> {
    const res = await act('create_invoice', {
      customer_id: customerId, invoice_date: '2026-11-30',
      lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: TAXA, vat_rate: 25 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.result.id as string;
  }

  const rader = [{ entry_date: '2026-11-10', description: 'Handskriven rad', minutes: 60 }];

  it('utan bypass hänvisas anroparen till create_invoice_from_time (409)', async () => {
    const res = await act('set_invoice_appendix', { invoice_id: await utkast(), kind: 'time', rows: rader });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('use_create_invoice_from_time');
  });

  it('bypass utan skäl avvisas (400) — undantaget ska gå att läsa i efterhand', async () => {
    const res = await act('set_invoice_appendix', {
      invoice_id: await utkast(), kind: 'time', bypass_time_entries: true, rows: rader,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error).toBe('bypass_reason_required');
  });

  it('bypass med skäl går igenom och skälet hamnar i auditloggen', async () => {
    const id = await utkast();
    const res = await act('set_invoice_appendix', {
      invoice_id: id, kind: 'time', bypass_time_entries: true,
      reason: 'Underlag från tiden före tidrapporteringen', rows: rader,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.total_minutes).toBe(60);
    const audit = await auditrader('invoice.appendix_time_bypass', id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ reason: 'Underlag från tiden före tidrapporteringen', rows: 1 });
  });

  it("utläggsbilagan är oförändrad — den har ingen tidrapportering att gå förbi", async () => {
    const res = await act('set_invoice_appendix', {
      invoice_id: await utkast(), kind: 'expense',
      rows: [{ entry_date: '2026-11-10', description: 'Tågbiljett', amount_ore: 89_500 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.result.total_amount_ore).toBe(89_500);
  });
});

describe('PDF:en skriver aldrig ut ett nummer en annan fakturas PDF redan bär', () => {
  async function pdf(invoiceId: string): Promise<{ status: number; error?: string }> {
    const res = await api.post(`${co()}/invoices/${invoiceId}/pdf`).set(auth()).buffer()
      .parse((r, cb) => { const c: Buffer[] = []; r.on('data', (x: Buffer) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    const kropp = Buffer.isBuffer(res.body) && res.status !== 200
      ? JSON.parse(res.body.toString('utf8')) as { error?: string } : {};
    return { status: res.status, error: kropp.error };
  }

  it('en andra faktura med samma effective_invoice_number vägras (409)', async () => {
    const skapa = async () => {
      const res = await act('create_invoice', {
        customer_id: customerId, invoice_date: '2026-11-30',
        lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: TAXA, vat_rate: 25 }],
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.result as { id: string; effective_invoice_number: number };
    };
    const a = await skapa();
    const b = await skapa();
    expect((await pdf(a.id)).status).toBe(200);

    // Den unika nyckeln i 0046 är förstahandsgarantin och gör läget omöjligt att
    // nå genom systemet. Provet river den tillfälligt för att kunna pröva ANDRA
    // försvarslinjen — en kontroll som aldrig körs mot det den finns för är
    // inte prövad, bara skriven.
    await withAdmin(async (admin) => {
      await admin.query('ALTER TABLE invoices DROP CONSTRAINT invoices_effective_number_uk');
      await admin.query('UPDATE invoices SET external_invoice_number = $2 WHERE id = $1',
        [b.id, a.effective_invoice_number]);
    });
    try {
      const res = await pdf(b.id);
      expect(res.status).toBe(409);
      expect(res.error).toBe('pdf_number_collision');
      // Och a:s PDF ligger kvar orörd — vägran skriver ingenting.
      const filer = await withAdmin(async (admin) => (await admin.query<{ pdf_file_id: string | null }>(
        'SELECT pdf_file_id FROM invoices WHERE id = ANY($1::uuid[]) ORDER BY invoice_number', [[a.id, b.id]])).rows);
      expect(filer[0]!.pdf_file_id).toBeTruthy();
      expect(filer[1]!.pdf_file_id).toBeNull();
    } finally {
      await withAdmin(async (admin) => {
        await admin.query('UPDATE invoices SET external_invoice_number = NULL WHERE id = $1', [b.id]);
        await admin.query(`ALTER TABLE invoices ADD CONSTRAINT invoices_effective_number_uk
          UNIQUE (company_id, effective_invoice_number) DEFERRABLE INITIALLY IMMEDIATE`);
      });
    }
  });
});
