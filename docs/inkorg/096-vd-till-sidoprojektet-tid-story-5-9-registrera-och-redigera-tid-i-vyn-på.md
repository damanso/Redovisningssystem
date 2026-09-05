# Tid, story 5/9: registrera och redigera tid i vyn på under tio sekunder, naturlig tidsinmatning, bifogade underlag (F1)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §2 mål 1, §4 F1, §5 (bilagor), §7 acceptans 7, §9.5. Bygger på story 1–4 (docs/byggen/): update_time_entry, list_time_entries, contract_part_id, sidan /app/c/:id/tid. Davids beslut 1/9 (delegerat): AI är primär väg in men aldrig den enda — vyn ska klara allt utan AI (ARKITEKTUR: vyn är en fullständig reserv). Designen följer designkontraktet (redovisningen är kanon) — ingen ny stil.

VERKLIGHETEN: vyn är serverrenderad JS-fri HTML (CSP script-src 'none') med formulär som kör actions via executeAction med actor human (view/routes.ts). Projektsidan listar tidposter men har inget formulär för att ändra en post. files-tabellen + validateUpload (fileStorage.ts) och multer finns redan för kvitton/fakturor.

VAD SOM BYGGS (samma mönster som vyns befintliga formulär, t.ex. kvittoflödet):
1. Tidsparsern i lib/ (ren funktion, testad): '1h', '1,5', '1.5', '90m', '45', '1h30', '1:30' → minuter. Tal utan enhet: ≥ 10 tolkas som minuter, < 10 som timmar (PRD-exemplen '45' = 45 min, '1,5' = 1,5 h). Fel → 400 invalid_duration med exemplen i texten. Används av vyns formulär; log_time/update_time_entry får ett valfritt fält duration (text) som alternativ till minutes (exakt ett av dem).
2. Snabbformulär överst på /app/c/:id/tid och på projektsidan: projekt (förvalt på projektsidan), avtalsdel (select ur projektets delar, obligatorisk när delar finns), tid (textfält med parsern), beskrivning, datum (default idag). En rad, en knapp — ska gå på under tio sekunder (acceptans 6/F1). Svaret visar takvarningen från story 3 som meddelande (ingen spärr vid registrering — rådslagets beslut).
3. Redigeringssida /app/c/:id/tid/:entryId: alla fält (datum, registrerad tid, debiterbar tid, beskrivning, avtalsdel, status med tillåtna övergångar, justeringsorsak) via update_time_entry. Fakturerad post visas låst med länk till fakturan (409 → tydlig text). Historiken (auditloggens rader för posten) visas under formuläret — vem godkände, vad justerades, varför (F7).
4. Underlag — RÅDSLAGETS BESLUT 1/9 (CLO, antaget av CHRO och VD): som LÄNKAR till kundmappen på Drive/Doc/ärende, ALDRIG som filkopior i redovisningsdatabasen (kundmaterial ska inte in där kundgränsen för underkonsulter är omtvistad; ILT §6). Tabell time_entry_links (id, company_id, time_entry_id, url text NOT NULL (https-validerad), label, created_by, created_at; RLS som 0047). Actions attach_time_entry_link och remove_time_entry_link (write; bara på icke-fakturerad post), länkarna ingår i list_time_entries-svaret. I vyn: klistra länk + etikett på redigeringssidan, lista med klickbara länkar. Ingen filuppladdning.
5. docs/MCP_ACTIONS.md + STATUS.md. Tester: parsern (tabell av fall), formuläret skapar post med rätt status/avtalsdel, redigering av icke-fakturerad post, 409 på fakturerad, länk läggs till/tas bort, takvarningen renderas.

UTANFÖR: extraktion ur avtal (6), kalender/mail-förslag och godkännandekö (7–8), flera personer (9).

## Rekommendation

Bygg — steg 5 i PRD §9; utan den kräver varje rättelse AI eller API, precis det K-7-städytan lärde oss 31/8.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
