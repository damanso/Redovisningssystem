// Story 1.11, FR-27: bevakar att kortbytet i Story 1.1 inte öppnar en väg
// förbi människans beslut. Prövar åtgärdsrutten, MCP som barnprocess, REST:s
// godkänn/avvisa, direktanropen i execute.ts och Att göra i webbvyn.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveAction, rejectApproval } from '../src/actions/execute.js';
import { actionManifest } from '../src/actions/registry.js';
import { app, api, createCompany, createFiscalYear, registerUser, withAdmin } from './helpers.js';

async function nyttBolag(prefix: string) {
  const owner = await registerUser(`beslut-${prefix}`);
  const companyId = await createCompany(owner.token, `Beslutsprov ${prefix} AB`);
  const fiscalYear = await createFiscalYear(companyId, { Authorization: `Bearer ${owner.token}` }, {
    label: '2025', start_date: '2025-01-01', end_date: '2025-12-31',
  });
  const token = await api.post(`/api/companies/${companyId}/agent-tokens`)
    .set('Authorization', `Bearer ${owner.token}`).send({ name: 'Cowork' });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  return { owner, companyId, fiscalYear, agentToken: token.body.token as string };
}
type Bolag = Awaited<ReturnType<typeof nyttBolag>>;
const co = (b: Bolag) => `/api/companies/${b.companyId}`;
const attGora = (b: Bolag) => `/app/c/${b.companyId}/approvals`;

async function nyFaktura(b: Bolag): Promise<string> {
  const h = { Authorization: `Bearer ${b.owner.token}` };
  const customer = await api.post(`${co(b)}/customers`).set(h).send({ name: 'Fakturakund AB' });
  expect(customer.status, JSON.stringify(customer.body)).toBe(201);
  const invoice = await api.post(`${co(b)}/invoices`).set(h).send({
    customer_id: customer.body.customer.id, invoice_date: '2025-06-01',
    lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100_000, vat_rate: 25 }],
  });
  expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
  return invoice.body.invoice.id;
}

async function koaSomAgent(b: Bolag, invoiceId: string): Promise<string> {
  const res = await api.post(`${co(b)}/actions/book_invoice`)
    .set('Authorization', `Bearer ${b.agentToken}`)
    .send({ invoice_id: invoiceId, fiscal_year_id: b.fiscalYear.id });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.approval.id;
}

async function loggaIn(b: Bolag) {
  const session = supertest.agent(app);
  const res = await session.post('/app/login').type('form')
    .send({ email: b.owner.email, password: 'mycket-hemligt-losen-123' });
  expect(res.status, JSON.stringify(res.body)).toBe(302);
  return session;
}

async function tillstand(b: Bolag, approvalId: string, invoiceId: string) {
  return withAdmin(async (c) => {
    const approval = await c.query<{ status: string }>(
      'SELECT status FROM action_approvals WHERE id = $1', [approvalId]);
    const vouchers = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM vouchers WHERE company_id = $1', [b.companyId]);
    const invoice = await c.query<{ voucher_id: string | null }>(
      'SELECT voucher_id FROM invoices WHERE id = $1', [invoiceId]);
    const audit = await c.query<{ action: string }>(
      "SELECT action FROM audit_log WHERE company_id = $1 AND entity_type = 'approval' AND entity_id = $2 ORDER BY id",
      [b.companyId, String(approvalId)]);
    expect(approval.rows).toHaveLength(1);
    expect(invoice.rows).toHaveLength(1);
    return {
      status: approval.rows[0]!.status, vouchers: vouchers.rows[0]!.n,
      voucherId: invoice.rows[0]!.voucher_id, audit: audit.rows.map((r) => r.action),
    };
  });
}

function kvittorader(html: string): string[] {
  const efterRubriken = html.split('Nyss avgjort</h2>')[1] ?? '';
  return [...efterRubriken.matchAll(/<li class="kvitto">([\s\S]*?)<\/li>/g)]
    .map((m) => m[1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

// Samma minimala, nyradsavgränsade JSON-RPC-klient som i mcp.test.ts.
class McpClient {
  private buf = '';
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private id = 0;
  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        }
      }
    });
  }
  notify(method: string): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }
  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout på ${method}`)), 10_000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
}

function verktygsavvikelse(verktygsnamn: string[], manifestnamn: string[]) {
  const vantat = new Set([...manifestnamn, 'list_pending_approvals', 'self_check']);
  const faktiskt = new Set(verktygsnamn);
  return {
    extra: [...faktiskt].filter((n) => !vantat.has(n)),
    saknas: [...vantat].filter((n) => !faktiskt.has(n)),
  };
}

type Verktygssvar = { content: { type: string; text: string }[]; isError?: boolean };

describe('Kön från agentens sida', () => {
  let b: Bolag;
  let server: ReturnType<typeof app.listen> | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let mcp: McpClient;
  beforeAll(async () => {
    b = await nyttBolag('mcp');
    server = app.listen(0);
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, REDOVISNING_API_URL: `http://127.0.0.1:${port}`,
        REDOVISNING_AGENT_TOKEN: b.agentToken, REDOVISNING_COMPANY_ID: b.companyId },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => stderr.push(d));
    child.on('error', (e) => { throw new Error(`kunde inte starta MCP-servern: ${e.message}`); });
    child.on('exit', (code) => { if (code) throw new Error(`MCP-servern avslutades (${code}): ${stderr.join('')}`); });
    mcp = new McpClient(child);
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'beslutsprov', version: '0' } });
    mcp.notify('notifications/initialized');
  }, 120_000);
  afterAll(async () => {
    child?.kill();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it('B1.5 mängdkontrollen fäller ett planterat godkännandeverktyg och ett saknat verktyg', () => {
    const manifest = actionManifest().map((a) => a.name);
    const planterat = [...manifest, 'list_pending_approvals', 'approve_pending_approval'];
    expect(verktygsavvikelse(planterat, manifest)).toEqual({
      extra: ['approve_pending_approval'], saknas: ['self_check'],
    });
  });

  it('B1.1 åtgärdsrutten köar och agenten kan läsa sitt väntande förslag', async () => {
    const invoiceId = await nyFaktura(b);
    const res = await api.post(`${co(b)}/actions/book_invoice`)
      .set('Authorization', `Bearer ${b.agentToken}`)
      .send({ invoice_id: invoiceId, fiscal_year_id: b.fiscalYear.id });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ status: 'pending_approval', action: 'book_invoice', approval: { status: 'pending' } });
    const approvalId = res.body.approval.id as string;
    const pending = await api.get(`${co(b)}/approvals?status=pending`)
      .set('Authorization', `Bearer ${b.agentToken}`);
    expect(pending.status, JSON.stringify(pending.body)).toBe(200);
    expect(pending.body.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ id: approvalId })]));
    expect((await tillstand(b, approvalId, invoiceId)).voucherId).toBeNull();
  });

  it('B1.2 MCP köar bokföringen och list_pending_approvals läser samma förslag', async () => {
    const invoiceId = await nyFaktura(b);
    const res = await mcp.request('tools/call', { name: 'book_invoice',
      arguments: { invoice_id: invoiceId, fiscal_year_id: b.fiscalYear.id } });
    expect(res.error).toBeUndefined();
    const result = res.result as Verktygssvar;
    expect(result.isError).not.toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain('godkännande');
    const approvalId = text.match(/\(id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i)?.[1];
    expect(approvalId, text).toBeDefined();
    const list = await mcp.request('tools/call', { name: 'list_pending_approvals', arguments: {} });
    expect(list.error).toBeUndefined();
    const listResult = list.result as Verktygssvar;
    expect(listResult.isError).not.toBe(true);
    const pending = JSON.parse(listResult.content[0]!.text) as { approvals: { id: string; action: string }[] };
    expect(pending.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ id: approvalId, action: 'book_invoice' })]));
    expect((await tillstand(b, approvalId!, invoiceId)).voucherId).toBeNull();
  });

  it('B1.3 verktygslistan är manifestet plus exakt två utan dubbletter', async () => {
    const res = await mcp.request('tools/list', {});
    expect(res.error).toBeUndefined();
    const tools = (res.result as { tools: { name: string }[] }).tools;
    const manifest = actionManifest();
    expect(verktygsavvikelse(tools.map((t) => t.name), manifest.map((a) => a.name)))
      .toEqual({ extra: [], saknas: [] });
    expect(tools).toHaveLength(manifest.length + 2);
  });

  it('B1.4 agenten nekas båda verktygen som når en avvisning före skrivning', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    for (const [name, args] of [
      ['avboj_beslutsforslag', { approval_id: approvalId, skal: 'Agentens nej' }],
      ['komplettera_beslutsforslag', { approval_id: approvalId, timmar: 8 }],
    ] as const) {
      const res = await mcp.request('tools/call', { name, arguments: args });
      expect(res.error).toBeUndefined();
      const result = res.result as Verktygssvar;
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('HTTP 403');
      expect(result.content[0]!.text).toContain('human_required');
      expect(await tillstand(b, approvalId, invoiceId)).toEqual(fore);
    }
  });
});

describe('Aktörsspärren', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('aktor'); });

  it('B2.3 motprovet ser att människans godkännande ändrar hela ögonblicksbilden', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    const res = await api.post(`${co(b)}/approvals/${approvalId}/approve`)
      .set('Authorization', `Bearer ${b.owner.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.approval.status).toBe('executed');
    const efter = await tillstand(b, approvalId, invoiceId);
    expect(efter.status).toBe('executed');
    expect(efter.vouchers).toBe(fore.vouchers + 1);
    expect(efter.voucherId).toBeTruthy();
    expect(efter.audit).toEqual(['action.approval_requested', 'action.approved_executed']);
  });

  it('B2.1 agentens REST-godkännande och båda avvisningarna lämnar allt oförändrat', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    for (const [beslut, body] of [
      ['approve', {}], ['reject', {}], ['reject', { reason: 'Agentens nej' }],
    ] as const) {
      const res = await api.post(`${co(b)}/approvals/${approvalId}/${beslut}`)
        .set('Authorization', `Bearer ${b.agentToken}`).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error).toBe('human_approval_required');
      expect(await tillstand(b, approvalId, invoiceId)).toEqual(fore);
    }
  });

  it('B2.2 direktanrop med agentaktör nekas och lämnar allt oförändrat', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    const params = { companyId: b.companyId, approverId: b.owner.userId,
      approverActor: 'agent' as const, approvalId };
    await expect(approveAction(params)).rejects.toMatchObject({ code: 'human_approval_required', status: 403 });
    expect(await tillstand(b, approvalId, invoiceId)).toEqual(fore);
    await expect(rejectApproval(params)).rejects.toMatchObject({ code: 'human_approval_required', status: 403 });
    expect(await tillstand(b, approvalId, invoiceId)).toEqual(fore);
  });
});

describe('Godkännandefel och upprepade beslut', () => {
  let b: Bolag;
  let session: Awaited<ReturnType<typeof loggaIn>>;
  let invoiceId: string;
  let p: string;
  let q: string;
  beforeAll(async () => {
    b = await nyttBolag('fel');
    session = await loggaIn(b);
    invoiceId = await nyFaktura(b);
    p = await koaSomAgent(b, invoiceId);
    q = await koaSomAgent(b, invoiceId);
    const res = await session.post(`${attGora(b)}/${p}/approve`).type('form').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toBe(attGora(b));
    expect((await tillstand(b, p, invoiceId)).status).toBe('executed');
  });

  it('B3.3 misslyckad bokföring rullar tillbaka och lämnar kortet med synlig felnotis', async () => {
    const fore = await tillstand(b, q, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', audit: ['action.approval_requested'] });
    const innan = await session.get(attGora(b));
    expect(innan.status, JSON.stringify(innan.body)).toBe(200);
    expect(innan.text).toContain(`action="${attGora(b)}/${q}/approve"`);
    const res = await session.post(`${attGora(b)}/${q}/approve`).type('form').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    const location = res.headers.location as string;
    expect(location).toMatch(new RegExp(`^${attGora(b)}\\?fel=`));
    const fel = new URL(location, 'http://localhost').searchParams.get('fel');
    expect(fel).toContain('Kunde inte utföras: fakturan är redan bokförd');
    expect(await tillstand(b, q, invoiceId)).toEqual(fore);
    const sida = await session.get(location);
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    expect(sida.text).toContain('<p class="notice">Kunde inte utföras: fakturan är redan bokförd</p>');
    expect(sida.text).toContain(`action="${attGora(b)}/${q}/approve"`);
  });

  it('B3.4 not_pending är tyst både vid upprepat godkännande och avvisning', async () => {
    const fore = await tillstand(b, p, invoiceId);
    expect(fore.status).toBe('executed');
    for (const beslut of ['approve', 'reject']) {
      const res = await session.post(`${attGora(b)}/${p}/${beslut}`).type('form').send({});
      expect(res.status, JSON.stringify(res.body)).toBe(302);
      expect(res.headers.location).toBe(attGora(b));
      expect(res.headers.location).not.toContain('fel=');
      expect(await tillstand(b, p, invoiceId)).toEqual(fore);
    }
  });
});

describe('Godkännandet i vyn', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('vy-ja'); });

  it('B3.1 människans ja i vyn bokför och visas som Utförd under Nyss avgjort', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    const session = await loggaIn(b);
    const res = await session.post(`${attGora(b)}/${approvalId}/approve`).type('form').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toBe(attGora(b));
    const efter = await tillstand(b, approvalId, invoiceId);
    expect(efter.status).toBe('executed');
    expect(efter.vouchers).toBe(fore.vouchers + 1);
    expect(efter.voucherId).toBeTruthy();
    expect(efter.audit).toEqual(['action.approval_requested', 'action.approved_executed']);
    const sida = await session.get(attGora(b));
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    expect(kvittorader(sida.text).some((rad) => rad.includes('Utförd') && rad.includes('Bokför faktura'))).toBe(true);
    expect(sida.text).not.toContain(`action="${attGora(b)}/${approvalId}/approve"`);
  });
});

describe('Godkännandet över REST', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('rest-ja'); });

  it('B3.2 människans REST-godkännande bokför och ger samma kvitto i Att göra', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    const res = await api.post(`${co(b)}/approvals/${approvalId}/approve`)
      .set('Authorization', `Bearer ${b.owner.token}`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.approval.status).toBe('executed');
    const efter = await tillstand(b, approvalId, invoiceId);
    expect(efter.status).toBe('executed');
    expect(efter.vouchers).toBe(fore.vouchers + 1);
    expect(efter.voucherId).toBeTruthy();
    expect(efter.audit).toEqual(['action.approval_requested', 'action.approved_executed']);
    const session = await loggaIn(b);
    const sida = await session.get(attGora(b));
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    expect(kvittorader(sida.text).some((rad) => rad.includes('Utförd') && rad.includes('Bokför faktura'))).toBe(true);
  });
});

describe('Ny bokföring efter avvisning', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('nytt-ja'); });

  it('B4.2 motprovet ser bokningen när ett nytt förslag för samma faktura godkänns', async () => {
    const invoiceId = await nyFaktura(b);
    const r = await koaSomAgent(b, invoiceId);
    const session = await loggaIn(b);
    const nej = await session.post(`${attGora(b)}/${r}/reject`).type('form').send({});
    expect(nej.status, JSON.stringify(nej.body)).toBe(302);
    expect(nej.headers.location).toBe(attGora(b));
    const avvisat = await tillstand(b, r, invoiceId);
    expect(avvisat.status).toBe('rejected');
    expect(avvisat.voucherId).toBeNull();
    const s = await koaSomAgent(b, invoiceId);
    expect(s).not.toBe(r);
    const ja = await session.post(`${attGora(b)}/${s}/approve`).type('form').send({});
    expect(ja.status, JSON.stringify(ja.body)).toBe(302);
    expect(ja.headers.location).toBe(attGora(b));
    const bokat = await tillstand(b, s, invoiceId);
    expect(bokat.status).toBe('executed');
    expect(bokat.voucherId).toBeTruthy();
    expect(bokat.vouchers).toBe(avvisat.vouchers + 1);
    expect(bokat.audit).toEqual(['action.approval_requested', 'action.approved_executed']);
    expect((await tillstand(b, r, invoiceId)).status).toBe('rejected');
  });
});

describe('Avvisningen i vyn', () => {
  let b: Bolag;
  beforeAll(async () => { b = await nyttBolag('vy-nej'); });

  it('B4.1 människans nej ger Avvisad och audit utan verifikat eller fakturakoppling', async () => {
    const invoiceId = await nyFaktura(b);
    const approvalId = await koaSomAgent(b, invoiceId);
    const fore = await tillstand(b, approvalId, invoiceId);
    expect(fore).toMatchObject({ status: 'pending', voucherId: null, audit: ['action.approval_requested'] });
    const session = await loggaIn(b);
    const res = await session.post(`${attGora(b)}/${approvalId}/reject`).type('form').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(302);
    expect(res.headers.location).toBe(attGora(b));
    const efter = await tillstand(b, approvalId, invoiceId);
    expect(efter.status).toBe('rejected');
    expect(efter.audit).toEqual(['action.approval_requested', 'action.rejected']);
    expect(efter.voucherId).toBeNull();
    expect(efter.vouchers).toBe(fore.vouchers);
    const sida = await session.get(attGora(b));
    expect(sida.status, JSON.stringify(sida.body)).toBe(200);
    expect(kvittorader(sida.text).some((rad) => rad.includes('Avvisad') && rad.includes('Bokför faktura'))).toBe(true);
    expect(sida.text).not.toContain(`action="${attGora(b)}/${approvalId}/approve"`);
  });
});
