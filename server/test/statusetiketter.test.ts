// Varje statusvärde databasen tillåter ska ha en svensk etikett.
//
// Bakgrunden: kvittoraden visade "• registered" — rakt databasvärde i ett
// svenskt gränssnitt. Orsaken är att statusChip() har en TYST reserv:
//
//     const s = STATUS[status] ?? { label: status, kind: 'muted', icon: '•' };
//
// En saknad översättning ser därför ut som en medveten etikett. Felet syns
// bara för den som redan vet vad som borde stått där.
//
// Provet HÄRLEDS ur databasens CHECK-villkor, inte ur en lista jag skriver
// för hand. Nästa migration som inför ett statusvärde faller här i stället
// för i vyn, utan att någon behöver komma ihåg det här provet.
import { describe, expect, it } from 'vitest';
import { withAdmin } from './helpers.js';
import { harStatusEtikett } from '../src/http/view/html.js';

/** Plockar ut 'a', 'b' ur "CHECK ((status = ANY (ARRAY['a'::text, 'b'::text])))". */
function varden(villkor: string): string[] {
  return [...villkor.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
}

describe('statusetiketter', () => {
  it('varje statusvärde i schemat har en svensk etikett', async () => {
    const rader = await withAdmin(async (c) => {
      const r = await c.query<{ tabell: string; villkor: string }>(
        `select rel.relname as tabell, pg_get_constraintdef(con.oid) as villkor
           from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
          where con.contype = 'c'
            and pg_get_constraintdef(con.oid) like '%(status = ANY%'
          order by rel.relname`,
      );
      return r.rows;
    });

    // Ett prov som inte hittade något har inte visat något. Utan den här
    // raden skulle ett omdöpt villkor göra provet tyst grönt för alltid.
    expect(rader.length, 'inga status-CHECK-villkor hittades — provet kunde inte titta')
      .toBeGreaterThan(5);

    const saknas: string[] = [];
    for (const rad of rader) {
      for (const v of varden(rad.villkor)) {
        if (!harStatusEtikett(v)) saknas.push(`${rad.tabell}.${v}`);
      }
    }
    expect(saknas, `statusvärden utan svensk etikett: ${saknas.join(', ')}`).toEqual([]);
  });

  it('reserven finns kvar för okända värden — men den ska aldrig behövas', () => {
    // Reserven tas INTE bort: ett okänt värde ska visa något, inte krascha en
    // hel sida. Provet ovan är det som ser till att den aldrig används.
    expect(harStatusEtikett('detta-finns-inte')).toBe(false);
  });
});
