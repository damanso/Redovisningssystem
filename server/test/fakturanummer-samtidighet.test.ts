// FR-6, LOC-263: två fakturor kan aldrig visa samma nummer.
//
// Risken: två fakturor får aldrig visa samma nummer, inte heller när räknaren
// flyttas eller kundens nummer tilldelas medan en faktura skapas. Ett
// godkännande som skulle bryta serien rullas tillbaka, står kvar som väntande
// och syns som notis (FR-6, LOC-263).
//
// Lagren: åtgärderna och godkännandet över REST, kapplöpningen mot räknarraden
// i databasen och Att göra i vyn.
import { readFile } from 'node:fs/promises';
import supertest from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, createCompany, createFiscalYear, registerUser, withAdmin, type TestUser } from './helpers.js';
import { getAction } from '../src/actions/registry.js';

type Response = supertest.Response;

const PASSWORD = 'mycket-hemligt-losen-123';
const FISCAL_YEAR = { label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' };
const INVOICE_BODY = {
  invoice_date: '2026-07-31', due_date: '2026-08-30',
  lines: [{ description: 'Konsulttid', quantity: 1, unit: 'h', unit_price_ore: 110_000, vat_rate: 25 }],
};

let user: TestUser;
let companyId: string;
let customerId: string;
let agentToken: string;
let viewClient: ReturnType<typeof supertest.agent>;
let firstInvoice: { id: string; number: number };

const auth = () => ({ Authorization: `Bearer ${user.token}` });
const agentAuth = () => ({ Authorization: `Bearer ${agentToken}` });
const co = () => `/api/companies/${companyId}`;

async function requestAction(name: string, body: Record<string, unknown>, headers = auth()): Promise<string> {
  const res = await api.post(`${co()}/actions/${name}`).set(headers).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  expect(res.body.status).toBe('pending_approval');
  return res.body.approval.id as string;
}

async function approve(approvalId: string): Promise<Response> {
  return await api.post(`${co()}/approvals/${approvalId}/approve`).set(auth()).send({});
}

async function createInvoiceRequest(): Promise<Response> {
  return await api.post(`${co()}/actions/create_invoice`).set(auth()).send({ customer_id: customerId, ...INVOICE_BODY });
}

async function newInvoice(): Promise<{ id: string; number: number }> {
  const res = await createInvoiceRequest();
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: res.body.result.id as string, number: res.body.result.invoice_number as number };
}

async function nextNumber(): Promise<number> {
  const res = await api.post(`${co()}/actions/get_invoice_number_series`).set(auth()).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.next_invoice_number as number;
}

async function externalNumber(invoiceId: string): Promise<number | null> {
  const res = await api.post(`${co()}/actions/get_invoice`).set(auth()).send({ invoice_id: invoiceId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.result.external_invoice_number as number | null;
}

async function isPending(approvalId: string): Promise<boolean> {
  const res = await api.get(`${co()}/approvals?status=pending`).set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.approvals as { id: string }[]).some((a) => a.id === approvalId);
}

async function maxAuditId(): Promise<number> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ id: number | null }>('SELECT max(id) AS id FROM audit_log WHERE company_id = $1', [companyId]);
    return r.rows[0]?.id ?? 0;
  });
}

async function auditSince(afterId: number, action: string): Promise<{ id: number; details: Record<string, unknown> }[]> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ id: number; details: Record<string, unknown> }>(
      'SELECT id, details FROM audit_log WHERE company_id = $1 AND action = $2 AND id > $3 ORDER BY id',
      [companyId, action, afterId],
    );
    return r.rows;
  });
}

async function duplicateNumbers(): Promise<number[]> {
  return withAdmin(async (admin) => {
    const r = await admin.query<{ nr: number }>(
      `SELECT effective_invoice_number AS nr FROM invoices
        WHERE company_id = $1 GROUP BY effective_invoice_number HAVING count(*) > 1`,
      [companyId],
    );
    return r.rows.map((row) => row.nr);
  });
}

/**
 * Väntar tills minst n andra anslutningar väntar på ett lås — annars prövas
 * bara ordningsföljden. Frågar från en egen anslutning utan transaktion:
 * i en öppen transaktion är pg_stat_activity en ögonblicksbild.
 */
async function waitForLockWaits(n: number): Promise<void> {
  await withAdmin(async (admin) => {
    for (let i = 0; i < 200; i++) {
      const r = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
      );
      if ((r.rows[0]?.n ?? 0) >= n) return;
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('ingen transaktion blockerades — kapplöpningen uppstod aldrig');
  });
}

/**
 * Hållaren tar räknarraden, och anropen startas medan den hålls. Med `staged`
 * startas de ett i taget, och varje start väntar tills anropet köar på låset:
 * Postgres släpper väntande radlås i köordning, så den först startade går först.
 * Svaren returneras i startordning.
 */
async function raceOnCounter(starters: (() => Promise<Response>)[], staged: boolean): Promise<Response[]> {
  return withAdmin(async (holder) => {
    const started: Promise<Response>[] = [];
    try {
      await holder.query('BEGIN');
      const held = await holder.query(
        `SELECT 1 FROM number_sequences WHERE company_id = $1 AND kind = 'invoice' FOR UPDATE`,
        [companyId],
      );
      if (!held.rows[0]) throw new Error('räknarraden saknas — kapplöpningen kan inte tvingas fram');
      for (const start of starters) {
        started.push(start());
        if (staged) await waitForLockWaits(started.length);
      }
      if (!staged) await waitForLockWaits(started.length);
      await holder.query('ROLLBACK');
      return await Promise.all(started);
    } finally {
      // Släpp låset först så de väntande anropen kan gå klart; en anslutning
      // som lämnas tillbaka mitt i en fråga förgiftar nästa fall.
      await holder.query('ROLLBACK').catch(() => undefined);
      await Promise.allSettled(started);
    }
  });
}

/** Godkänner i vyn och returnerar svaret och sidan bakom omdirigeringen. */
async function approveInView(approvalId: string): Promise<{ location: string; page: Response }> {
  const res = await viewClient.post(`/app/c/${companyId}/approvals/${approvalId}/approve`).type('form').send({});
  const location = String(res.headers.location ?? '');
  expect([302, 303], `${res.status} ${location}`).toContain(res.status);
  expect(location, `${res.status} ${location}`).toContain('fel=');
  const page = await viewClient.get(location);
  expect(page.status, page.text.slice(0, 500)).toBe(200);
  return { location, page };
}

beforeAll(async () => {
  user = await registerUser('fakturanummer');
  companyId = await createCompany(user.token, 'Fakturanummer AB');
  await createFiscalYear(companyId, auth(), FISCAL_YEAR);
  const customer = await api.post(`${co()}/customers`).set(auth()).send({ name: 'Nummerkund AB' });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  customerId = customer.body.customer.id as string;

  const token = await api.post(`${co()}/agent-tokens`).set(auth()).send({ name: 'Nummeragent' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  agentToken = token.body.token as string;

  viewClient = supertest.agent(app);
  await viewClient.post('/app/login').type('form').send({ email: user.email, password: PASSWORD });
  // Utan giltig session omdirigerar vyn till inloggningen, och vyns
  // godkännande skulle då ge en omdirigering utan `fel=`.
  const approvals = await viewClient.get(`/app/c/${companyId}/approvals`);
  expect(approvals.status, approvals.headers.location ?? '').toBe(200);

  // Den första fakturan skapar räknarraden som hållaren låser.
  firstInvoice = await newInvoice();
});

describe('regressionen: agenten köas och registret', () => {
  it('R1 agentens båda förslag ger 202, köas och ändrar ingenting före godkännandet', async () => {
    const start = await nextNumber();
    const series = await requestAction('set_invoice_number_series', { next_invoice_number: start + 100 }, agentAuth());
    const external = await requestAction('set_external_invoice_numbers', {
      assignments: [{ invoice_id: firstInvoice.id, external_invoice_number: start + 200 }],
    }, agentAuth());
    expect(await isPending(series)).toBe(true);
    expect(await isPending(external)).toBe(true);
    expect(await nextNumber()).toBe(start);
    expect(await externalNumber(firstInvoice.id)).toBeNull();
    expect(getAction('set_invoice_number_series')?.sensitivity).toBe('sensitive');
    expect(getAction('set_external_invoice_numbers')?.sensitivity).toBe('sensitive');
  });
});

describe('räknarflytten genom godkännandet', () => {
  it('G1 två samtidiga godkännanden flyttar räknaren till det högre, aldrig bakåt, med en flytt per utfört godkännande', async () => {
    const start = await nextNumber();
    const baseline = await maxAuditId();
    const low = await requestAction('set_invoice_number_series', { next_invoice_number: start + 10 });
    const high = await requestAction('set_invoice_number_series', { next_invoice_number: start + 20 });

    const [lowRes, highRes] = await raceOnCounter([() => approve(low), () => approve(high)], false);
    if (!lowRes || !highRes) throw new Error('kapplöpningen gav inte två svar');
    // Det högre värdet ligger över allt som någon väg skriver och kan aldrig avvisas.
    expect(highRes.status, JSON.stringify(highRes.body)).toBe(200);
    expect([200, 409], JSON.stringify(lowRes.body)).toContain(lowRes.status);
    if (lowRes.status === 409) {
      expect(lowRes.body.error).toBe('series_cannot_move_backwards');
      expect(await isPending(low)).toBe(true);
    }
    expect(await nextNumber()).toBe(start + 20);

    const okCount = [lowRes, highRes].filter((r) => r.status === 200).length;
    const moves = await auditSince(baseline, 'invoice.number_series_set');
    expect(moves, JSON.stringify(moves)).toHaveLength(okCount);
    let from = start;
    for (const move of moves) {
      expect(move.details.from_next_value, JSON.stringify(moves)).toBe(from);
      expect(move.details.to_next_value as number, JSON.stringify(moves)).toBeGreaterThan(from);
      from = move.details.to_next_value as number;
    }
    expect(from).toBe(start + 20);
    expect(await auditSince(baseline, 'action.approved_executed')).toHaveLength(okCount);
    expect(await duplicateNumbers()).toEqual([]);
  });

  it('G2 det högre godkänns först; det lägre avvisas med 409, står kvar och syns som notis på Att göra', async () => {
    const start = await nextNumber();
    const baseline = await maxAuditId();
    const low = await requestAction('set_invoice_number_series', { next_invoice_number: start + 10 });
    const high = await requestAction('set_invoice_number_series', { next_invoice_number: start + 20 });

    const [highRes, lowRes] = await raceOnCounter([() => approve(high), () => approve(low)], true);
    if (!lowRes || !highRes) throw new Error('kapplöpningen gav inte två svar');
    expect(highRes.status, JSON.stringify(highRes.body)).toBe(200);
    expect(highRes.body.result.next_invoice_number).toBe(start + 20);
    expect(lowRes.status, JSON.stringify(lowRes.body)).toBe(409);
    expect(lowRes.body.error).toBe('series_cannot_move_backwards');

    expect(await isPending(low)).toBe(true);
    expect(await nextNumber()).toBe(start + 20);
    const moves = await auditSince(baseline, 'invoice.number_series_set');
    expect(moves, JSON.stringify(moves)).toHaveLength(1);
    expect(moves[0]?.details).toMatchObject({ from_next_value: start, to_next_value: start + 20 });

    const { page } = await approveInView(low);
    expect(page.text, page.text.slice(0, 500)).toContain(
      `<p class="notice">Kunde inte utföras: räknaren står på ${start + 20} och kan bara flyttas framåt (bokföringslagen: inga dubbla fakturanummer)</p>`,
    );
    expect(await isPending(low)).toBe(true);
    expect(await nextNumber()).toBe(start + 20);
    expect(await auditSince(baseline, 'invoice.number_series_set')).toHaveLength(1);
  });

  it('G3 en faktura som väntar bakom flytten får räknarens nya värde', async () => {
    const start = await nextNumber();
    const target = start + 5;
    const move = await requestAction('set_invoice_number_series', { next_invoice_number: target });

    const [moveRes, invoiceRes] = await raceOnCounter([() => approve(move), () => createInvoiceRequest()], true);
    if (!moveRes || !invoiceRes) throw new Error('kapplöpningen gav inte två svar');
    expect(moveRes.status, JSON.stringify(moveRes.body)).toBe(200);
    expect(moveRes.body.result.next_invoice_number).toBe(target);
    expect(invoiceRes.status, JSON.stringify(invoiceRes.body)).toBe(200);
    expect(invoiceRes.body.result.invoice_number, 'fakturan fick ett nummer under räknarens nya värde').toBe(target);
    expect(await nextNumber()).toBe(target + 1);
    expect(await duplicateNumbers()).toEqual([]);
  });
});

describe('kundens nummer och bolagsgränsen', () => {
  it('B1 ett nummer som bara finns i ett annat av användarens bolag räknas inte som upptaget', async () => {
    const neighbourId = await createCompany(user.token, 'Grannbolaget AB');
    const neighbour = `/api/companies/${neighbourId}`;
    await createFiscalYear(neighbourId, auth(), FISCAL_YEAR);
    const customer = await api.post(`${neighbour}/customers`).set(auth()).send({ name: 'Grannkund AB' });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const own = await newInvoice();

    const created = await api.post(`${neighbour}/actions/create_invoice`).set(auth())
      .send({ customer_id: customer.body.customer.id, ...INVOICE_BODY });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.result.invoice_number).toBe(1);
    expect(own.number).toBeGreaterThan(1);
    const neighbourInvoice = created.body.result.id as string;

    const req = await api.post(`${neighbour}/actions/set_external_invoice_numbers`).set(auth()).send({
      assignments: [{ invoice_id: neighbourInvoice, external_invoice_number: own.number }],
    });
    expect(req.status, JSON.stringify(req.body)).toBe(202);
    const ok = await api.post(`${neighbour}/approvals/${req.body.approval.id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const got = await api.post(`${neighbour}/actions/get_invoice`).set(auth()).send({ invoice_id: neighbourInvoice });
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body.result.external_invoice_number).toBe(own.number);

    expect(await externalNumber(own.id)).toBeNull();
    expect(await duplicateNumbers()).toEqual([]);
  });
});

describe('ett upptaget kundnummer avvisas före första skrivningen', () => {
  let b: { id: string; number: number };
  let taken: number;
  let proposal: string;

  it('E1 kundnumret på en annan faktura ger 409 number_already_in_use och ändrar ingenting', async () => {
    const a = await newInvoice();
    b = await newInvoice();
    taken = a.number;
    const start = await nextNumber();
    const baseline = await maxAuditId();
    proposal = await requestAction('set_external_invoice_numbers', {
      assignments: [{ invoice_id: b.id, external_invoice_number: taken }],
    });

    const res = await approve(proposal);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('number_already_in_use');
    expect(await isPending(proposal)).toBe(true);
    expect(await externalNumber(b.id)).toBeNull();
    expect(await nextNumber()).toBe(start);
    expect(await auditSince(baseline, 'invoice.external_number_set')).toEqual([]);
  });

  it('V1 samma förslag godkänt i vyn syns som notis på Att göra och står kvar', async () => {
    const { page } = await approveInView(proposal);
    expect(page.text, page.text.slice(0, 500)).toContain(
      `<p class="notice">Kunde inte utföras: fakturanummer ${taken} visas redan på en annan faktura — avvisa förslaget och ange ett ledigt nummer</p>`,
    );
    expect(await isPending(proposal)).toBe(true);
    expect(await externalNumber(b.id)).toBeNull();
  });

  it('G4 en faktura som skapas först tar numret; godkännandet som väntade avvisas med 409', async () => {
    const older = await newInvoice();
    const start = await nextNumber();
    const assign = await requestAction('set_external_invoice_numbers', {
      assignments: [{ invoice_id: older.id, external_invoice_number: start }],
    });

    const [invoiceRes, assignRes] = await raceOnCounter([() => createInvoiceRequest(), () => approve(assign)], true);
    if (!invoiceRes || !assignRes) throw new Error('kapplöpningen gav inte två svar');
    expect(invoiceRes.status, JSON.stringify(invoiceRes.body)).toBe(200);
    expect(invoiceRes.body.result.invoice_number).toBe(start);
    expect(assignRes.status, JSON.stringify(assignRes.body)).toBe(409);
    expect(assignRes.body.error).toBe('number_already_in_use');
    expect(await isPending(assign)).toBe(true);

    expect(await externalNumber(older.id)).toBeNull();
    expect(await nextNumber()).toBe(start + 1);
    expect(await duplicateNumbers()).toEqual([]);
  });
});

describe('dokumentationen', () => {
  /** Avsnittet från rubriken till nästa `### `- eller `## `-rubrik; tom text om det saknas. */
  function section(text: string, heading: string): string {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith(heading));
    if (start < 0) return '';
    const end = lines.findIndex((l, i) => i > start && (l.startsWith('### ') || l.startsWith('## ')));
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  }

  it('M1 MCP_ACTIONS beskriver felkoderna och notisen under Fakturaserien och bilagan (LOC-263)', async () => {
    const md = await readFile(new URL('../../docs/MCP_ACTIONS.md', import.meta.url), 'utf8');
    const heading = '### Fakturaserien och bilagan (LOC-263)';
    const text = section(md, heading);
    expect(text).not.toBe('');
    expect(text).toContain('series_cannot_move_backwards');
    expect(text).toContain('number_already_in_use');
    expect(text).toContain('409');
    expect(text).toContain('Att göra');
    // Negativ kontroll: ett dokument utan avsnittet ger tom text.
    expect(section('### Annat\ntext\n', heading)).toBe('');
  });
});
