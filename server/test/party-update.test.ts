import { describe, expect, it } from 'vitest';
import { ACTIONS } from '../src/actions/registry.js';

/**
 * Betalningsmottagaren är det enda i den här ändringen som är säkerhet och
 * inte bekvämlighet. Provet härleds ur regeln:
 *
 *   Ett fält som bestämmer VART PENGARNA GÅR får inte kunna ändras av en
 *   åtgärd vars sensitivity är 'write'.
 *
 * Reglen prövas mot REGISTRET, inte mot en lista över kända fel: läggs ett
 * nytt betalningsfält till någon gång, eller sänks en sensitivity, faller
 * provet utan att någon behöver komma ihåg att uppdatera det.
 */
const BETALNINGSFALT = ['bankgiro', 'plusgiro'] as const;

function action(namn: string) {
  const a = ACTIONS.find((x) => x.name === namn);
  if (!a) throw new Error(`action saknas i registret: ${namn}`);
  return a;
}

describe('rättning av parter', () => {
  it('update_supplier finns och är write — vanliga uppgifter rättas direkt', () => {
    expect(action('update_supplier').sensitivity).toBe('write');
    expect(action('update_customer').sensitivity).toBe('write');
  });

  it('update_supplier AVVISAR betalningsfält — spärren är schemat, inte en kommentar', () => {
    const schema = action('update_supplier').inputSchema;
    for (const falt of BETALNINGSFALT) {
      const r = schema.safeParse({
        supplier_id: '00000000-0000-4000-8000-000000000001',
        [falt]: '123-4567',
      });
      expect(r.success, `${falt} slapps igenom av update_supplier`).toBe(false);
    }
  });

  it('update_supplier släpper igenom de ofarliga fälten', () => {
    const r = action('update_supplier').inputSchema.safeParse({
      supplier_id: '00000000-0000-4000-8000-000000000001',
      name: 'Nytt namn AB',
      email: 'ny@example.com',
    });
    expect(r.success).toBe(true);
  });

  it('betalningsmottagaren har en EGEN åtgärd, och den är sensitive', () => {
    const a = action('update_supplier_payment_details');
    expect(a.sensitivity).toBe('sensitive');
    const r = a.inputSchema.safeParse({
      supplier_id: '00000000-0000-4000-8000-000000000001',
      bankgiro: '123-4567',
    });
    expect(r.success).toBe(true);
  });

  it('ett tomt betalningsanrop avvisas — en godkänd åtgärd som inte gör något är brus i kön', () => {
    const r = action('update_supplier_payment_details').inputSchema.safeParse({
      supplier_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(r.success).toBe(false);
  });

  it('INGEN write-åtgärd i hela registret rör ett betalningsfält', () => {
    // Den generella formen av kravet. Ovanstående prövar de åtgärder jag
    // skrev; den här prövar dem någon annan skriver sedan.
    const syndare: string[] = [];
    for (const a of ACTIONS) {
      if (a.sensitivity !== 'write') continue;
      // create_* undantas medvetet och med skäl: en NY part har inga fakturor,
      // så ingen befintlig betalström kan omdirigeras. Undantaget står här,
      // synligt, i stället för att tigas ihjäl.
      if (a.name.startsWith('create_')) continue;
      for (const falt of BETALNINGSFALT) {
        const r = a.inputSchema.safeParse({ [falt]: '123-4567' });
        // safeParse lyckas bara om fältet är känt OCH allt annat är valfritt;
        // det räcker att fältet inte avvisas som okänt för att vara en risk.
        const felTexter = r.success ? [] : JSON.stringify(r.error.issues);
        const okantFalt = !r.success && String(felTexter).includes(falt);
        if (r.success || !okantFalt) {
          // Kan fältet överhuvudtaget nå åtgärden? Om felet inte handlar om
          // att fältet är okänt kan det vara ett annat valideringsfel — då är
          // fältet accepterat i schemat.
          const r2 = a.inputSchema.safeParse({});
          if (!r2.success && !String(JSON.stringify(r2.error.issues)).includes(falt)) {
            syndare.push(`${a.name}.${falt}`);
          }
        }
      }
    }
    expect(syndare, 'write-åtgärder som kan röra betalningsmottagare').toEqual([]);
  });
});
