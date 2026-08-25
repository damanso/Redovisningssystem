// R-3: create_supplier släppte igenom ett ogiltigt bankgiro på skrivvägen.
//
// bankgiro var deklarerat som safeText(20) — en LÄNGDgräns, inte en kontroll.
// Ett nummer med fel kontrollsiffra kunde därför skrivas in när leverantören
// skapades, och felet upptäcktes först när betalningen gick fel.
//
// Provet går mot REGISTRET, i samma form som party-update.test.ts, och behöver
// därför ingen databas. Det prövar båda riktningarna:
//   - ett OGILTIGT bankgiro avvisas, och
//   - ett GILTIGT bankgiro går fortfarande igenom.
// Den andra halvan är den negativa kontrollen. Utan den kunde provet vara grönt
// av fel skäl: ett schema som avvisar ALLT hade också fått första fallet att
// passera, och det vore en trasig åtgärd, inte en spärr.
import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';
import { luhnIsValid } from '../src/domain/luhn.js';

function action(namn: string) {
  const a = ACTIONS.find((x) => x.name === namn);
  if (!a) throw new Error(`action saknas i registret: ${namn}`);
  return a;
}

// 5776-6446 är ett riktigt bankgiro (samma som fakturamallens prov använder).
// 5776-6447 är samma nummer med sista siffran flyttad ett steg — rätt form,
// rätt längd, fel kontrollsiffra. Det är exakt den sortens fel en människa gör.
const GILTIGT = '5776-6446';
const OGILTIGT = '5776-6447';
const siffror = (v: string) => v.replace(/[\s-]/g, '');

describe('create_supplier validerar bankgiro på skrivvägen', () => {
  // Fixturerna påstås inte vara giltiga respektive ogiltiga — det mäts här.
  // Byter någon ut dem mot två nummer av samma sort faller det här provet, i
  // stället för att tyst göra den negativa kontrollen meningslös.
  it('fixturerna är vad de utger sig för att vara', () => {
    expect(luhnIsValid(siffror(GILTIGT)), `${GILTIGT} skulle vara giltigt`).toBe(true);
    expect(luhnIsValid(siffror(OGILTIGT)), `${OGILTIGT} skulle vara ogiltigt`).toBe(false);
  });

  it('OGILTIGT bankgiro avvisas', () => {
    const r = action('create_supplier').inputSchema.safeParse({
      name: 'Bedragaren AB',
      bankgiro: OGILTIGT,
    });
    expect(r.success, 'ett bankgiro med fel kontrollsiffra kunde skrivas in').toBe(false);
  });

  it('GILTIGT bankgiro går fortfarande igenom — negativ kontroll', () => {
    const r = action('create_supplier').inputSchema.safeParse({
      name: 'Hederliga Leverantören AB',
      bankgiro: GILTIGT,
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('leverantör utan bankgiro går igenom — fältet är fortfarande valfritt', () => {
    const r = action('create_supplier').inputSchema.safeParse({ name: 'Utan giro AB' });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
  });

  it('text som inte ens är ett nummer avvisas', () => {
    const r = action('create_supplier').inputSchema.safeParse({
      name: 'Slarv AB',
      bankgiro: 'inget nummer alls',
    });
    expect(r.success, 'fritext godtogs som bankgiro').toBe(false);
  });

  it('fel antal siffror avvisas även om Luhn råkar stämma', () => {
    // 18 är Luhn-giltigt men är inte ett bankgiro. Formkravet (7-8 siffror)
    // måste bära själv, annars räcker det att gissa ett kort tal.
    expect(luhnIsValid('18')).toBe(true);
    const r = action('create_supplier').inputSchema.safeParse({
      name: 'För kort AB',
      bankgiro: '18',
    });
    expect(r.success, 'ett tvåsiffrigt tal godtogs som bankgiro').toBe(false);
  });
});
