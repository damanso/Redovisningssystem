// Story 1.7 (FR-41, AD-12): delade hjälpare för att bokföra ett fristående
// verifikat och koppla en registerpost till det och loss igen genom
// link_voucher/unlink_voucher — vägen som lämnar en post med voucher_id NULL
// fast den en gång nått huvudboken.
//
// Hjälparen godkänner vid 202. Davids svar på FR-35 (2026-10-16, alternativ a)
// gör baklänkningen känslig i Story 1.6, och fallen som lutar mot filen ska då
// hålla utan omskrivning. Varje godkännande kräver 200; inget fel sväljs.
//
// Hjälparna står i en egen fil (ingen *.test.ts), eftersom en testfil som
// importerar en annan testfil också registrerar dess fall.
import type { Response } from 'supertest';
import { expect } from 'vitest';
import { api } from './helpers.js';
// Typmängden hämtas ur baklänkningen, aldrig deklarerad på nytt här: en ny
// baklänkningsbar typ ska fälla provens tabeller i kompilatorn tills den har fall.
import type { LinkableEntityType } from '../src/services/voucherLinks.js';

/**
 * Postar åtgärden. Ger den 202 (känslig) godkänns förslaget med samma token,
 * och godkännandets svar returneras; annars returneras svaret som det är.
 */
export async function performAction(
  base: string, auth: Record<string, string>, action: string, input: Record<string, unknown>,
): Promise<Response> {
  const res = await api.post(`${base}/actions/${action}`).set(auth).send(input);
  if (res.status !== 202) return res;
  const approvalId = res.body?.approval?.id;
  expect(typeof approvalId, JSON.stringify(res.body)).toBe('string');
  return api.post(`${base}/approvals/${approvalId}/approve`).set(auth).send({});
}

/** Bokför ett fristående verifikat (1510 D / 3001 K / 2611 K) och ger dess id. */
export async function postManualVoucher(
  base: string, auth: Record<string, string>, fiscalYearId: string, date: string, description: string,
): Promise<string> {
  const res = await performAction(base, auth, 'post_voucher', {
    fiscal_year_id: fiscalYearId, voucher_date: date, description,
    lines: [
      { account_number: 1510, debit_ore: 125_000 },
      { account_number: 3001, credit_ore: 100_000 },
      { account_number: 2611, credit_ore: 25_000 },
    ],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const id = res.body?.result?.id;
  expect(typeof id, JSON.stringify(res.body)).toBe('string');
  return id as string;
}

/**
 * Bokför ett verifikat, kopplar posten till det med link_voucher (aldrig
 * mark_paid) och kopplar loss den med unlink_voucher. Ger verifikatets id.
 */
export async function linkAndUnlink(
  base: string, auth: Record<string, string>, fiscalYearId: string, kind: LinkableEntityType, id: string, date: string,
): Promise<string> {
  const voucherId = await postManualVoucher(base, auth, fiscalYearId, date, `Baklänkning ${kind}`);
  const linked = await performAction(base, auth, 'link_voucher', {
    entity_type: kind, entity_id: id, voucher_id: voucherId,
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  const unlinked = await performAction(base, auth, 'unlink_voucher', { entity_type: kind, entity_id: id });
  expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
  return voucherId;
}
