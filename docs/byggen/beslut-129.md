# Bygge beslut #129 — Svepets prognossteg (steg 3 i `uppdragSvep.ts`) byggs ut från dagens råsummering till FR-5:s riktiga

Datum: 2026-09-06 21:15 · Branch: cto/svepets-prognossteg-steg-3-i-uppdragsvep-129 · Overlamning: #129

## Mal
Svepets prognossteg (steg 3 i `uppdragSvep.ts`) byggs ut från dagens råsummering till FR-5:s riktiga prognos: två datum (när ramen i timmar respektive kronor nås) härledda ur registrerad tid t.o.m. i dag (befintlig förbrukning via `forbrukningForAvtal`/0064-taken) plus bokade kalenderminuter framåt ur svepindatat, och `villkor: ingen bokad framtid` när underlaget saknas.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen nedan är grundad i koden (steg 3 i `uppdragSvep.ts:365`, `forbrukningForAvtal`/`gallandeTaxa`/`timeEntryAmountOre` i `contracts.ts`, frysta prognosförväntningar i `uppdragsytan-svep.test.ts`), FR-5:s ordalydelse i PRD:n, 1E:s svepordning samt Davids beslutsregler (analysfrågan om taxan faller på regel 3 — husets taxeordning `gallandeTaxa`, utan post-/delled eftersom en bokning inte bär någon avtalsdel).

MAL | Svepets steg 3 levererar FR-5:s riktiga prognos i cachenyckeln `prognos`: två datum — när uppdragets ram i timmar respektive kronor nås — härledda ur registrerad tid t.o.m. i dag plus bokade kalenderminuter framåt, och ett namngivet `villkor` i stället för ett tal när underlag saknas, så att S10.4 senare kan rendera kurvan utan att något grannsystem rings under rendering (NFR-6) och utan att systemet någonsin gissar.
KALLA | Överlämning #129 (story S7.4 ur 1F, våg 4 i 1H; 1G GODKÄND 2026-09-05) + CTO-underlagets UNDERLAG/RISK + Davids ja 2026-09-06 (mandat 3/9 och 5/9); taxavalet avgjort av Davids beslutsregel 3 (husets mönster: `gallandeTaxa`-ordningen, `contracts.ts:456`); Linear LOC-403.
ARKITEKTUR | Befintliga mönster, inga nya: svepet som enda skrivväg via `upsertSvepvarden` (ADR-2: cachen omräkningsbar, deterministisk, idempotent); ADR-4 (repot ringer aldrig ut — bokad framtid kommer som validerad svepindata); takberäkningen `forbrukningForAvtal`/0064 (ingen andra takberäkning, jfr `timeReports.ts:456`); taxeordningen `gallandeTaxa` och heltalsregeln `timeEntryAmountOre` (ören i heltal, aldrig float); "ett oläst tak varnar aldrig" (`cap_status`); vitest mot riktig Postgres.
KRAV-1 | En ny REN, exporterad härledningsfunktion i `server/src/services/uppdragSvep.ts` tar (idag: ISO-datum, registrerade minuter, registrerade ören, rotens `cap_hours`/`cap_amount_ore`/`cap_status`, taxa i ören eller null, kalenderhändelser `{datum, minuter}[]`) och returnerar `{ ram_timmar, ram_kronor }` där vardera är `{ datum: 'YYYY-MM-DD' }` ELLER `{ villkor: string }` — ingen databas, inga anrop, samma indata ger alltid samma utdata (`idag` är argument, som i `byggForbrukning`).
KRAV-2 | Underlaget hämtas i svepet: `forbrukningForAvtal` i `contracts.ts` exporteras (oförändrad i övrigt) och steg 3 läser rotdelens nod (`code === ROTKOD`, `parent_code === null`) för uppdragets registrerade `billable_minutes`, `amount_ore`, tak och `cap_status`; taxan är avtalets `hourly_rate_ore`, annars uppdragets (`gallandeTaxa` utan post-/delled — en bokning bär ingen avtalsdel).
KRAV-3 | Bara kalenderhändelser med `datum` EFTER `idag` räknas som bokad framtid (registrerad tid t.o.m. i dag bär det förflutna); råsummeringen `handelser`/`bokade_minuter`/`forsta`/`sista` över hela indatalistan behålls oförändrad i `prognos`-värdet, och de två nya fälten `ram_timmar`/`ram_kronor` läggs bredvid; `kalla` förblir `'kalender'`.
KRAV-4 | Härledningen per ram: kvar = ram − registrerat (minuter resp. ören); är kvar ≤ 0 är datumet `idag` (ramen är redan nådd — fakta, inte gissning); annars ackumuleras framtida händelser i datumordning (för kronor: händelsens minuter → ören via `timeEntryAmountOre` med taxan) och datumet är den händelsedag där summan når ramen; räcker bokningarna inte förlängs med bokad takt: datum = sista bokade datumet + ceil(resterande × spanndagar ÷ bokat totalt framåt) dagar, där spanndagar = dagar från `idag` till sista bokade datumet — heltalsaritmetik hela vägen, aldrig float som mellanled för ören.
KRAV-5 | Villkor i stället för datum, prövade i denna ordning per ram: saknar roten bekräftat tak för ramen (`cap_status !== 'bekraftat'` eller takfältet null) → `villkor: 'inget bekräftat tak'`; saknas taxa (endast `ram_kronor`) → `villkor: 'ingen taxa'`; finns ingen framtida händelse med minuter > 0 → `villkor: 'ingen bokad framtid'` — ett fält bär ALDRIG både datum och villkor, och aldrig ett tal när underlag saknas (FR-5: vägrar gissa).
KRAV-6 | Svepets ordning och nycklar är oförändrade: verifiering → spärrmapp → prognos (KRAV-4 i S7.3-provet), nyckeln heter fortfarande `prognos`, raden skrivs också vid tom kalenderlista, och allt går i samma enda `upsertSvepvarden`-anrop som i dag.
KRAV-7 | Prov: förväntningarna på `prognos`-värdet i `server/test/uppdragsytan-svep.test.ts` skrivs om till nya formen, och en ny vitest-svit fryser den rena funktionen: känt indata (registrerad tid + bokade timmar per vecka framåt) → två kända datum; ram nådd inom bokningarna → händelsedagens datum; ram bortom bokningarna → taktförlängt datum; redan nådd ram → `idag`; utan bokad framtid → `villkor: 'ingen bokad framtid'`; obekräftat/saknat tak → `'inget bekräftat tak'`; utan taxa → `'ingen taxa'` för kronor medan timdatumet ändå levereras.
KRAV-8 | Cache-omräkningsprovet (ADR-2) förblir grönt: samma svepindata två gånger ger exakt samma `prognos`-rad, och `npm run build` passerar utan fel.
KRAV-9 | Dokumentation: raden om `prognos`-värdet under `kor_uppdragssvep` i docs/MCP_ACTIONS.md uppdateras med de två nya fälten och villkorsnamnen; docs/STATUS.md får en sessionsrad.
ACCEPTANS | Granskaren kör `npm test` och `npm run build` (riktig utdata inklistrad, inga påståenden utan bevis) och ser: nya sviten grön med de frysta datumen och alla tre villkorsnamnen, omskrivna svepprov gröna, ADR-2-provet grönt, och i koden att inget prognosfält kan bli ett tal när tak, taxa eller bokad framtid saknas samt att ingen ny takberäkning eller taxeordning införts utanför `forbrukningForAvtal`/`gallandeTaxa`.
AVGRANSNING | Bara `server/src/services/uppdragSvep.ts` (steg 3 + ny funktion), en `export`-rad i `contracts.ts`, de två testfilerna och de två docs-raderna; ingen migration, ingen ny åtgärd, ingen sensitivity-ändring, inga nya felkoder, ingen vy och ingen ändring av svepets indata-schema, lås, hopp- eller bindningslogik.
uteslutet: rendering av prognosen (kurvan och den streckade förlängningen, S10.4) — kallan kraver det inte
uteslutet: prognos per avtalsdel eller ström (bara uppdragets rotram) — kallan kraver det inte
uteslutet: Hermes-räknade prognosdatum i svepindatat — kallan kraver det inte
uteslutet: varning eller notis när prognosdatumet närmar sig — kallan kraver det inte
uteslutet: egen auditrad för prognosvärdet utöver svepets befintliga — kallan kraver det inte
uteslutet: lagrad prognoshistorik (utvecklingen över tid) — kallan kraver det inte

Tre grundade val att känna till vid granskning: taxan följer `gallandeTaxa`-ordningen (avtal → uppdrag) i stället för FRAGA:ns "projektets timtaxa" eftersom Davids svar hänvisar analysfrågan till husets mönster (regel 3); taktförlängningen bortom sista bokningen är belagd av storyns "bokade timmar per vecka framåt ger ett känt datum" och S10.4:s "streckade förlängning" (utan den funnes inget att rita); och råsummeringens fyra fält behålls för att ändringen ska vara minsta möjliga mot befintliga prov och MCP_ACTIONS-dokumentationen.
```

## Utfall
Tester: 126 passed (126) · Granskning: GODKANT | Bygget uppfyller KRAV-1–9 exakt (ren funktion med `idag` som argument, rotnoden ur den exporterade `forbrukningForAvtal`, taxan via `gallandeTaxa(null,null,avtal,projekt)`, ören via `timeEnt · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
