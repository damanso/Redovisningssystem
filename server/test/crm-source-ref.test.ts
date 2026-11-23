// Story 3.13 (FR-4, FR-43): grundnyckeln och gravstenens nycklar är rena regler.
// Risken är en grundnyckel som bildas på två ställen, eller en prövning som
// glider från skrivningen, så att mottagaren dubblerar en kontaktpunkt eller en
// raderad kunds mail kommer tillbaka i den andra formen. Bara rena anrop här;
// databasen återskapas ändå av setup.ts före filen.
import { describe, expect, it } from 'vitest';
import {
  emailDomain, erasureBlocks, erasureCheckKeys, erasureKeys, GRUNDNYCKEL_SYSTEM, sourceRefBase, suffixDomain,
} from '../src/lib/crmSourceRef.js';

const NYCKELTABELL: Array<{ source_system: string; source_ref: string; email: string | null; facit: string[] }> = [
  { source_system: 'gmail', source_ref: 'gmail:1', email: 'eva@kund.se', facit: ['gmail:1', 'gmail:1#kund.se'] },
  { source_system: 'gmail', source_ref: 'gmail:2#Kund.se', email: 'eva@annan.se', facit: ['gmail:2#Kund.se', 'gmail:2#kund.se'] },
  { source_system: 'gmail', source_ref: 'gmail:3#kund.se', email: null, facit: ['gmail:3#kund.se'] },
  { source_system: 'gmail', source_ref: 'gmail:4', email: null, facit: ['gmail:4'] },
  { source_system: 'calendar', source_ref: 'calendar:e', email: 'eva@kund.se', facit: ['calendar:e', 'calendar:e#kund.se'] },
  { source_system: 'linear', source_ref: 'linear:LOC-1', email: 'eva@kund.se', facit: ['linear:LOC-1'] },
  { source_system: 'gmail', source_ref: 'gmail:5#commit-1', email: 'eva@kund.se', facit: ['gmail:5#commit-1', 'gmail:5#kund.se'] },
];

describe('källnyckelns grund och gravstenens nycklar (story 3.13)', () => {
  it('K1: grundnyckeln är delen före första # och bara för gmail och calendar', () => {
    expect([...GRUNDNYCKEL_SYSTEM]).toEqual(['gmail', 'calendar']);
    expect(sourceRefBase('gmail', 'gmail:1')).toBe('gmail:1');
    expect(sourceRefBase('gmail', 'gmail:1#a.se')).toBe('gmail:1');
    expect(sourceRefBase('calendar', 'calendar:e#a.se#b')).toBe('calendar:e');
    expect(sourceRefBase('linear', 'linear:LOC-1#a')).toBeNull();
    expect(sourceRefBase('manual', 'm#a.se')).toBeNull();
    expect(sourceRefBase('gmail', '#a.se')).toBeNull();
    expect(sourceRefBase('gmail', '')).toBeNull();
    expect(sourceRefBase('gmail', undefined)).toBeNull();
  });

  it('K2: domänen ur e-posten och ur suffixet har domänform och gemener', () => {
    expect(emailDomain('Eva@Kund.SE')).toBe('kund.se');
    expect(emailDomain('eva')).toBeNull();
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain('a@b')).toBeNull();
    expect(suffixDomain('gmail:1#Kund.se')).toBe('kund.se');
    expect(suffixDomain('gmail:1#commit-1')).toBeNull();
    expect(suffixDomain('gmail:1#c1')).toBeNull();
    expect(suffixDomain('gmail:1')).toBeNull();
    expect(suffixDomain('gmail:1#bolaget-åäö.se')).toBe('bolaget-åäö.se');
  });

  it('K3: raderingen sparar källnyckeln och domänsyskonet, utan dubbletter', () => {
    for (const rad of NYCKELTABELL) {
      expect(erasureKeys(rad), `${rad.source_system}/${rad.source_ref}`).toEqual(rad.facit);
    }
  });

  it('K4: spärren prövar samma nycklar som raderingen skriver', () => {
    for (const rad of NYCKELTABELL) {
      expect(erasureCheckKeys(rad), `${rad.source_system}/${rad.source_ref}`).toEqual(erasureKeys(rad));
    }
  });

  it('K5: gravstenen spärrar egen nyckel och syskon, och en bar gravsten utan syskon spärrar varje domän', () => {
    // (a) den inkommande nyckeln står bland gravstenarna
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: 'gmail:1#kund.se', email: null }),
      base: 'gmail:1', tombstones: ['gmail:1#kund.se'],
    })).toBe(true);
    // (b) domänsyskonet står bland gravstenarna
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: 'gmail:2', email: 'eva@kund.se' }),
      base: 'gmail:2', tombstones: ['gmail:2#kund.se'],
    })).toBe(true);
    // (c) en bar gravsten utan syskon spärrar varje domän
    for (const ref of ['gmail:3#a.se', 'gmail:3#b.se', 'gmail:3#vilken.example']) {
      expect(erasureBlocks({
        checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: ref, email: 'anna@annan.se' }),
        base: 'gmail:3', tombstones: ['gmail:3'],
      }), ref).toBe(true);
    }
    // (d) en bar gravsten med syskon på domänen A spärrar inte domänen B
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: 'gmail:4#b.se', email: 'bo@b.se' }),
      base: 'gmail:4', tombstones: ['gmail:4', 'gmail:4#a.se'],
    })).toBe(false);
    // (e) löftets gravsten har ingen domänform och räknas inte som syskon
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: 'gmail:5#kund.se', email: null }),
      base: 'gmail:5', tombstones: ['gmail:5', 'gmail:5#commit-1'],
    })).toBe(true);
    // (f) inga gravstenar
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: 'gmail:6', email: 'eva@kund.se' }),
      base: 'gmail:6', tombstones: [],
    })).toBe(false);
    // (g) utan grund gäller bara den exakta nyckeln
    expect(erasureBlocks({
      checkKeys: erasureCheckKeys({ source_system: 'linear', source_ref: 'linear:LOC-1#a', email: null }),
      base: null, tombstones: ['linear:LOC-1'],
    })).toBe(false);
  });

  it('K6: gränserna som kontraktets regel 4 anger', () => {
    const sparrar = (ref: string, email: string | null, base: string, tombstones: string[]) =>
      erasureBlocks({ checkKeys: erasureCheckKeys({ source_system: 'gmail', source_ref: ref, email }), base, tombstones });
    // (a) bara `<grund>#<domän>` sparades: formen `<grund>` spärras bara när personens domän är den raderade
    expect(sparrar('gmail:7', 'eva@kund.se', 'gmail:7', ['gmail:7#kund.se'])).toBe(true);
    expect(sparrar('gmail:7', null, 'gmail:7', ['gmail:7#kund.se'])).toBe(false);
    expect(sparrar('gmail:7', 'bo@annan.se', 'gmail:7', ['gmail:7#kund.se'])).toBe(false);
    // (b) den raderade kontaktpunktens nyckel var `<grund>`, en exakt gravsten: en annan
    // organisations mail spärras i formen `<grund>` och släpps i formen `<grund>#<sin domän>`
    expect(sparrar('gmail:8', 'bo@b.se', 'gmail:8', ['gmail:8', 'gmail:8#a.se'])).toBe(true);
    expect(sparrar('gmail:8#b.se', 'bo@b.se', 'gmail:8', ['gmail:8', 'gmail:8#a.se'])).toBe(false);
    // (c) en bar gravsten utan person spärrar varje domän, tills en annan kunds radering sparar ett syskon
    expect(sparrar('gmail:9#d.se', 'dan@d.se', 'gmail:9', ['gmail:9'])).toBe(true);
    expect(sparrar('gmail:9#d.se', 'dan@d.se', 'gmail:9', ['gmail:9', 'gmail:9#n.se'])).toBe(false);
  });
});
