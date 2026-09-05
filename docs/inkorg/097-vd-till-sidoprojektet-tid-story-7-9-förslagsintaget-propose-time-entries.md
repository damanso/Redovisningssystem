# Tid, story 7/9: förslagsintaget (propose_time_entries) och godkännandeloopen i vyn — godkänn/justera/ignorera/byt avtalsdel per dag (F5)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §2 mål 4–5, §4 F4 punkt 4–5 (härkomst, osäkerhet), F5, §7 acceptans 5–6 och 8, §8 öppna frågor 2–3, §9.7–8. Bygger på story 1 (status 'forslag', source/source_ref) och story 5 (vyns tidsformulär). Davids beslut 1/9 (delegerat): kalender- och mailläsningen bor hos Hermes på VPS:en enligt docs/crm/API_KONTRAKT.md (repot ringer ALDRIG ut; källsystemen ringer in) — den byggs som Hermes-skill i story 8. Det här repot äger intaget och godkännandet. RÅDSLAGETS BESLUT 1/9 på öppen fråga 2 (CHRO, KVALITET, CFO, VD): förslag utan möte (bara mailspår) tas emot ENDAST som aktivitetsmarkering — minutes 0, aldrig en gissad siffra; David sätter tiden eller ignorerar. Öppen fråga 3 (KVALITET, CFO, ADMIN, CHRO): ingen ålderströskel och ingen räknare på förstasidan — flagga på pengar (story 4:s rapport), kön visar bara sina dagar. Dubblettskydd (CTO): ett förslag på ett projekt+datum där det redan finns en manuellt registrerad post markeras overlaps_manual=true och visas som 'redan registrerad?' — aldrig en tyst andra rad. Kön grindar ALDRIG fakturan (VD-beslut i rådslaget).

VAD SOM BYGGS (samma mönster som ingest_crm_events: batch in, idempotens på source_ref, allt genom actions):
1. Action propose_time_entries (write, agent- eller människotoken): events[] {project_id | project_hint (kundens namn/domän), contract_part_id | part_hint, work_date, minutes, description, source ('kalender'|'mail'|'harledd'), source_ref (UNIK per bolag — samma ref igen uppdaterar inte, hoppar över och rapporteras som duplicate), uncertainty ('lag'|'medel'|'hog'), reasoning (max 500 tecken — varför förslaget finns)}. Skapar time_entries i status 'forslag' med billable_minutes = minutes (minutes får vara 0 för status forslag — CHECK-villkoret från 0017 lättas för just forslag; godkännande kräver minutes > 0); project_hint utan träff → posten sparas ändå med project_id på bolagets projekt 'Osorterat' (skapas vid behov, en gång) så inget tappas. Svar: created, duplicates, unresolved. Migration: unikt index (company_id, source_ref) där source_ref inte är null; kolumnerna uncertainty och reasoning. GALLRING (rådslaget 1/9, CTO/CLO — samma lucka som GDPR-regressionen i STATUS-loggen): reasoning får ALDRIG innehålla mailtext ordagrant eller tredje parts namn utöver kundens organisation — bara en mening om varför + source_ref (ett id, inte innehåll); reasoning nullas när posten blir fakturerad och för ignorerade poster äldre än 90 dagar via samma gallringsmekanism som crm.retention_settings (befintligt jobb), source_ref behålls som spår.
2. Actions approve_time_entries (write): ids[] + per id valfritt {billable_minutes, adjustment_reason, contract_part_id, status 'godkand'|'justerad'|'ignorerad'} — går genom samma övergångsregler som update_time_entry (story 1); ignorerad kräver orsak. Massgodkännande = samma action med flera id:n.
3. Vyn /app/c/:id/tid/forslag: grupperat per dag (senaste dagen överst, äldre dagar ligger kvar — förfaller aldrig), per rad: projekt/avtalsdel (select), registrerad tid, föreslagen debiterbar tid (textfält med parsern), beskrivning, härkomst som länk/text (source_ref + reasoning), osäkerhetsmarkering, knappar Godkänn · Justera · Ignorera (orsak) · Byt avtalsdel. 'Godkänn hela dagen' finns per dag men är aldrig förvald och kräver ett klick till. Rubriken visar antal obehandlade dagar på själva kösidan (inte på förstasidan). En dag med två poster ska gå att klara på under 30 sekunder (acceptans 6) — inga extra sidbyten.
4. docs/MCP_ACTIONS.md + docs/crm/API_KONTRAKT.md får ett avsnitt 'Tidsförslag' (samma form som ingest_crm_events). STATUS.md. Tester: idempotens på source_ref, Osorterat-fallet, batchgodkännande med justering och orsak, ignorerad syns aldrig i unbilled_time_report men går att lista (acceptans 8), dagräknaren.

UTANFÖR: själva kalender-/mailläsningen och resonemanget (story 8, Hermes), flera personer (9).

## Rekommendation

Bygg — steg 7–8:s mottagarsida i PRD §9; kön och intaget måste finnas innan Hermes kan börja föreslå gårdagens tid.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
