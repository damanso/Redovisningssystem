// AI-OCR: modellen svarar ibland med tal som strängar («"suggested_expense_account": "5410"»).
// En sträng som är ett rent tal tolkas till talet; allt annat fälls av schemat som förut och
// blir 400 validation_error. Vision-klienten stubbas — inget nät, ingen modell.
import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { errorHandler } from '../src/http/middleware/errorHandler.js';
import { aiOcrReceipt, type VisionClient, type VisionRequest } from '../src/services/aiOcr.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);

/** Stub-klient som svarar med ett fast modellsvar och sparar begäran. */
function stub(svar: Record<string, unknown>): { client: VisionClient; begaran: VisionRequest[] } {
  const begaran: VisionRequest[] = [];
  return {
    begaran,
    client: {
      async complete(req) {
        begaran.push(req);
        return JSON.stringify(svar);
      },
    },
  };
}

const tolka = (svar: Record<string, unknown>) =>
  aiOcrReceipt({ mimeType: 'image/png', buffer: png }, { visionClient: stub(svar).client });

/** Svaret som kvittotolkningens endpoint ger för felet: errorHandler med samma fel. */
async function httpSvar(svar: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const fel = await tolka(svar).then(
    () => expect.fail('modellsvaret skulle ha fällts'),
    (e: unknown) => e,
  );
  const ut = { status: 0, body: undefined as unknown };
  const res = {
    headersSent: false,
    status(s: number) { ut.status = s; return this; },
    json(b: unknown) { ut.body = b; return this; },
  };
  errorHandler(fel, {} as Request, res as unknown as Response, () => expect.fail('next() anropades'));
  return ut;
}

// Ett kvitto som modellen läser rätt, med tal som JSON-tal.
const KVITTO = {
  supplier_name: 'Kontorsvaror AB',
  receipt_date: '2026-11-01',
  net_ore: 10000,
  vat_ore: 2500,
  total_ore: 12500,
  vat_rate: 25,
  suggested_expense_account: 5410,
  confidence: 0.9,
  notes: null,
};

describe('AI-OCR: tal som strängar i modellsvaret', () => {
  it('"suggested_expense_account": "5410" och "total_ore": "12500" tolkas till tal', async () => {
    const s = await tolka({ ...KVITTO, suggested_expense_account: '5410', total_ore: '12500' });
    expect(s.suggested_expense_account).toBe(5410);
    expect(s.total_ore).toBe(12500);
    expect(s.requires_human_review).toBe(true);
  });

  it('alla talfält som strängar, med mellanslag mellan tusental och decimalkomma i confidence', async () => {
    const s = await tolka({
      ...KVITTO,
      net_ore: '10000',
      vat_ore: ' 2 500 ',
      total_ore: '12\u00a0500',
      vat_rate: '25',
      suggested_expense_account: '5410',
      confidence: '0,9',
    });
    expect(s).toStrictEqual({ ...KVITTO, requires_human_review: true, model: config.AI_MODEL });
  });

  // Driftens 400 den 9/11 hade en enda details-rad (suggested_expense_account), så övriga talfält var
  // giltiga. Samma form här: en pdf, och JSON:en indragen i det ```json-staket som parseJsonObject tål.
  it('svar i ```json-staket där bara kontot är en sträng (som i driften 9/11) ger förslaget', async () => {
    const svar = '```json\n' + JSON.stringify({ ...KVITTO, suggested_expense_account: '5410' }, null, 2) + '\n```';
    const client: VisionClient = { async complete() { return svar; } };
    const s = await aiOcrReceipt({ mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') }, { visionClient: client });
    expect(s).toStrictEqual({ ...KVITTO, requires_human_review: true, model: config.AI_MODEL });
  });

  it('tal som JSON-tal tolkas som förut', async () => {
    const s = await tolka(KVITTO);
    expect(s).toStrictEqual({ ...KVITTO, requires_human_review: true, model: config.AI_MODEL });
  });

  it('"suggested_expense_account": "abc" fälls med 400 validation_error', async () => {
    const r = await httpSvar({ ...KVITTO, suggested_expense_account: 'abc' });
    expect(r).toStrictEqual({
      status: 400,
      body: {
        error: 'validation_error',
        details: [{ path: 'suggested_expense_account', message: 'Expected number, received string' }],
      },
    });
  });

  // Strängar som inte är ett rent tal av fältets slag förblir fel.
  it.each([
    ['total_ore', '1 250,00'], // decimaler i ett örefält: troligen kronor
    ['total_ore', '12500.00'],
    ['total_ore', '12,500'],
    ['total_ore', '12 50'],
    ['total_ore', '12500 kr'],
    ['net_ore', '-100'],
    ['net_ore', ''],
    ['net_ore', '1e4'],
    ['net_ore', '0x10'],
    ['net_ore', '99999999999999999999'],
    ['vat_rate', '25%'],
    ['vat_rate', '20'],
    ['suggested_expense_account', '54100'],
    ['suggested_expense_account', '5410.5'],
    ['suggested_expense_account', 'konto 5410'],
    ['confidence', '1,5'],
    ['confidence', 'hög'],
  ])('%s: %j fälls med 400 validation_error på fältet', async (falt, varde) => {
    const r = await httpSvar({ ...KVITTO, [falt]: varde });
    expect(r.status).toBe(400);
    const body = r.body as { error: string; details: { path: string }[] };
    expect(body.error).toBe('validation_error');
    expect(body.details.map((d) => d.path)).toStrictEqual([falt]);
  });

  it('ett svar helt utan tal fungerar som i dag', async () => {
    const utanTal = await tolka({ supplier_name: 'Kafé AB', notes: 'Beloppet går inte att läsa' });
    expect(utanTal).toStrictEqual({
      supplier_name: 'Kafé AB',
      notes: 'Beloppet går inte att läsa',
      requires_human_review: true,
      model: config.AI_MODEL,
    });
    const medNull = await tolka({
      supplier_name: null, receipt_date: null, net_ore: null, vat_ore: null, total_ore: null,
      vat_rate: null, suggested_expense_account: null, confidence: null, notes: null,
    });
    expect(medNull).toStrictEqual({
      supplier_name: null, receipt_date: null, net_ore: null, vat_ore: null, total_ore: null,
      vat_rate: null, suggested_expense_account: null, confidence: null, notes: null,
      requires_human_review: true, model: config.AI_MODEL,
    });
  });

  it('requires_human_review förblir true även när modellen skickar "false"', async () => {
    const s = await tolka({ ...KVITTO, total_ore: '12500', requires_human_review: 'false' });
    expect(s.requires_human_review).toBe(true);
  });

  it('systemprompten kräver tal som JSON-tal och föreslår inget kontonummer', async () => {
    const { client, begaran } = stub(KVITTO);
    await aiOcrReceipt({ mimeType: 'image/png', buffer: png }, { visionClient: client });
    expect(begaran[0]!.system).toContain('skrivs som JSON-tal utan citattecken, aldrig som strängar');
    expect(begaran[0]!.system).not.toMatch(/\d{4}/);
  });
});
