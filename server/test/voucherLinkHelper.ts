// Baklänkningshjälpare för proven om utkastradering (FR-41, AD-12): en post
// kopplas till ett befintligt verifikat med link_voucher och lossas igen med
// unlink_voucher, precis som en importerad registerpost som rättas.
//
// Två saker styr filens form:
//   - performAction godkänner förslaget när svaret är 202. Davids svar på FR-35
//     (2026-10-16, alternativ a) gör baklänkningen känslig i Story 1.6; då ska
//     fallen som lutar mot hjälparen hålla utan omskrivning. Varje godkännande
//     kräver 200 — ett godkännandefel sväljs aldrig (lärdom 4).
//   - hjälparna står i en egen fil och inte i en testfil, eftersom en testfil
//     som importerar en annan testfil också registrerar dess fall.
import type { Response } from 'supertest';
import { expect } from 'vitest';
import { api } from './helpers.js';

type AuthHeaders = Record<string, string>;
export type LinkableKind = 'invoice' | 'receipt' | 'supplier_invoice' | 'payslip';

/** Postar åtgärden; ett 202-förslag godkänns direkt och godkännandets svar returneras. */
export async function performAction(
  base: string, auth: AuthHeaders, action: string, input: Record<string, unknown>,
): Promise<Response> {
  const res = await api.post(`${base}/actions/${action}`).set(auth).send(input);
  if (res.status !== 202) return res;
  expect(res.body.approval?.id, JSON.stringify(res.body)).toBeTruthy();
  return api.post(`${base}/approvals/${res.body.approval.id}/approve`).set(auth).send({});
}

/** Bokför ett fristående verifikat (som ett importverifikat) och returnerar dess id. */
export async function postManualVoucher(
  base: string, auth: AuthHeaders, fiscalYearId: string, date: string, description: string,
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
  expect(res.body.result?.id, JSON.stringify(res.body)).toBeTruthy();
  return res.body.result.id;
}

/** Kopplar posten till ett nytt verifikat och lossar den igen; returnerar verifikatets id. */
export async function linkAndUnlink(
  base: string, auth: AuthHeaders, fiscalYearId: string, kind: LinkableKind, id: string, date: string,
): Promise<string> {
  const voucherId = await postManualVoucher(base, auth, fiscalYearId, date, `Importverifikat för ${kind}`);
  const linked = await performAction(base, auth, 'link_voucher', {
    entity_type: kind, entity_id: id, voucher_id: voucherId,
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);
  const unlinked = await performAction(base, auth, 'unlink_voucher', { entity_type: kind, entity_id: id });
  expect(unlinked.status, JSON.stringify(unlinked.body)).toBe(200);
  return voucherId;
}
