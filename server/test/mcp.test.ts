// Rök-/integrationstest för MCP-servern (Fas 3, Alternativ A i planen): startar
// den BYGGDA stdio-servern som en riktig barnprocess, pratar MCP-protokollet
// över stdin/stdout, och bevisar att den driver kärnan end-to-end — inklusive
// att en känslig action ALDRIG utförs av agenten utan hamnar i godkännandekön.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, api, createCompany, registerUser, type TestUser } from './helpers.js';

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let user: TestUser;
let companyId: string;
let agentToken: string;
let invoiceId: string;
let fiscalYearId: string;

// Minimal MCP-stdio-klient: nyradsavgränsad JSON-RPC 2.0.
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

let child: ChildProcessWithoutNullStreams;
let mcp: McpClient;

beforeAll(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;

  user = await registerUser('mcp');
  companyId = await createCompany(user.token, 'MCP Bolag AB');
  const h = { Authorization: `Bearer ${user.token}` };
  const tok = await api.post(`/api/companies/${companyId}/agent-tokens`).set(h).send({ name: 'Cowork' });
  agentToken = tok.body.token;
  await api.post(`/api/companies/${companyId}/customers`).set(h).send({ name: 'MCP Kund AB' });
  const fy = await api.post(`/api/companies/${companyId}/accounting/fiscal-years`).set(h)
    .send({ label: '2025', start_date: '2025-01-01', end_date: '2025-12-31' });
  fiscalYearId = fy.body.fiscal_year.id;
  const cust2 = await api.post(`/api/companies/${companyId}/customers`).set(h).send({ name: 'Fakturakund' });
  const inv = await api.post(`/api/companies/${companyId}/invoices`).set(h)
    .send({ customer_id: cust2.body.customer.id, invoice_date: '2025-05-01', lines: [{ description: 'Tjänst', quantity: 1, unit_price_ore: 100000, vat_rate: 25 }] });
  invoiceId = inv.body.invoice.id;

  // Kör KÄLLAN via tsx (inte dist/) så testet aldrig kan exercera en gammal
  // byggartefakt — källa och test kan inte divergera, och npm test behöver
  // ingen föregående build.
  child = spawn(process.execPath, ['--import', 'tsx', 'src/mcp/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, REDOVISNING_API_URL: baseUrl, REDOVISNING_AGENT_TOKEN: agentToken, REDOVISNING_COMPANY_ID: companyId },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  // Tydlig diagnostik om servern inte startar (annars bara en 10s-timeout).
  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => stderr.push(d));
  child.on('error', (e) => { throw new Error(`kunde inte starta MCP-servern: ${e.message}`); });
  child.on('exit', (code) => { if (code) throw new Error(`MCP-servern avslutades (${code}): ${stderr.join('')}`); });
  mcp = new McpClient(child);
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  mcp.notify('notifications/initialized');
});

afterAll(async () => {
  child?.kill();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('MCP-server (stdio) driver kärnan', () => {
  it('tools/list exponerar kärnans actions som native verktyg, känsliga märkta', async () => {
    const res = await mcp.request('tools/list', {});
    const tools = (res.result as { tools: { name: string; description: string; inputSchema: unknown }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_customers');
    expect(names).toContain('book_invoice');
    expect(names).toContain('list_pending_approvals');
    const book = tools.find((t) => t.name === 'book_invoice')!;
    expect(book.description).toMatch(/godkänn/i); // känslig → märkt att människa krävs
    expect(book.inputSchema).toBeTruthy(); // JSON-schema medskickat
  });

  it('self_check rapporterar API-nåbarhet och tokenutgång (K5)', async () => {
    const res = await mcp.request('tools/call', { name: 'self_check', arguments: {} });
    const content = (res.result as { content: { type: string; text: string }[] }).content;
    const check = JSON.parse(content[0]!.text) as Record<string, unknown>;
    expect(check.ok).toBe(true);
    expect(check.api_reachable).toBe(true);
    expect(check.token_valid).toBe(true);
    expect(String(check.token_expires_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number(check.token_days_left)).toBeGreaterThan(0);
    expect(check.warnings).toEqual([]);
  });

  it('tools/call på en läs-action returnerar riktig data ur kärnan', async () => {
    const res = await mcp.request('tools/call', { name: 'list_customers', arguments: {} });
    const content = (res.result as { content: { type: string; text: string }[] }).content;
    expect(content[0]!.text).toContain('MCP Kund AB');
  });

  it('tools/call på en KÄNSLIG action bokför INTE — den hamnar i godkännandekön', async () => {
    const res = await mcp.request('tools/call', { name: 'book_invoice', arguments: { invoice_id: invoiceId, fiscal_year_id: fiscalYearId } });
    const content = (res.result as { content: { type: string; text: string }[] }).content;
    expect(content[0]!.text).toMatch(/godkännande/i);
    expect(content[0]!.text).toMatch(/bokförts ännu|Ingenting/i);
    // Bevis: fakturan är fortfarande obokförd (agenten kunde inte utföra den).
    const invs = await api.get(`/api/companies/${companyId}/invoices`).set({ Authorization: `Bearer ${user.token}` });
    const inv = invs.body.invoices.find((i: { id: string }) => i.id === invoiceId);
    expect(inv.voucher_id).toBeFalsy();
    // Och det ligger som pending i kön.
    const pend = await api.get(`/api/companies/${companyId}/approvals?status=pending`).set({ Authorization: `Bearer ${user.token}` });
    expect(pend.body.approvals.length).toBeGreaterThan(0);
  });
});
